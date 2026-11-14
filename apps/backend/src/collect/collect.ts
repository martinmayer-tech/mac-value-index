// Runs the adapters and assembles a snapshot.

import {formatIssues} from '@mvi/contracts';
import type {ChipsFile, ListingSnapshot, SourceStatus} from '@mvi/contracts';

import type {HttpClient} from './http.js';
import {normalise} from './normalise.js';
import {AdapterSkippedError, rawListingSchema} from './types.js';
import type {RawListing, SourceAdapter} from './types.js';

export interface CollectOptions {
  readonly adapters: readonly SourceAdapter[];
  /** Adapter ids to run; null runs every adapter. */
  readonly only: readonly string[] | null;
  readonly http: HttpClient;
  readonly chips: ChipsFile;
  readonly date: string;
  readonly log: (message: string) => void;
}

export interface CollectResult {
  readonly snapshot: ListingSnapshot;
  readonly warnings: readonly string[];
  /** Chip variants seen in listings but missing from chips.json. */
  readonly unmapped: readonly string[];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Collects from every adapter. A failing adapter never fails the run. */
export async function collect(options: CollectOptions): Promise<CollectResult> {
  const warnings: string[] = [];
  const sourceStatus: SourceStatus[] = [];
  const rawListings: RawListing[] = [];

  for (const adapter of options.adapters) {
    const base = {
      adapterId: adapter.id,
      name: adapter.name,
      kind: adapter.kind,
      condition: adapter.condition,
      url: adapter.url,
      retrievedDate: options.date,
    };
    if (options.only !== null && !options.only.includes(adapter.id)) {
      sourceStatus.push({
        ...base,
        status: 'skipped',
        listingCount: 0,
        error: 'Not selected for this run.',
      });
      continue;
    }
    options.log(`Collecting from ${adapter.id}…`);
    try {
      const collected = await adapter.collect({
        http: options.http,
        retrievedDate: options.date,
        warn: message => {
          warnings.push(`${adapter.id}: ${message}`);
        },
      });
      const valid: RawListing[] = [];
      for (const candidate of collected) {
        const parsed = rawListingSchema.safeParse(candidate);
        if (parsed.success) {
          valid.push(parsed.data);
        } else {
          warnings.push(
            `${adapter.id}: dropped "${candidate.title}": ${formatIssues(parsed.error).join('; ')}`,
          );
        }
      }
      rawListings.push(...valid);
      sourceStatus.push({
        ...base,
        status: 'ok',
        listingCount: valid.length,
        error: null,
      });
      options.log(`  ${valid.length} listings.`);
    } catch (error) {
      const skipped = error instanceof AdapterSkippedError;
      sourceStatus.push({
        ...base,
        status: skipped ? 'skipped' : 'failed',
        listingCount: 0,
        error: errorMessage(error),
      });
      options.log(
        `  ${skipped ? 'Skipped' : 'FAILED'}: ${errorMessage(error)}`,
      );
    }
  }

  const {listings, unmapped} = normalise(rawListings, options.chips);
  return {
    snapshot: {
      schemaVersion: 1,
      snapshotDate: options.date,
      sourceStatus,
      listings: [...listings],
    },
    warnings,
    unmapped,
  };
}
