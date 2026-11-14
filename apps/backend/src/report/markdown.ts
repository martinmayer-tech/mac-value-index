// Renders report.md from results.json only.

import type {
  ProfileResult,
  RankedListing,
  ResultListing,
  Results,
} from '@mvi/contracts';

import {
  conditionLabel,
  formatGbp,
  formatNumber,
  formatStorage,
} from '../scoring/text.js';

type ListingLookup = ReadonlyMap<string, ResultListing>;

function escapeCell(text: string): string {
  return text.replace(/\|/g, '\\|');
}

function table(
  headers: readonly string[],
  rows: readonly (readonly string[])[],
): string {
  const line = (cells: readonly string[]): string =>
    `| ${cells.map(escapeCell).join(' | ')} |`;
  return [
    line(headers),
    line(headers.map(() => '---')),
    ...rows.map(line),
  ].join('\n');
}

function link(text: string, url: string): string {
  return `[${text}](${url})`;
}

function rankingRow(entry: RankedListing, listing: ResultListing): string[] {
  return [
    String(entry.rank),
    link(listing.model, listing.sourceUrl),
    listing.chip.label,
    `${listing.ramGb}GB`,
    formatStorage(listing.ssdGb),
    conditionLabel(listing.condition),
    formatGbp(listing.priceGbp),
    formatNumber(entry.components.multiCore.raw),
    `${formatNumber(entry.derived.memoryHeadroomGb)} GB (${entry.derived.modelClass})`,
    `${formatNumber(entry.derived.usableStorageGb)} GB`,
    formatNumber(entry.valueScore, 2),
  ];
}

const RANKING_HEADERS = [
  'Rank',
  'Model',
  'Chip',
  'RAM',
  'SSD',
  'Condition',
  'Price',
  'Multi-core',
  'Model headroom',
  'Usable storage',
  'Value score',
];

function rankingTable(
  entries: readonly RankedListing[],
  listings: ListingLookup,
): string {
  const rows: string[][] = [];
  for (const entry of entries) {
    const listing = listings.get(entry.listingId);
    if (listing !== undefined) {
      rows.push(rankingRow(entry, listing));
    }
  }
  return table(RANKING_HEADERS, rows);
}

function describe(listing: ResultListing): string {
  return `${listing.model} ${listing.chip.family} ${listing.chip.cpuCores}/${listing.chip.gpuCores}-core ${listing.ramGb}GB ${formatStorage(listing.ssdGb)}`;
}

function priceBandSection(
  result: ProfileResult,
  listings: ListingLookup,
): string {
  const rankOf = new Map(result.ranking.map(e => [e.listingId, e]));
  const rows = result.priceBandPicks.map(pick => {
    const listing = listings.get(pick.listingId ?? '');
    const entry = rankOf.get(pick.listingId ?? '');
    if (listing === undefined || entry === undefined) {
      return [pick.label, 'No listing in this band', '', '', ''];
    }
    return [
      pick.label,
      link(describe(listing), listing.sourceUrl),
      conditionLabel(listing.condition),
      formatGbp(listing.priceGbp),
      `${entry.rank} (${formatNumber(entry.valueScore, 2)})`,
    ];
  });
  return table(
    ['Price band', 'Best pick', 'Condition', 'Price', 'Rank (value score)'],
    rows,
  );
}

function newVersusRefurbishedSection(
  results: Results,
  listings: ListingLookup,
): string {
  if (results.newVersusRefurbished.length === 0) {
    return 'No configuration in this snapshot is available both new and refurbished.';
  }
  const rows: string[][] = [];
  for (const comparison of results.newVersusRefurbished) {
    for (const alternative of comparison.alternatives) {
      const listing = listings.get(alternative.listingId);
      rows.push([
        `${comparison.model} ${comparison.chipLabel} ${comparison.ramGb}GB ${formatStorage(comparison.ssdGb)}`,
        formatGbp(comparison.newPriceGbp),
        listing === undefined
          ? conditionLabel(alternative.condition)
          : link(
              `${conditionLabel(alternative.condition)}, ${alternative.seller}`,
              listing.sourceUrl,
            ),
        formatGbp(alternative.priceGbp),
        formatGbp(alternative.savingGbp),
        `${formatNumber(alternative.savingPercent, 1)}%`,
      ]);
    }
  }
  return table(
    ['Configuration', 'New', 'Alternative', 'Price', 'Saving', 'Saving %'],
    rows,
  );
}

function sensitivitySection(
  result: ProfileResult,
  listings: ListingLookup,
): string {
  const sensitivity = result.storageSensitivity;
  const external = sensitivity.externalStorage;
  const rows: string[][] = [];
  for (const entry of sensitivity.entries.slice(0, 10)) {
    const listing = listings.get(entry.listingId);
    if (listing !== undefined) {
      rows.push([
        String(entry.rank),
        String(entry.baselineRank),
        describe(listing),
        entry.adjusted ? 'Yes' : 'No',
        formatGbp(entry.priceGbp),
        `${formatNumber(entry.usableStorageGb)} GB`,
        formatNumber(entry.valueScore, 2),
      ]);
    }
  }
  return [
    `Desktops are re-scored with a ${formatStorage(external.capacityGb)} external SSD added: ${link(external.product, external.sourceUrl)} at ${formatGbp(external.priceGbp)} (retrieved ${external.retrievedDate}). Laptops are unchanged.`,
    '',
    sensitivity.summary,
    '',
    table(
      [
        'Rank',
        'Normal rank',
        'Configuration',
        'External SSD added',
        'Price',
        'Usable storage',
        'Value score',
      ],
      rows,
    ),
  ].join('\n');
}

function stabilitySection(results: Results, listings: ListingLookup): string {
  const lines = [results.stability.summary];
  for (const id of results.stability.stableListingIds) {
    const listing = listings.get(id);
    if (listing !== undefined) {
      lines.push(
        `- ${link(describe(listing), listing.sourceUrl)} (${conditionLabel(listing.condition)}, ${formatGbp(listing.priceGbp)})`,
      );
    }
  }
  return lines.join('\n');
}

function methodologySection(results: Results): string {
  const weightRows = results.profiles.map(({profile}) => [
    `\`${profile.id}\`${profile.id === results.defaultProfileId ? ' (default)' : ''}`,
    String(profile.weights.multiCore),
    String(profile.weights.memoryHeadroom),
    String(profile.weights.gpuAndBandwidth),
    String(profile.weights.singleCore),
    String(profile.weights.usableStorage),
  ]);
  const [first] = results.profiles;
  const lines = [
    `- **Benchmarks**: Geekbench ${results.geekbenchVersion} single-core, multi-core and Metal scores. One Geekbench version is used throughout.`,
    `- **Normalisation**: ${results.normalisation.description}`,
    '- **Capability score** (zero to 100): the sum of each normalised metric multiplied by its weight.',
    '- **Value score**: capability score divided by price, multiplied by 1,000 (capability per £1,000). This is the ranking key. Ties break on higher capability score, then lower price, then listing id.',
    '- **Chip notation**: "12/16-core" means a 12-core CPU and a 16-core GPU.',
  ];
  if (first !== undefined) {
    const {profile} = first;
    lines.push(
      `- **Model memory headroom**: RAM minus ${profile.reservations.memoryGb} GB. **Usable storage**: SSD minus ${profile.reservations.storageGb} GB. ${profile.reservations.assumption}`,
      `- **GPU and bandwidth**: ${profile.gpuAndBandwidthSplit.metal}% normalised Metal score and ${profile.gpuAndBandwidthSplit.memoryBandwidth}% normalised memory bandwidth.`,
      `- **Floors**: at least ${profile.floors.minRamGb} GB RAM and ${formatStorage(profile.floors.minSsdGb)} SSD. Listings below a floor are excluded.`,
      '- **Model classes** (largest model that fits at 4-bit quantisation):',
      ...profile.modelClasses.map(
        modelClass =>
          `  - ${modelClass.label}: at least ${modelClass.minHeadroomGb} GB headroom. ${modelClass.assumption}`,
      ),
    );
  }
  return [
    ...lines,
    '',
    'Weights by profile:',
    '',
    table(
      [
        'Profile',
        'Multi-core',
        'Memory headroom',
        'GPU and bandwidth',
        'Single-core',
        'Usable storage',
      ],
      weightRows,
    ),
  ].join('\n');
}

const CAVEATS = [
  'Benchmarks measure short synthetic workloads. Sustained performance, thermal limits and real build or inference speed can differ.',
  'Stock and prices change quickly, especially refurbished stock. Check the source listing before buying.',
  'Warranty and returns differ between new, Apple refurbished and third-party refurbished machines.',
  'Desktop prices exclude a display, keyboard and pointing device. Laptop prices include them.',
  'Colour and display-finish variants of the same configuration are collapsed to the cheapest.',
];

function sourcesSection(results: Results): string {
  const sourceRows = results.sources.map(source => [
    link(source.name, source.url),
    conditionLabel(source.condition),
    source.kind,
    source.status,
    String(source.listingCount),
    source.retrievedDate,
    source.error ?? '',
  ]);
  const chipRows = results.chips.map(chip => [
    chip.id,
    chip.collectedBy,
    chip.retrievedDate,
    chip.sources
      .map(source => link(new URL(source.url).hostname, source.url))
      .join(', '),
  ]);
  const failed = results.sources.filter(source => source.status !== 'ok');
  return [
    table(
      [
        'Source',
        'Condition',
        'Kind',
        'Status',
        'Listings',
        'Retrieved',
        'Error',
      ],
      sourceRows,
    ),
    '',
    failed.length === 0
      ? 'No source failed or was skipped.'
      : `Sources that failed or were skipped: ${failed.map(source => source.name).join(', ')}.`,
    '',
    'Chip specifications and benchmarks:',
    '',
    table(['Chip', 'Collected by', 'Retrieved', 'Sources'], chipRows),
  ].join('\n');
}

function exclusionsSection(
  result: ProfileResult,
  listings: ListingLookup,
): string {
  if (result.exclusions.length === 0) {
    return 'No listing was excluded.';
  }
  const rows: string[][] = [];
  for (const exclusion of result.exclusions) {
    const listing = listings.get(exclusion.listingId);
    if (listing !== undefined) {
      rows.push([
        link(describe(listing), listing.sourceUrl),
        conditionLabel(listing.condition),
        formatGbp(listing.priceGbp),
        exclusion.detail,
      ]);
    }
  }
  return table(['Configuration', 'Condition', 'Price', 'Reason'], rows);
}

/** Renders the full markdown report. */
export function renderReport(results: Results): string {
  const listings: ListingLookup = new Map(
    results.listings.map(listing => [listing.id, listing]),
  );
  const result = results.profiles.find(
    candidate => candidate.profile.id === results.defaultProfileId,
  );
  if (result === undefined) {
    throw new Error('Default profile missing from results.');
  }
  const top = result.ranking.slice(0, 10);
  const agentListings = results.listings.filter(
    listing => listing.collectedBy === 'agent',
  ).length;
  const agentChips = results.chips.filter(
    chip => chip.collectedBy === 'agent',
  ).length;
  const sections = [
    `# Mac value index: ${results.snapshotDate}`,
    `Which Apple silicon Mac gives the most development capability per £ in the UK? Snapshot of ${results.snapshotDate}, profile \`${result.profile.id}\` (${result.profile.name}). All prices are GBP including VAT.`,
    '## Conclusion',
    result.conclusion.text,
    agentChips > 0 || agentListings > 0
      ? `> **Needs a human check**: ${agentChips} chip benchmark records and ${agentListings} listings were collected by a research agent and have not been verified against their sources.`
      : '',
    '## Top 10',
    rankingTable(top, listings),
    '## In plain English',
    top.map(entry => `${entry.rank}. ${entry.summary}`).join('\n'),
    '## Best pick per price band',
    priceBandSection(result, listings),
    '## New versus refurbished',
    newVersusRefurbishedSection(results, listings),
    '## Sensitivity and stability',
    '### Storage sensitivity for desktops',
    sensitivitySection(result, listings),
    '### Stability across profiles',
    stabilitySection(results, listings),
    '## Methodology',
    methodologySection(results),
    '## Caveats',
    CAVEATS.map(caveat => `- ${caveat}`).join('\n'),
    '## Sources',
    sourcesSection(results),
    '## Appendix: full ranking',
    rankingTable(result.ranking, listings),
    '## Appendix: exclusions',
    exclusionsSection(result, listings),
  ];
  return `${sections.filter(section => section !== '').join('\n\n')}\n`;
}
