import {
  resultsSchema,
  sampleChip,
  sampleListing,
  sampleProfile,
  sampleSnapshot,
} from '@mvi/contracts';
import type {ProfileResult, Results} from '@mvi/contracts';
import fc from 'fast-check';
import {describe, expect, it} from 'vitest';

import {
  buildResults,
  classify,
  compareNewWithRefurbished,
  must,
  pickPriceBands,
  ScoringError,
  stableListingIds,
} from './build-results.js';
import {
  CHIPS,
  CHIPS_FILE,
  IDS,
  listing,
  LISTINGS,
  PROFILES,
  SNAPSHOT,
} from './test-data.js';
import {NO_LISTINGS_CONCLUSION} from './text.js';

const results = buildResults(SNAPSHOT, CHIPS_FILE, PROFILES);

function profileResult(source: Results, id: string): ProfileResult {
  const found = source.profiles.find(result => result.profile.id === id);
  if (found === undefined) {
    throw new Error(`no profile ${id}`);
  }
  return found;
}

const defaults = profileResult(results, 'secondary-dev-llm');

describe('buildResults', () => {
  it('produces a document that passes the contract', () => {
    expect(resultsSchema.safeParse(results).success).toBe(true);
    expect(results.snapshotDate).toBe('2026-01-05');
    expect(results.geekbenchVersion).toBe('6');
  });

  it('puts the default profile first, then the rest by id', () => {
    expect(results.profiles.map(result => result.profile.id)).toEqual([
      'secondary-dev-llm',
      'cpu-heavy',
      'memory-heavy',
    ]);
    expect(results.defaultProfileId).toBe('secondary-dev-llm');
  });

  it('ranks by value score and numbers ranks from 1', () => {
    expect(defaults.ranking.map(entry => entry.rank)).toEqual([1, 2, 3, 4, 5]);
    const values = defaults.ranking.map(entry => entry.valueScore);
    expect([...values].sort((a, b) => b - a)).toEqual(values);
    expect(defaults.ranking[0]?.listingId).toBe(IDS.miniBase);
  });

  it('excludes listings with the reason', () => {
    expect(defaults.exclusions).toEqual([
      {
        listingId: IDS.miniLowRam,
        reason: 'below-ram-floor',
        detail: '8 GB RAM is below the 16 GB floor.',
      },
      {
        listingId: IDS.miniLowSsd,
        reason: 'below-ssd-floor',
        detail: '256GB SSD is below the 512GB floor.',
      },
      {
        listingId: IDS.studioUltra,
        reason: 'missing-benchmark',
        detail: 'No verified Geekbench Metal score for m5-ultra-30c-64g.',
      },
      {
        listingId: IDS.imacNoBandwidth,
        reason: 'missing-memory-bandwidth',
        detail: 'No verified memory bandwidth figure for m6-10c-10g.',
      },
    ]);
  });

  it('keeps every listing, ranked or excluded, with its chip figures', () => {
    expect(results.listings).toHaveLength(LISTINGS.length);
    const studio = results.listings.find(l => l.id === IDS.studioUltra);
    expect(studio?.chip).toMatchObject({
      label: 'M5 Ultra (30-core CPU, 64-core GPU)',
      metal: null,
      maxMemoryGb: null,
    });
  });

  it('flags the Pareto frontier and the top 10', () => {
    expect(defaults.paretoFrontier).toEqual(
      defaults.ranking.filter(e => e.isParetoOptimal).map(e => e.listingId),
    );
    expect(defaults.paretoFrontier).toContain(IDS.miniBase);
    expect(defaults.paretoFrontier).toContain(IDS.macbookMax);
    expect(defaults.paretoFrontier).not.toContain(IDS.miniProNew);
    expect(defaults.top10).toHaveLength(5);
    expect(defaults.ranking.every(entry => entry.isTop10)).toBe(true);
  });

  it('picks the best listing in each price band', () => {
    expect(defaults.priceBandPicks.map(pick => pick.listingId)).toEqual([
      IDS.miniBase,
      IDS.miniProRefurbished,
      IDS.miniProThirdParty,
      IDS.macbookMax,
    ]);
  });

  it('writes a summary line and a conclusion from the figures', () => {
    expect(defaults.ranking[0]?.summary).toBe(
      'Mac mini M4 10/10-core 16GB 512GB (new) is £799, scores 14,978 multi-core, runs only models below 7B, and stores 362 GB usable.',
    );
    expect(defaults.conclusion.winnerListingId).toBe(IDS.miniBase);
    expect(defaults.conclusion.text).toContain(
      'Mac mini M4 10/10-core 16GB 512GB (new) at £799 from Apple UK is the best value',
    );
  });

  it('reports stability across all profiles', () => {
    expect(results.stability.profileIds).toHaveLength(3);
    expect(results.stability.stableListingIds).toHaveLength(5);
    expect(results.stability.summary).toBe(
      '5 listings are in the top 10 under all 3 profiles.',
    );
    expect(results.listings.find(l => l.id === IDS.miniBase)?.isStable).toBe(
      true,
    );
    expect(results.listings.find(l => l.id === IDS.miniLowRam)?.isStable).toBe(
      false,
    );
  });

  it('re-scores desktops with external storage', () => {
    const sensitivity = defaults.storageSensitivity;
    const mini = sensitivity.entries.find(e => e.listingId === IDS.miniBase);
    expect(mini).toMatchObject({
      adjusted: true,
      priceGbp: 1099,
      usableStorageGb: 2362,
      baselineRank: 1,
    });
    const laptop = sensitivity.entries.find(
      e => e.listingId === IDS.macbookMax,
    );
    expect(laptop).toMatchObject({adjusted: false, priceGbp: 5199.5});
    expect(sensitivity.entries.map(entry => entry.rank)).toEqual([
      1, 2, 3, 4, 5,
    ]);
    expect(sensitivity.summary).toMatch(
      /^Adding a 2TB external SSD \(£300\) to every desktop (does not change|changes) the best option/,
    );
  });

  it('compares new with refurbished prices', () => {
    expect(results.newVersusRefurbished).toEqual([
      {
        model: 'Mac mini',
        chipId: 'm4-pro-12c-16g',
        chipLabel: 'M4 Pro (12-core CPU, 16-core GPU)',
        ramGb: 48,
        ssdGb: 1000,
        newListingId: IDS.miniProNew,
        newPriceGbp: 1999,
        alternatives: [
          {
            listingId: IDS.miniProRefurbished,
            condition: 'apple-refurbished',
            seller: 'Apple UK',
            priceGbp: 1699,
            savingGbp: 300,
            savingPercent: (300 / 1999) * 100,
          },
          {
            listingId: IDS.miniProThirdParty,
            condition: 'third-party-refurbished',
            seller: 'Example Refurb',
            priceGbp: 2099,
            savingGbp: -100,
            savingPercent: (-100 / 1999) * 100,
          },
        ],
      },
    ]);
  });

  it('includes only the chips in use, and the sources', () => {
    expect(results.chips.map(chip => chip.id)).toEqual([
      'm4-10c-10g',
      'm4-max-16c-40g',
      'm4-pro-12c-16g',
      'm5-ultra-30c-64g',
      'm6-10c-10g',
    ]);
    expect(results.sources.map(source => source.adapterId)).toEqual([
      'apple-uk-new',
      'example-refurb',
    ]);
  });

  it('is deterministic and independent of input order', () => {
    const shuffled = sampleSnapshot([...LISTINGS].reverse(), {
      sourceStatus: [...SNAPSHOT.sourceStatus].reverse(),
    });
    const again = buildResults(shuffled, CHIPS_FILE, [...PROFILES].reverse());
    expect(JSON.stringify(again)).toBe(JSON.stringify(results));
  });
});

describe('edge cases', () => {
  it('handles a single listing', () => {
    const single = buildResults(sampleSnapshot([sampleListing()]), CHIPS_FILE, [
      sampleProfile(),
    ]);
    const [result] = single.profiles;
    expect(result?.ranking).toHaveLength(1);
    expect(result?.ranking[0]?.capabilityScore).toBe(100);
    expect(result?.conclusion.text).not.toContain('runner-up');
    expect(single.stability.summary).toBe(
      '1 listing is in the top 10 under all 1 profiles.',
    );
  });

  it('handles a snapshot where nothing can be ranked', () => {
    const empty = buildResults(
      sampleSnapshot([sampleListing({ramGb: 8})]),
      CHIPS_FILE,
      PROFILES,
    );
    const [result] = empty.profiles;
    expect(result?.ranking).toEqual([]);
    expect(result?.conclusion).toEqual({
      winnerListingId: null,
      text: NO_LISTINGS_CONCLUSION,
    });
    expect(result?.priceBandPicks.every(p => p.listingId === null)).toBe(true);
    expect(result?.storageSensitivity.summary).toContain(
      'leaves no listing to rank',
    );
    expect(empty.stability.summary).toBe(
      'No listing is in the top 10 under all 3 profiles.',
    );
    expect(resultsSchema.safeParse(empty).success).toBe(true);
  });

  it('breaks exact ties on listing id', () => {
    const twins = [
      sampleListing({id: '00000000000000b2'}),
      sampleListing({id: '00000000000000b1'}),
    ];
    const tied = buildResults(sampleSnapshot(twins), CHIPS_FILE, [
      sampleProfile(),
    ]);
    expect(tied.profiles[0]?.ranking.map(entry => entry.listingId)).toEqual([
      '00000000000000b1',
      '00000000000000b2',
    ]);
  });

  it('caps the top 10 at ten listings', () => {
    const many = Array.from({length: 14}, (_, index) =>
      listing({priceGbp: 1500 + index * 10}),
    );
    const result = buildResults(sampleSnapshot(many), CHIPS_FILE, [
      sampleProfile(),
    ]).profiles[0];
    expect(result?.top10).toHaveLength(10);
    expect(result?.ranking.filter(entry => entry.isTop10)).toHaveLength(10);
    expect(result?.storageSensitivity.top10).toHaveLength(10);
  });

  it('rejects profiles without exactly one default', () => {
    expect(() =>
      buildResults(SNAPSHOT, CHIPS_FILE, [sampleProfile({isDefault: false})]),
    ).toThrow(ScoringError);
    expect(() =>
      buildResults(SNAPSHOT, CHIPS_FILE, [
        sampleProfile(),
        sampleProfile({id: 'other'}),
      ]),
    ).toThrow(/found 2/);
  });

  it('rejects a listing whose chip is unknown', () => {
    expect(() =>
      buildResults(
        sampleSnapshot([sampleListing({chipId: 'm9-99c-99g'})]),
        CHIPS_FILE,
        PROFILES,
      ),
    ).toThrow(/unknown chip "m9-99c-99g"/);
  });

  it('reports a changed winner in the sensitivity summary', () => {
    const laptop = listing({
      model: 'MacBook Pro 14-inch',
      formFactor: 'laptop',
      priceGbp: 2010,
    });
    const desktop = listing({priceGbp: 2000});
    const result = buildResults(sampleSnapshot([laptop, desktop]), CHIPS_FILE, [
      sampleProfile(),
    ]).profiles[0];
    expect(result?.ranking[0]?.listingId).toBe(desktop.id);
    expect(result?.storageSensitivity.winnerChanged).toBe(true);
    expect(result?.storageSensitivity.summary).toContain(
      'changes the best option to MacBook Pro 14-inch',
    );

    const unchanged = buildResults(sampleSnapshot([desktop]), CHIPS_FILE, [
      sampleProfile(),
    ]).profiles[0];
    expect(unchanged?.storageSensitivity.winnerChanged).toBe(false);
    expect(unchanged?.storageSensitivity.summary).toContain(
      'does not change the best option, Mac mini',
    );
  });
});

describe('classify', () => {
  const chip = sampleChip();
  const profile = sampleProfile();

  it('accepts a listing with every metric', () => {
    expect(classify(sampleListing(), chip, profile).kind).toBe('eligible');
  });

  it('names every missing benchmark', () => {
    const blank = sampleChip({
      geekbench: {singleCore: null, multiCore: null, metal: null},
    });
    const outcome = classify(sampleListing(), blank, profile);
    expect(outcome).toMatchObject({
      kind: 'excluded',
      exclusion: {
        reason: 'missing-benchmark',
        detail:
          'No verified Geekbench multi-core, single-core, Metal score for m4-pro-12c-16g.',
      },
    });
  });

  it('does not require a metric whose weight is zero', () => {
    const noGpu = sampleProfile({
      weights: {
        multiCore: 45,
        memoryHeadroom: 35,
        gpuAndBandwidth: 0,
        singleCore: 0,
        usableStorage: 20,
      },
    });
    const sparse = sampleChip({
      geekbench: {singleCore: null, multiCore: 20000, metal: null},
      memoryBandwidthGbPerSec: null,
    });
    expect(classify(sampleListing(), sparse, noGpu).kind).toBe('eligible');
    const metalOnly = sampleProfile({
      gpuAndBandwidthSplit: {metal: 100, memoryBandwidth: 0},
    });
    expect(
      classify(
        sampleListing(),
        sampleChip({memoryBandwidthGbPerSec: null}),
        metalOnly,
      ).kind,
    ).toBe('eligible');
  });
});

describe('helpers', () => {
  it('raises when an internal lookup has no match', () => {
    expect(must(0, 'zero')).toBe(0);
    expect(() => {
      must(undefined, 'thing');
    }).toThrow('Internal error: thing not found.');
  });

  it('finds listings in every top 10', () => {
    expect(
      stableListingIds([
        {top10: ['c', 'a', 'b']},
        {top10: ['b', 'c', 'd']},
        {top10: ['c', 'b']},
      ]),
    ).toEqual(['b', 'c']);
    expect(stableListingIds([])).toEqual([]);
  });

  it('treats band bounds as inclusive below and exclusive above', () => {
    const profile = sampleProfile();
    const at = (priceGbp: number) =>
      pickPriceBands(
        [
          {
            id: 'x',
            priceGbp,
            capabilityScore: 1,
            valueScore: 1,
            components:
              defaults.ranking[0]?.components ??
              (() => {
                throw new Error('no components');
              })(),
          },
        ],
        profile,
      ).find(pick => pick.listingId === 'x')?.bandId;
    expect(at(999.99)).toBe('under-1000');
    expect(at(1000)).toBe('1000-2000');
    expect(at(3500)).toBe('over-3500');
  });

  it('compares only configurations that are also sold new', () => {
    const chips = new Map(CHIPS.map(chip => [chip.id, chip]));
    expect(
      compareNewWithRefurbished(
        [
          sampleListing({
            id: '00000000000000c1',
            condition: 'apple-refurbished',
          }),
          sampleListing({id: '00000000000000c2', ramGb: 24}),
        ],
        chips,
      ),
    ).toEqual([]);
    const cheapestNew = compareNewWithRefurbished(
      [
        sampleListing({
          id: '00000000000000c3',
          seller: 'Retailer',
          priceGbp: 1899,
        }),
        sampleListing({id: '00000000000000c4'}),
        sampleListing({
          id: '00000000000000c5',
          condition: 'apple-refurbished',
          priceGbp: 1699,
        }),
      ],
      chips,
    );
    expect(cheapestNew[0]?.newListingId).toBe('00000000000000c3');
    expect(cheapestNew[0]?.alternatives[0]?.savingGbp).toBe(200);
  });
});

describe('properties', () => {
  it('never changes a listing’s derived metrics when another is added', () => {
    const extra = fc.record({
      ramGb: fc.constantFrom(16, 24, 32, 64, 128),
      ssdGb: fc.constantFrom(512, 1000, 2000, 4000),
      priceGbp: fc.integer({min: 500, max: 9000}),
      chipId: fc.constantFrom('m4-10c-10g', 'm4-pro-12c-16g', 'm4-max-16c-40g'),
    });
    fc.assert(
      fc.property(extra, addition => {
        const added = buildResults(
          sampleSnapshot([
            ...LISTINGS,
            sampleListing({id: 'ffffffffffffffff', ...addition}),
          ]),
          CHIPS_FILE,
          PROFILES,
        );
        const after = profileResult(added, 'secondary-dev-llm');
        for (const entry of defaults.ranking) {
          const same = after.ranking.find(e => e.listingId === entry.listingId);
          expect(same?.derived).toEqual(entry.derived);
          expect(same?.summary).toBe(entry.summary);
        }
        expect(resultsSchema.safeParse(added).success).toBe(true);
      }),
      {numRuns: 40},
    );
  });
});
