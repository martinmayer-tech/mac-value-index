// Builds the complete results document from a snapshot, the chip data and
// the profiles. Pure: no file access, network, clock or randomness. The
// snapshot date comes from the data.

import {totalCpuCores} from '@mvi/contracts';
import type {
  ChipsFile,
  ChipVariant,
  Exclusion,
  Listing,
  ListingChip,
  ListingSnapshot,
  NewVersusRefurbished,
  PriceBandPick,
  Profile,
  ProfileResult,
  RankedListing,
  ResultListing,
  Results,
  StorageSensitivity,
} from '@mvi/contracts';

import {deriveMetrics, memoryHeadroomGb, usableStorageGb} from './derive.js';
import {paretoFrontier, rank, scoreListings} from './score.js';
import type {Scored, ScoreInput} from './score.js';
import {
  chipLabel,
  conclusionText,
  configurationName,
  formatGbp,
  formatStorage,
  NO_LISTINGS_CONCLUSION,
  summaryLine,
} from './text.js';

const TOP_COUNT = 10;

/** Raised when the inputs cannot be scored at all. */
export class ScoringError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScoringError';
  }
}

/** Returns the value, or raises when an internal lookup has no match. */
export function must<T>(value: T | undefined, what: string): T {
  if (value === undefined) {
    throw new ScoringError(`Internal error: ${what} not found.`);
  }
  return value;
}

function smallestClassHeadroom(profile: Profile): number {
  return must(profile.modelClasses[0], 'smallest model class').minHeadroomGb;
}

interface Eligible {
  readonly listing: Listing;
  readonly chip: ChipVariant;
  readonly input: ScoreInput;
}

function byId(a: {readonly id: string}, b: {readonly id: string}): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function toListingChip(chip: ChipVariant): ListingChip {
  const cpuCores = totalCpuCores(chip);
  return {
    family: chip.family,
    generation: chip.generation,
    cpuCores,
    performanceCores: chip.cpuCores.performance,
    efficiencyCores: chip.cpuCores.efficiency,
    gpuCores: chip.gpuCores,
    label: chipLabel(chip.family, cpuCores, chip.gpuCores),
    singleCore: chip.geekbench.singleCore,
    multiCore: chip.geekbench.multiCore,
    metal: chip.geekbench.metal,
    memoryBandwidthGbPerSec: chip.memoryBandwidthGbPerSec,
    maxMemoryGb: chip.maxMemoryGb,
  };
}

type Classified =
  | {readonly kind: 'eligible'; readonly eligible: Eligible}
  | {readonly kind: 'excluded'; readonly exclusion: Exclusion};

function excluded(
  listing: Listing,
  reason: Exclusion['reason'],
  detail: string,
): Classified {
  return {
    kind: 'excluded',
    exclusion: {listingId: listing.id, reason, detail},
  };
}

/** Applies the floors and checks that every weighted metric is known. */
export function classify(
  listing: Listing,
  chip: ChipVariant,
  profile: Profile,
): Classified {
  const {floors, weights, gpuAndBandwidthSplit: split} = profile;
  if (listing.ramGb < floors.minRamGb) {
    return excluded(
      listing,
      'below-ram-floor',
      `${listing.ramGb} GB RAM is below the ${floors.minRamGb} GB floor.`,
    );
  }
  if (listing.ssdGb < floors.minSsdGb) {
    return excluded(
      listing,
      'below-ssd-floor',
      `${formatStorage(listing.ssdGb)} SSD is below the ${formatStorage(floors.minSsdGb)} floor.`,
    );
  }
  const {singleCore, multiCore, metal} = chip.geekbench;
  const metalNeeded = weights.gpuAndBandwidth > 0 && split.metal > 0;
  const bandwidthNeeded =
    weights.gpuAndBandwidth > 0 && split.memoryBandwidth > 0;
  const singleNeeded = weights.singleCore > 0;
  const missing = [
    multiCore === null ? 'multi-core' : null,
    singleCore === null && singleNeeded ? 'single-core' : null,
    metal === null && metalNeeded ? 'Metal' : null,
  ].filter(name => name !== null);
  if (multiCore === null || missing.length > 0) {
    return excluded(
      listing,
      'missing-benchmark',
      `No verified Geekbench ${missing.join(', ')} score for ${chip.id}.`,
    );
  }
  const bandwidth = chip.memoryBandwidthGbPerSec;
  if (bandwidth === null && bandwidthNeeded) {
    return excluded(
      listing,
      'missing-memory-bandwidth',
      `No verified memory bandwidth figure for ${chip.id}.`,
    );
  }
  return {
    kind: 'eligible',
    eligible: {
      listing,
      chip,
      input: {
        id: listing.id,
        priceGbp: listing.priceGbp,
        multiCore,
        singleCore: singleCore ?? 0,
        metal: metal ?? 0,
        memoryBandwidthGbPerSec: bandwidth ?? 0,
        memoryHeadroomGb: memoryHeadroomGb(listing.ramGb, profile),
        usableStorageGb: usableStorageGb(listing.ssdGb, profile),
      },
    },
  };
}

function nameOf(listing: Listing, chip: ChipVariant): string {
  return configurationName({
    model: listing.model,
    chipFamily: chip.family,
    cpuCores: totalCpuCores(chip),
    gpuCores: chip.gpuCores,
    ramGb: listing.ramGb,
    ssdGb: listing.ssdGb,
  });
}

/** Best-ranked listing in each price band. */
export function pickPriceBands(
  ranked: readonly Scored[],
  profile: Profile,
): readonly PriceBandPick[] {
  return profile.priceBands.map(band => {
    const pick = ranked.find(
      entry =>
        entry.priceGbp >= band.minGbp &&
        (band.maxGbp === null || entry.priceGbp < band.maxGbp),
    );
    return {
      bandId: band.id,
      label: band.label,
      minGbp: band.minGbp,
      maxGbp: band.maxGbp,
      listingId: pick?.id ?? null,
    };
  });
}

/** Re-scores with external storage added to every desktop. */
export function storageSensitivity(
  eligible: readonly Eligible[],
  baseline: readonly Scored[],
  profile: Profile,
): StorageSensitivity {
  const external = profile.externalStorage;
  const adjustedIds = new Set<string>();
  const inputs = eligible.map(({listing, input}) => {
    if (listing.formFactor !== 'desktop') {
      return input;
    }
    adjustedIds.add(listing.id);
    return {
      ...input,
      priceGbp: input.priceGbp + external.priceGbp,
      usableStorageGb: input.usableStorageGb + external.capacityGb,
    };
  });
  const inputById = new Map(inputs.map(input => [input.id, input]));
  const baselineRank = new Map(
    baseline.map((entry, position) => [entry.id, position + 1]),
  );
  const ranked = rank(scoreListings(inputs, profile));
  const entries = ranked.map((entry, position) => ({
    listingId: entry.id,
    baselineRank: must(baselineRank.get(entry.id), 'baseline rank'),
    rank: position + 1,
    adjusted: adjustedIds.has(entry.id),
    priceGbp: entry.priceGbp,
    usableStorageGb: must(inputById.get(entry.id), 'score input')
      .usableStorageGb,
    capabilityScore: entry.capabilityScore,
    valueScore: entry.valueScore,
  }));
  const winner = ranked[0]?.id ?? null;
  const baselineWinner = baseline[0]?.id ?? null;
  const winnerChanged = winner !== baselineWinner;
  const names = new Map(
    eligible.map(item => [item.listing.id, nameOf(item.listing, item.chip)]),
  );
  const scenario = `Adding a ${formatStorage(external.capacityGb)} external SSD (${formatGbp(external.priceGbp)}) to every desktop`;
  let summary = `${scenario} leaves no listing to rank.`;
  if (winner !== null) {
    const winnerName = must(names.get(winner), 'winner name');
    summary = winnerChanged
      ? `${scenario} changes the best option to ${winnerName}.`
      : `${scenario} does not change the best option, ${winnerName}.`;
  }
  return {
    externalStorage: external,
    entries,
    top10: ranked.slice(0, TOP_COUNT).map(entry => entry.id),
    winnerChanged,
    summary,
  };
}

function chipFor(
  listing: Listing,
  chips: ReadonlyMap<string, ChipVariant>,
): ChipVariant {
  const chip = chips.get(listing.chipId);
  if (chip === undefined) {
    throw new ScoringError(
      `Listing ${listing.id} refers to unknown chip "${listing.chipId}".`,
    );
  }
  return chip;
}

interface ProfileOutcome {
  readonly result: ProfileResult;
  readonly eligible: readonly Eligible[];
}

function scoreProfile(
  listings: readonly Listing[],
  chips: ReadonlyMap<string, ChipVariant>,
  profile: Profile,
): ProfileOutcome {
  const eligible: Eligible[] = [];
  const exclusions: Exclusion[] = [];
  for (const listing of listings) {
    const chip = chipFor(listing, chips);
    const classified = classify(listing, chip, profile);
    if (classified.kind === 'eligible') {
      eligible.push(classified.eligible);
    } else {
      exclusions.push(classified.exclusion);
    }
  }
  const scored = scoreListings(
    eligible.map(item => item.input),
    profile,
  );
  const ranked = rank(scored);
  const pareto = new Set(paretoFrontier(scored));
  const eligibleById = new Map(eligible.map(item => [item.listing.id, item]));
  const smallestClass = smallestClassHeadroom(profile);

  const ranking: RankedListing[] = [];
  for (const [position, entry] of ranked.entries()) {
    const item = must(eligibleById.get(entry.id), 'ranked listing');
    const derived = deriveMetrics(
      {
        ramGb: item.listing.ramGb,
        ssdGb: item.listing.ssdGb,
        priceGbp: item.listing.priceGbp,
        multiCore: item.input.multiCore,
      },
      profile,
    );
    ranking.push({
      listingId: entry.id,
      rank: position + 1,
      capabilityScore: entry.capabilityScore,
      valueScore: entry.valueScore,
      components: entry.components,
      derived,
      isParetoOptimal: pareto.has(entry.id),
      isTop10: position < TOP_COUNT,
      summary: summaryLine({
        model: item.listing.model,
        chipFamily: item.chip.family,
        cpuCores: totalCpuCores(item.chip),
        gpuCores: item.chip.gpuCores,
        ramGb: item.listing.ramGb,
        ssdGb: item.listing.ssdGb,
        condition: item.listing.condition,
        priceGbp: item.listing.priceGbp,
        multiCore: item.input.multiCore,
        modelClass: derived.modelClass,
        fitsSmallestClass: derived.memoryHeadroomGb >= smallestClass,
        usableStorageGb: derived.usableStorageGb,
      }),
    });
  }

  return {
    eligible,
    result: {
      profile,
      ranking,
      top10: ranking.slice(0, TOP_COUNT).map(entry => entry.listingId),
      paretoFrontier: ranking
        .filter(entry => entry.isParetoOptimal)
        .map(entry => entry.listingId),
      priceBandPicks: [...pickPriceBands(ranked, profile)],
      exclusions: exclusions.sort((a, b) =>
        a.listingId < b.listingId ? -1 : a.listingId > b.listingId ? 1 : 0,
      ),
      storageSensitivity: storageSensitivity(eligible, ranked, profile),
      // Filled in once stability across profiles is known.
      conclusion: {winnerListingId: null, text: NO_LISTINGS_CONCLUSION},
    },
  };
}

function conclude(
  outcome: ProfileOutcome,
  stable: ReadonlySet<string>,
  profileCount: number,
): ProfileResult {
  const {result, eligible} = outcome;
  const [winner, second] = result.ranking;
  if (winner === undefined) {
    return result;
  }
  const find = (id: string): Eligible =>
    must(
      eligible.find(candidate => candidate.listing.id === id),
      'ranked listing',
    );
  const item = find(winner.listingId);
  const runnerUpItem =
    second === undefined ? undefined : find(second.listingId);
  const smallestClass = smallestClassHeadroom(result.profile);
  return {
    ...result,
    conclusion: {
      winnerListingId: winner.listingId,
      text: conclusionText({
        model: item.listing.model,
        chipFamily: item.chip.family,
        cpuCores: totalCpuCores(item.chip),
        gpuCores: item.chip.gpuCores,
        ramGb: item.listing.ramGb,
        ssdGb: item.listing.ssdGb,
        condition: item.listing.condition,
        priceGbp: item.listing.priceGbp,
        multiCore: item.input.multiCore,
        modelClass: winner.derived.modelClass,
        fitsSmallestClass: winner.derived.memoryHeadroomGb >= smallestClass,
        usableStorageGb: winner.derived.usableStorageGb,
        seller: item.listing.seller,
        profileName: result.profile.name,
        capabilityScore: winner.capabilityScore,
        valueScore: winner.valueScore,
        isStable: stable.has(winner.listingId),
        profileCount,
        runnerUp:
          runnerUpItem === undefined
            ? null
            : {
                name: nameOf(runnerUpItem.listing, runnerUpItem.chip),
                priceGbp: runnerUpItem.listing.priceGbp,
              },
      }),
    },
  };
}

/** Listings in the top 10 under every profile, in id order. */
export function stableListingIds(
  results: readonly Pick<ProfileResult, 'top10'>[],
): readonly string[] {
  const [first, ...rest] = results;
  if (first === undefined) {
    return [];
  }
  return first.top10
    .filter(id => rest.every(result => result.top10.includes(id)))
    .sort();
}

/** Savings for each configuration sold both new and in another condition. */
export function compareNewWithRefurbished(
  listings: readonly Listing[],
  chips: ReadonlyMap<string, ChipVariant>,
): readonly NewVersusRefurbished[] {
  const groups = new Map<string, Listing[]>();
  for (const listing of listings) {
    const key = [
      listing.model,
      listing.chipId,
      String(listing.ramGb).padStart(6, '0'),
      String(listing.ssdGb).padStart(6, '0'),
    ].join('|');
    groups.set(key, [...(groups.get(key) ?? []), listing]);
  }
  const byPrice = (a: Listing, b: Listing): number =>
    a.priceGbp !== b.priceGbp ? a.priceGbp - b.priceGbp : byId(a, b);
  const comparisons: NewVersusRefurbished[] = [];
  const sortedGroups = [...groups.entries()].sort(([a], [b]) =>
    a < b ? -1 : 1,
  );
  for (const [, group] of sortedGroups) {
    const cheapestNew = group
      .filter(l => l.condition === 'new')
      .sort(byPrice)[0];
    const others = group.filter(l => l.condition !== 'new').sort(byPrice);
    if (cheapestNew === undefined || others.length === 0) {
      continue;
    }
    const chip = chipFor(cheapestNew, chips);
    comparisons.push({
      model: cheapestNew.model,
      chipId: cheapestNew.chipId,
      chipLabel: chipLabel(chip.family, totalCpuCores(chip), chip.gpuCores),
      ramGb: cheapestNew.ramGb,
      ssdGb: cheapestNew.ssdGb,
      newListingId: cheapestNew.id,
      newPriceGbp: cheapestNew.priceGbp,
      alternatives: others.map(other => {
        const savingPence = Math.round(
          (cheapestNew.priceGbp - other.priceGbp) * 100,
        );
        return {
          listingId: other.id,
          condition: other.condition,
          seller: other.seller,
          priceGbp: other.priceGbp,
          savingGbp: savingPence / 100,
          savingPercent: (savingPence / 100 / cheapestNew.priceGbp) * 100,
        };
      }),
    });
  }
  return comparisons;
}

function stabilitySummary(count: number, profileCount: number): string {
  if (count === 0) {
    return `No listing is in the top 10 under all ${profileCount} profiles.`;
  }
  const noun = count === 1 ? 'listing is' : 'listings are';
  return `${count} ${noun} in the top 10 under all ${profileCount} profiles.`;
}

/** Scores a snapshot under every profile. */
export function buildResults(
  snapshot: ListingSnapshot,
  chipsFile: ChipsFile,
  profiles: readonly Profile[],
): Results {
  const defaults = profiles.filter(profile => profile.isDefault);
  const [defaultProfile] = defaults;
  if (defaultProfile === undefined || defaults.length !== 1) {
    throw new ScoringError(
      `Exactly one profile must be the default; found ${defaults.length}.`,
    );
  }
  const chips = new Map(chipsFile.chips.map(chip => [chip.id, chip]));
  const listings = [...snapshot.listings].sort(byId);
  const ordered = [
    defaultProfile,
    ...profiles.filter(profile => !profile.isDefault).sort(byId),
  ];
  const outcomes = ordered.map(profile =>
    scoreProfile(listings, chips, profile),
  );
  const stableIds = stableListingIds(outcomes.map(outcome => outcome.result));
  const stable = new Set(stableIds);
  const usedChipIds = new Set(listings.map(listing => listing.chipId));

  const resultListings: ResultListing[] = listings.map(listing => ({
    ...listing,
    chip: toListingChip(chipFor(listing, chips)),
    isStable: stable.has(listing.id),
  }));

  return {
    schemaVersion: 1,
    snapshotDate: snapshot.snapshotDate,
    geekbenchVersion: chipsFile.geekbenchVersion,
    defaultProfileId: defaultProfile.id,
    normalisation: {
      method: 'divide-by-snapshot-best',
      description:
        'Each metric is divided by the best value of that metric among the listings ranked under the profile, giving zero to one.',
    },
    listings: resultListings,
    profiles: outcomes.map(outcome =>
      conclude(outcome, stable, ordered.length),
    ),
    stability: {
      profileIds: ordered.map(profile => profile.id),
      stableListingIds: [...stableIds],
      summary: stabilitySummary(stableIds.length, ordered.length),
    },
    newVersusRefurbished: [...compareNewWithRefurbished(listings, chips)],
    chips: chipsFile.chips.filter(chip => usedChipIds.has(chip.id)).sort(byId),
    sources: [...snapshot.sourceStatus].sort((a, b) =>
      a.adapterId < b.adapterId ? -1 : a.adapterId > b.adapterId ? 1 : 0,
    ),
  };
}
