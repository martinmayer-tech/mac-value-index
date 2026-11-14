// Maps raw listings to chip variants, assigns stable ids and removes
// duplicates.

import {createHash} from 'node:crypto';

import {chipCoreKey, totalCpuCores} from '@mvi/contracts';
import type {ChipsFile, Listing} from '@mvi/contracts';

import type {RawListing} from './types.js';

/** Stable hash of seller, model, chip variant, RAM, SSD and condition. */
export function listingId(
  parts: Pick<
    Listing,
    'seller' | 'model' | 'chipId' | 'ramGb' | 'ssdGb' | 'condition'
  >,
): string {
  const key = [
    parts.seller,
    parts.model,
    parts.chipId,
    parts.ramGb,
    parts.ssdGb,
    parts.condition,
  ].join('|');
  return createHash('sha256').update(key).digest('hex').slice(0, 16);
}

export interface NormaliseResult {
  readonly listings: readonly Listing[];
  /** Descriptions of listings whose chip is not in chips.json. */
  readonly unmapped: readonly string[];
}

function cheaper(a: Listing, b: Listing): Listing {
  if (a.priceGbp !== b.priceGbp) {
    return a.priceGbp < b.priceGbp ? a : b;
  }
  return a.sourceUrl <= b.sourceUrl ? a : b;
}

/**
 * Normalises raw listings. Identical configurations from the same seller
 * (for example different colours) collapse to the cheapest one; distinct
 * sellers stay separate.
 */
export function normalise(
  rawListings: readonly RawListing[],
  chipsFile: ChipsFile,
): NormaliseResult {
  const chipIds = new Map(
    chipsFile.chips.map(chip => [
      chipCoreKey(chip.family, totalCpuCores(chip), chip.gpuCores),
      chip.id,
    ]),
  );
  const unmapped = new Set<string>();
  const byId = new Map<string, Listing>();
  const duplicates = new Map<string, number>();

  for (const raw of rawListings) {
    const {chipFamily, cpuCores, gpuCores, ...rest} = raw;
    const chipId = chipIds.get(chipCoreKey(chipFamily, cpuCores, gpuCores));
    if (chipId === undefined) {
      unmapped.add(
        `${chipFamily} with ${cpuCores}-core CPU and ${gpuCores}-core GPU (${raw.title})`,
      );
      continue;
    }
    const withChip = {...rest, chipId};
    const listing: Listing = {id: listingId(withChip), ...withChip};
    const existing = byId.get(listing.id);
    duplicates.set(listing.id, (duplicates.get(listing.id) ?? 0) + 1);
    byId.set(
      listing.id,
      existing === undefined ? listing : cheaper(existing, listing),
    );
  }

  const listings = [...byId.values()]
    .map(listing => {
      const count = duplicates.get(listing.id) ?? 1;
      return count > 1 && listing.note === null
        ? {
            ...listing,
            note: `Cheapest of ${count} listings of this configuration (colour or display options differ).`,
          }
        : listing;
    })
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return {listings, unmapped: [...unmapped].sort()};
}
