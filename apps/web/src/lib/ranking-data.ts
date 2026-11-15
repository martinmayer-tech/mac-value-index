// Shapes the latest results into the small payload the ranking island
// receives. Values are copied from results.json; nothing is calculated.

import type {Condition, FormFactor, MetricKey, Results} from '@mvi/contracts';
import {METRIC_KEYS} from '@mvi/contracts/constants';

/** One listing's pre-calculated figures under one profile. */
export interface ProfileFigures {
  readonly rank: number;
  readonly capabilityScore: number;
  readonly valueScore: number;
  readonly pareto: boolean;
  readonly memoryHeadroomGb: number;
  readonly modelClass: string;
  readonly usableStorageGb: number;
  /** Weighted score components, in METRIC_KEYS order. */
  readonly components: readonly number[];
  readonly gbpPer1000MultiCore: number;
  readonly gbpPerGbRam: number;
  readonly gbpPerGbUsableStorage: number | null;
}

export interface RankingRow {
  readonly id: string;
  readonly model: string;
  readonly chipLabel: string;
  readonly chipFamily: string;
  readonly formFactor: FormFactor;
  readonly condition: Condition;
  readonly ramGb: number;
  readonly ssdGb: number;
  readonly priceGbp: number;
  readonly multiCore: number | null;
  readonly seller: string;
  readonly sourceUrl: string;
  readonly retrievedDate: string;
  readonly warrantyMonths: number | null;
  readonly stable: boolean;
  readonly agent: boolean;
  /** Figures per profile id; absent when excluded under that profile. */
  readonly figures: Readonly<Record<string, ProfileFigures>>;
}

export interface ProfileOption {
  readonly id: string;
  readonly name: string;
  /** Profile weights, in METRIC_KEYS order. */
  readonly weights: readonly number[];
}

export interface RankingData {
  readonly snapshotDate: string;
  readonly defaultProfileId: string;
  readonly profiles: readonly ProfileOption[];
  readonly rows: readonly RankingRow[];
}

export const METRIC_LABELS: Readonly<Record<MetricKey, string>> = {
  multiCore: 'Multi-core',
  memoryHeadroom: 'Memory headroom',
  gpuAndBandwidth: 'GPU and bandwidth',
  singleCore: 'Single-core',
  usableStorage: 'Usable storage',
};

/**
 * Rounds for display only, to keep the page small. The table shows at
 * most two decimal places.
 */
function trim(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

/** Builds the island payload: listings ranked under at least one profile. */
export function buildRankingData(results: Results): RankingData {
  const figures = new Map<string, Record<string, ProfileFigures>>();
  for (const result of results.profiles) {
    for (const entry of result.ranking) {
      const perProfile = figures.get(entry.listingId) ?? {};
      perProfile[result.profile.id] = {
        rank: entry.rank,
        capabilityScore: trim(entry.capabilityScore),
        valueScore: trim(entry.valueScore),
        pareto: entry.isParetoOptimal,
        memoryHeadroomGb: entry.derived.memoryHeadroomGb,
        modelClass: entry.derived.modelClass,
        usableStorageGb: entry.derived.usableStorageGb,
        components: METRIC_KEYS.map(key =>
          trim(entry.components[key].weighted),
        ),
        gbpPer1000MultiCore: trim(entry.derived.gbpPer1000MultiCore),
        gbpPerGbRam: trim(entry.derived.gbpPerGbRam),
        gbpPerGbUsableStorage:
          entry.derived.gbpPerGbUsableStorage === null
            ? null
            : trim(entry.derived.gbpPerGbUsableStorage),
      };
      figures.set(entry.listingId, perProfile);
    }
  }
  const rows: RankingRow[] = [];
  for (const listing of results.listings) {
    const perProfile = figures.get(listing.id);
    if (perProfile === undefined) {
      continue;
    }
    rows.push({
      id: listing.id,
      model: listing.model,
      chipLabel: listing.chip.label,
      chipFamily: listing.chip.family,
      formFactor: listing.formFactor,
      condition: listing.condition,
      ramGb: listing.ramGb,
      ssdGb: listing.ssdGb,
      priceGbp: listing.priceGbp,
      multiCore: listing.chip.multiCore,
      seller: listing.seller,
      sourceUrl: listing.sourceUrl,
      retrievedDate: listing.retrievedDate,
      warrantyMonths: listing.warrantyMonths,
      stable: listing.isStable,
      agent: listing.collectedBy === 'agent',
      figures: perProfile,
    });
  }
  return {
    snapshotDate: results.snapshotDate,
    defaultProfileId: results.defaultProfileId,
    profiles: results.profiles.map(result => ({
      id: result.profile.id,
      name: result.profile.name,
      weights: METRIC_KEYS.map(key => result.profile.weights[key]),
    })),
    rows,
  };
}
