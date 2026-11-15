import {describe, expect, it} from 'vitest';

import {
  formatIssues,
  resultsSchema,
  sampleChip,
  sampleListing,
  sampleProfile,
  sampleSourceStatus,
} from './index.js';
import type {RankedListing, Results} from './index.js';

const component = {raw: 1, normalised: 1, weighted: 20};

function ranked(listingId: string, rank: number): RankedListing {
  return {
    listingId,
    rank,
    capabilityScore: 100,
    valueScore: 50,
    components: {
      multiCore: component,
      memoryHeadroom: component,
      gpuAndBandwidth: component,
      singleCore: component,
      usableStorage: component,
    },
    derived: {
      memoryHeadroomGb: 36,
      modelClass: '32B',
      usableStorageGb: 850,
      gbpPer1000MultiCore: 100,
      gbpPerGbRam: 41.6,
      gbpPerGbUsableStorage: null,
    },
    isParetoOptimal: true,
    isTop10: true,
    summary: 'A summary line.',
  };
}

const A = '00000000000000a1';
const B = '00000000000000a2';

function sampleResults(): Results {
  const profile = sampleProfile();
  const chip = {
    family: 'M4 Pro',
    generation: 4,
    cpuCores: 12,
    performanceCores: 8,
    efficiencyCores: 4,
    gpuCores: 16,
    label: 'M4 Pro (12-core CPU, 16-core GPU)',
    singleCore: 3800,
    multiCore: 20000,
    metal: 100000,
    memoryBandwidthGbPerSec: 273,
    maxMemoryGb: 64,
  };
  return {
    schemaVersion: 1,
    snapshotDate: '2026-01-05',
    geekbenchVersion: '6',
    defaultProfileId: profile.id,
    normalisation: {
      method: 'divide-by-snapshot-best',
      description: 'Each metric is divided by the best value.',
    },
    listings: [
      {...sampleListing({id: A}), chip, isStable: true},
      {...sampleListing({id: B, ramGb: 8}), chip, isStable: false},
    ],
    profiles: [
      {
        profile,
        ranking: [ranked(A, 1)],
        top10: [A],
        paretoFrontier: [A],
        priceBandPicks: [
          {
            bandId: 'under-1000',
            label: 'Under £1,000',
            minGbp: 0,
            maxGbp: 1000,
            listingId: null,
          },
        ],
        exclusions: [
          {listingId: B, reason: 'below-ram-floor', detail: 'Too little RAM.'},
        ],
        storageSensitivity: {
          externalStorage: profile.externalStorage,
          entries: [
            {
              listingId: A,
              baselineRank: 1,
              rank: 1,
              adjusted: true,
              priceGbp: 2299,
              usableStorageGb: 2850,
              capabilityScore: 100,
              valueScore: 43.5,
            },
          ],
          top10: [A],
          winnerChanged: false,
          summary: 'No change.',
        },
        conclusion: {winnerListingId: A, text: 'A is best.'},
      },
    ],
    stability: {
      profileIds: [profile.id],
      stableListingIds: [A],
      summary: 'One listing is stable.',
    },
    newVersusRefurbished: [],
    chips: [sampleChip()],
    sources: [sampleSourceStatus()],
  };
}

function issues(results: unknown): readonly string[] {
  const parsed = resultsSchema.safeParse(results);
  return parsed.success ? [] : formatIssues(parsed.error);
}

describe('results.json', () => {
  it('accepts a valid document', () => {
    expect(issues(sampleResults())).toEqual([]);
  });

  it('rejects an unknown default profile and duplicate profiles', () => {
    const results = sampleResults();
    const [profile] = results.profiles;
    expect(issues({...results, defaultProfileId: 'missing'})).toEqual([
      'defaultProfileId: defaultProfileId must match a profile',
    ]);
    expect(issues({...results, profiles: [profile, profile]})).toEqual([
      'profiles: duplicate profile id "secondary-dev-llm"',
    ]);
  });

  it('rejects references to listings that are not in the document', () => {
    const results = sampleResults();
    expect(
      issues({...results, listings: results.listings.slice(0, 1)}),
    ).toEqual([`profiles.0: unknown listing id "${B}"`]);
  });

  it('rejects a listing that is both ranked and excluded', () => {
    const results = sampleResults();
    const [profile] = results.profiles;
    expect(
      issues({
        ...results,
        profiles: [
          {
            ...profile,
            exclusions: [
              {listingId: A, reason: 'below-ssd-floor', detail: 'Too small.'},
            ],
          },
        ],
      }),
    ).toEqual([
      `profiles.0: listing "${A}" is ranked or excluded more than once`,
    ]);
  });

  it('rejects a ranking that is out of order', () => {
    const results = sampleResults();
    const [profile] = results.profiles;
    expect(
      issues({
        ...results,
        profiles: [
          {...profile, ranking: [ranked(B, 2), ranked(A, 1)], exclusions: []},
        ],
      }),
    ).toEqual([
      'profiles.0.ranking: ranking must be ordered by rank, starting at 1',
    ]);
  });

  it('rejects scores outside their bounds and unknown keys', () => {
    const results = sampleResults();
    const [profile] = results.profiles;
    expect(
      issues({
        ...results,
        profiles: [
          {...profile, ranking: [{...ranked(A, 1), capabilityScore: 101}]},
        ],
      }),
    ).toHaveLength(1);
    expect(issues({...results, extra: 1})).toHaveLength(1);
  });
});
