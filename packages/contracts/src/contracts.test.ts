import {describe, expect, it} from 'vitest';
import {z} from 'zod';

import {
  assertSupportedSchemaVersion,
  chipCoreKey,
  chipsFileSchema,
  ContractError,
  findDuplicates,
  formatIssues,
  gbpSchema,
  isWholePence,
  listingSchema,
  listingSnapshotSchema,
  parseContract,
  profileSchema,
  resultsIndexSchema,
  sampleChip,
  sampleChipsFile,
  sampleListing,
  sampleProfile,
  sampleSnapshot,
  sampleSourceStatus,
  totalCpuCores,
} from './index.js';

function messages(result: z.ZodSafeParseResult<unknown>): readonly string[] {
  return result.success ? [] : formatIssues(result.error);
}

describe('common', () => {
  it('accepts whole pence and rejects fractions of a penny', () => {
    expect(isWholePence(1019)).toBe(true);
    expect(isWholePence(1019.99)).toBe(true);
    expect(isWholePence(0.1 + 0.2)).toBe(true);
    expect(isWholePence(10.005)).toBe(false);
    expect(gbpSchema.safeParse(10.005).success).toBe(false);
    expect(gbpSchema.safeParse(0).success).toBe(false);
    expect(gbpSchema.safeParse(-5).success).toBe(false);
  });

  it('finds duplicates in first-seen order', () => {
    expect(findDuplicates(['a', 'b', 'a', 'c', 'b', 'a'])).toEqual(['a', 'b']);
    expect(findDuplicates([])).toEqual([]);
  });
});

describe('chips.json', () => {
  it('accepts a valid file', () => {
    expect(chipsFileSchema.safeParse(sampleChipsFile()).success).toBe(true);
  });

  it('allows null benchmark scores', () => {
    const chip = sampleChip({
      geekbench: {singleCore: null, multiCore: null, metal: null},
      memoryBandwidthGbPerSec: null,
    });
    expect(chipsFileSchema.safeParse(sampleChipsFile([chip])).success).toBe(
      true,
    );
  });

  it('rejects duplicate ids and duplicate core variants', () => {
    const result = chipsFileSchema.safeParse(
      sampleChipsFile([sampleChip(), sampleChip()]),
    );
    expect(messages(result)).toEqual([
      'chips: duplicate chip id "m4-pro-12c-16g"',
      'chips: duplicate chip variant "m4 pro|12|16"',
    ]);
  });

  it('rejects a chip without a source, and unknown keys', () => {
    expect(
      chipsFileSchema.safeParse(sampleChipsFile([sampleChip({sources: []})]))
        .success,
    ).toBe(false);
    expect(
      chipsFileSchema.safeParse({...sampleChipsFile(), extra: true}).success,
    ).toBe(false);
  });

  it('rejects a core split that does not sum to the total', () => {
    const chip = sampleChip({
      cpuCores: {total: 12, performance: 8, efficiency: 2},
    });
    expect(
      messages(chipsFileSchema.safeParse(sampleChipsFile([chip]))),
    ).toEqual([
      'chips.0.cpuCores: performance and efficiency cores must sum to total',
    ]);
    const unknownSplit = sampleChip({
      cpuCores: {total: 16, performance: null, efficiency: null},
    });
    expect(
      chipsFileSchema.safeParse(sampleChipsFile([unknownSplit])).success,
    ).toBe(true);
  });

  it('derives core totals and keys', () => {
    expect(totalCpuCores(sampleChip())).toBe(12);
    expect(chipCoreKey('M4 Pro', 12, 16)).toBe('m4 pro|12|16');
  });
});

describe('listing snapshot', () => {
  it('accepts a valid snapshot', () => {
    expect(listingSnapshotSchema.safeParse(sampleSnapshot()).success).toBe(
      true,
    );
  });

  it.each([
    ['a zero price', {priceGbp: 0}],
    ['a negative price', {priceGbp: -1}],
    ['a fraction of a penny', {priceGbp: 999.999}],
    ['a non-https source', {sourceUrl: 'http://example.com/a'}],
    ['a malformed date', {retrievedDate: '05/01/2026'}],
    ['an impossible date', {retrievedDate: '2026-02-30'}],
    ['an unknown condition', {condition: 'used'}],
    ['a malformed id', {id: 'XYZ'}],
    ['zero RAM', {ramGb: 0}],
  ])('rejects %s', (_name, overrides) => {
    expect(
      listingSchema.safeParse({...sampleListing(), ...overrides}).success,
    ).toBe(false);
  });

  it('rejects duplicate listing and adapter ids', () => {
    const result = listingSnapshotSchema.safeParse(
      sampleSnapshot([sampleListing(), sampleListing()], {
        sourceStatus: [sampleSourceStatus(), sampleSourceStatus()],
      }),
    );
    expect(messages(result)).toEqual([
      'listings: duplicate listing id "0123456789abcdef"',
      'sourceStatus: duplicate adapter id "apple-uk-new"',
    ]);
  });
});

describe('profile', () => {
  it('accepts a valid profile', () => {
    expect(profileSchema.safeParse(sampleProfile()).success).toBe(true);
  });

  it('rejects weights that do not sum to 100', () => {
    const profile = sampleProfile();
    const result = profileSchema.safeParse({
      ...profile,
      weights: {...profile.weights, multiCore: 31},
    });
    expect(messages(result)).toEqual(['weights: weights must sum to 100']);
  });

  it('rejects a GPU and bandwidth split that does not sum to 100', () => {
    const result = profileSchema.safeParse(
      sampleProfile({gpuAndBandwidthSplit: {metal: 60, memoryBandwidth: 50}}),
    );
    expect(messages(result)).toEqual([
      'gpuAndBandwidthSplit: split must sum to 100',
    ]);
  });

  it('rejects model classes out of order', () => {
    const profile = sampleProfile();
    const result = profileSchema.safeParse({
      ...profile,
      modelClasses: [...profile.modelClasses].reverse(),
    });
    expect(messages(result)).toEqual([
      'modelClasses: model classes must be in ascending order of minHeadroomGb',
    ]);
  });

  it('rejects duplicate and inverted price bands', () => {
    const result = profileSchema.safeParse(
      sampleProfile({
        priceBands: [
          {id: 'a', label: 'A', minGbp: 0, maxGbp: 1000},
          {id: 'a', label: 'B', minGbp: 2000, maxGbp: 1000},
        ],
      }),
    );
    expect(messages(result)).toEqual([
      'priceBands: duplicate price band id "a"',
      'priceBands.1: maxGbp must be greater than minGbp',
    ]);
  });
});

describe('results/index.json', () => {
  it('accepts a valid index', () => {
    expect(
      resultsIndexSchema.safeParse({
        schemaVersion: 1,
        latest: '2026-01-12',
        snapshots: ['2026-01-05', '2026-01-12'],
      }).success,
    ).toBe(true);
  });

  it('rejects duplicates, bad order and a wrong latest', () => {
    const result = resultsIndexSchema.safeParse({
      schemaVersion: 1,
      latest: '2026-01-05',
      snapshots: ['2026-01-12', '2026-01-05', '2026-01-12'],
    });
    expect(messages(result)).toEqual([
      'snapshots: duplicate snapshot "2026-01-12"',
      'snapshots: snapshots must be sorted oldest first',
      'latest: latest must be the most recent snapshot',
    ]);
  });
});

describe('parseContract', () => {
  it('returns parsed data', () => {
    expect(parseContract(z.number(), 3, 'x.json')).toBe(3);
  });

  it('names the file and the failing field', () => {
    const attempt = () =>
      parseContract(
        listingSchema,
        {...sampleListing(), priceGbp: 'free'},
        'data/listings/2026-01-05.json',
      );
    expect(attempt).toThrow(ContractError);
    expect(attempt).toThrow(/data\/listings\/2026-01-05\.json/);
    expect(attempt).toThrow(/priceGbp/);
  });

  it('labels root-level issues', () => {
    const result = z.number().safeParse('x');
    expect(messages(result)[0]).toMatch(/^\(root\): /);
  });
});

describe('assertSupportedSchemaVersion', () => {
  it('accepts a supported version', () => {
    expect(() => {
      assertSupportedSchemaVersion({schemaVersion: 1}, 'a.json');
    }).not.toThrow();
  });

  it.each([[{schemaVersion: 2}], [{schemaVersion: '1'}], [{}], [null], [7]])(
    'rejects %j',
    data => {
      expect(() => {
        assertSupportedSchemaVersion(data, 'a.json');
      }).toThrow(/a\.json failed validation:\n {2}schemaVersion: unsupported/);
    },
  );
});
