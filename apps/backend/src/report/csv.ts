// Renders ranking.csv: the full ranking for the default profile.

import type {Results} from '@mvi/contracts';

function cell(value: string | number | boolean | null): string {
  if (value === null) {
    return '';
  }
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const HEADERS = [
  'rank',
  'listing_id',
  'model',
  'year',
  'form_factor',
  'chip',
  'cpu_cores',
  'gpu_cores',
  'ram_gb',
  'ssd_gb',
  'condition',
  'seller',
  'price_gbp',
  'geekbench_multi_core',
  'geekbench_single_core',
  'geekbench_metal',
  'memory_bandwidth_gb_per_sec',
  'memory_headroom_gb',
  'model_class',
  'usable_storage_gb',
  'gbp_per_1000_multi_core',
  'gbp_per_gb_ram',
  'gbp_per_gb_usable_storage',
  'capability_score',
  'value_score',
  'pareto_optimal',
  'stable_across_profiles',
  'collected_by',
  'warranty_months',
  'source_url',
  'retrieved_date',
];

/** Renders the CSV. Numbers are unformatted. */
export function renderCsv(results: Results): string {
  const result = results.profiles.find(
    candidate => candidate.profile.id === results.defaultProfileId,
  );
  if (result === undefined) {
    throw new Error('Default profile missing from results.');
  }
  const listings = new Map(results.listings.map(l => [l.id, l]));
  const lines = [HEADERS.join(',')];
  for (const entry of result.ranking) {
    const listing = listings.get(entry.listingId);
    if (listing === undefined) {
      continue;
    }
    lines.push(
      [
        entry.rank,
        listing.id,
        listing.model,
        listing.year,
        listing.formFactor,
        listing.chip.family,
        listing.chip.cpuCores,
        listing.chip.gpuCores,
        listing.ramGb,
        listing.ssdGb,
        listing.condition,
        listing.seller,
        listing.priceGbp,
        listing.chip.multiCore,
        listing.chip.singleCore,
        listing.chip.metal,
        listing.chip.memoryBandwidthGbPerSec,
        entry.derived.memoryHeadroomGb,
        entry.derived.modelClass,
        entry.derived.usableStorageGb,
        entry.derived.gbpPer1000MultiCore,
        entry.derived.gbpPerGbRam,
        entry.derived.gbpPerGbUsableStorage,
        entry.capabilityScore,
        entry.valueScore,
        entry.isParetoOptimal,
        listing.isStable,
        listing.collectedBy,
        listing.warrantyMonths,
        listing.sourceUrl,
        listing.retrievedDate,
      ]
        .map(cell)
        .join(','),
    );
  }
  return `${lines.join('\n')}\n`;
}
