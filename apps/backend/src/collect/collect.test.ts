import {sampleChipsFile} from '@mvi/contracts';
import type {ListingSnapshot} from '@mvi/contracts';
import {describe, expect, it} from 'vitest';

import {collect} from './collect.js';
import {runGuards} from './guards.js';
import {listingId, normalise} from './normalise.js';
import {fakeNetwork, testClient} from './test-helpers.js';
import {AdapterSkippedError} from './types.js';
import type {RawListing, SourceAdapter} from './types.js';

const DATE = '2026-11-14';
const chips = sampleChipsFile();

function raw(overrides: Partial<RawListing> = {}): RawListing {
  return {
    title: 'Mac mini, M4 Pro Chip, 12-core CPU, 16-core GPU',
    model: 'Mac mini',
    year: 2024,
    formFactor: 'desktop',
    chipFamily: 'M4 Pro',
    cpuCores: 12,
    gpuCores: 16,
    ramGb: 48,
    ssdGb: 1000,
    condition: 'new',
    grade: null,
    warrantyMonths: 12,
    priceGbp: 1999,
    rrpGbp: 1999,
    seller: 'Apple UK',
    sourceUrl: 'https://example.com/a',
    retrievedDate: DATE,
    collectedBy: 'structured',
    sku: 'A',
    note: null,
    ...overrides,
  };
}

function adapter(
  id: string,
  run: () => Promise<readonly RawListing[]>,
): SourceAdapter {
  return {
    id,
    kind: 'structured',
    condition: 'new',
    name: `Source ${id}`,
    url: 'https://example.com/store',
    collect: run,
  };
}

describe('normalise', () => {
  it('maps the chip, assigns a stable id and keeps the fields', () => {
    const {listings, unmapped} = normalise([raw()], chips);
    expect(unmapped).toEqual([]);
    expect(listings).toHaveLength(1);
    expect(listings[0]).toMatchObject({
      chipId: 'm4-pro-12c-16g',
      priceGbp: 1999,
      note: null,
    });
    expect(listings[0]?.id).toMatch(/^[a-f0-9]{16}$/);
    expect(listings[0]).not.toHaveProperty('chipFamily');
  });

  it('gives the same id whatever the price, title or URL', () => {
    const [a] = normalise([raw()], chips).listings;
    const [b] = normalise(
      [
        raw({
          priceGbp: 1500,
          title: 'Other',
          sourceUrl: 'https://example.com/b',
        }),
      ],
      chips,
    ).listings;
    expect(a?.id).toBe(b?.id);
    expect(
      listingId({
        seller: 'Apple UK',
        model: 'Mac mini',
        chipId: 'm4-pro-12c-16g',
        ramGb: 48,
        ssdGb: 1000,
        condition: 'new',
      }),
    ).toBe(a?.id);
  });

  it('collapses identical configurations from one seller to the cheapest', () => {
    const {listings} = normalise(
      [
        raw({priceGbp: 2100, sourceUrl: 'https://example.com/silver'}),
        raw({priceGbp: 1999, sourceUrl: 'https://example.com/zebra'}),
        raw({priceGbp: 1999, sourceUrl: 'https://example.com/black'}),
      ],
      chips,
    );
    expect(listings).toHaveLength(1);
    expect(listings[0]).toMatchObject({
      priceGbp: 1999,
      sourceUrl: 'https://example.com/black',
      note: 'Cheapest of 3 listings of this configuration (colour or display options differ).',
    });
  });

  it('keeps distinct sellers, conditions and configurations apart', () => {
    const {listings} = normalise(
      [
        raw(),
        raw({seller: 'Other Shop'}),
        raw({condition: 'apple-refurbished'}),
        raw({ramGb: 24}),
        raw({model: 'Mac Studio'}),
      ],
      chips,
    );
    expect(listings).toHaveLength(5);
    const ids = listings.map(listing => listing.id);
    expect([...ids].sort()).toEqual(ids);
  });

  it('reports listings whose chip is not in chips.json', () => {
    const {listings, unmapped} = normalise(
      [raw({chipFamily: 'M9', cpuCores: 99, gpuCores: 99}), raw()],
      chips,
    );
    expect(listings).toHaveLength(1);
    expect(unmapped).toEqual([
      'M9 with 99-core CPU and 99-core GPU (Mac mini, M4 Pro Chip, 12-core CPU, 16-core GPU)',
    ]);
  });
});

describe('collect', () => {
  const options = {
    only: null,
    http: testClient(fakeNetwork({})),
    chips,
    date: DATE,
    log: () => undefined,
  };

  it('records status for every adapter and survives a failure', async () => {
    const result = await collect({
      ...options,
      adapters: [
        adapter('good', () => Promise.resolve([raw(), raw({ramGb: 24})])),
        adapter('bad', () => Promise.reject(new Error('HTTP 503'))),
        adapter('keyless', () =>
          Promise.reject(new AdapterSkippedError('No API key.')),
        ),
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- deliberate
        adapter('odd', () => Promise.reject('not an error')),
      ],
    });
    expect(
      result.snapshot.sourceStatus.map(s => [
        s.adapterId,
        s.status,
        s.listingCount,
        s.error,
      ]),
    ).toEqual([
      ['good', 'ok', 2, null],
      ['bad', 'failed', 0, 'HTTP 503'],
      ['keyless', 'skipped', 0, 'No API key.'],
      ['odd', 'failed', 0, 'not an error'],
    ]);
    expect(result.snapshot.listings).toHaveLength(2);
    expect(result.snapshot.snapshotDate).toBe(DATE);
  });

  it('drops listings that fail the schema, with a warning', async () => {
    const result = await collect({
      ...options,
      adapters: [
        adapter('mixed', () =>
          Promise.resolve([raw(), raw({title: 'Bad', priceGbp: 0})]),
        ),
      ],
    });
    expect(result.snapshot.listings).toHaveLength(1);
    expect(result.snapshot.sourceStatus[0]?.listingCount).toBe(1);
    expect(result.warnings[0]).toMatch(/^mixed: dropped "Bad": priceGbp: /);
  });

  it('passes adapter warnings through and runs only selected sources', async () => {
    let ran = false;
    const result = await collect({
      ...options,
      only: ['chosen'],
      adapters: [
        {
          ...adapter('chosen', () => Promise.resolve([])),
          collect: context => {
            context.warn('something odd');
            return Promise.resolve([
              raw({retrievedDate: context.retrievedDate}),
            ]);
          },
        },
        adapter('other', () => {
          ran = true;
          return Promise.resolve([]);
        }),
      ],
    });
    expect(ran).toBe(false);
    expect(result.warnings).toEqual(['chosen: something odd']);
    expect(result.snapshot.sourceStatus[1]).toMatchObject({
      adapterId: 'other',
      status: 'skipped',
      error: 'Not selected for this run.',
    });
  });

  it('reports unmapped chips', async () => {
    const result = await collect({
      ...options,
      adapters: [
        adapter('new-chip', () => Promise.resolve([raw({chipFamily: 'M9'})])),
      ],
    });
    expect(result.unmapped).toHaveLength(1);
    expect(result.snapshot.listings).toEqual([]);
  });
});

describe('anomaly guards', () => {
  function snapshot(
    count: number,
    overrides: Partial<ListingSnapshot> = {},
  ): ListingSnapshot {
    const listings = normalise(
      Array.from({length: count}, (_, index) => raw({ramGb: 16 + index})),
      chips,
    ).listings;
    return {
      schemaVersion: 1,
      snapshotDate: DATE,
      sourceStatus: [
        {
          adapterId: 'apple-uk-new',
          name: 'Apple',
          kind: 'structured',
          condition: 'new',
          url: 'https://example.com',
          status: 'ok',
          listingCount: count,
          error: null,
          retrievedDate: DATE,
        },
      ],
      listings: [...listings],
      ...overrides,
    };
  }

  it('passes a healthy snapshot, with or without a previous one', () => {
    expect(runGuards(snapshot(50), null)).toEqual([]);
    expect(runGuards(snapshot(50), snapshot(55))).toEqual([]);
  });

  it('fails with fewer than 40 listings', () => {
    expect(runGuards(snapshot(39), null)).toEqual([
      {
        guard: 'too-few-listings',
        message: 'Only 39 listings were collected; at least 40 are required.',
      },
    ]);
  });

  it('fails when the listing count falls by more than 20%', () => {
    expect(runGuards(snapshot(80), snapshot(100))).toEqual([]);
    expect(runGuards(snapshot(79), snapshot(100)).map(f => f.message)).toEqual([
      'Listing count fell from 100 to 79 (21%).',
    ]);
  });

  it('fails when a price moves by more than 30%', () => {
    const before = snapshot(50);
    const after = snapshot(50);
    const moved = {
      ...after,
      listings: after.listings.map((listing, index) =>
        index === 0
          ? {...listing, priceGbp: 2600}
          : index === 1
            ? {...listing, priceGbp: 1300}
            : index === 2
              ? {...listing, priceGbp: 2598.7}
              : listing,
      ),
    };
    const failures = runGuards(moved, before);
    expect(failures.map(f => f.guard)).toEqual(['price-moved', 'price-moved']);
    expect(failures[0]?.message).toContain('moved 30.1%: £1999 to £2600');
    expect(failures[1]?.message).toContain('moved 35%: £1999 to £1300');
  });

  it('fails when a source that returned listings returns zero', () => {
    const before = snapshot(50);
    const [status] = before.sourceStatus;
    const now = snapshot(50, {
      sourceStatus:
        status === undefined
          ? []
          : [{...status, listingCount: 0, status: 'failed', error: 'x'}],
    });
    expect(runGuards(now, before).map(f => f.message)).toEqual([
      'Source apple-uk-new returned 50 listings last time and zero this time.',
    ]);
    expect(
      runGuards(snapshot(50, {sourceStatus: []}), before).map(f => f.guard),
    ).toEqual(['source-returned-zero']);
  });

  it('fails on missing provenance and invalid prices', () => {
    const base = snapshot(50);
    const broken = {
      ...base,
      listings: base.listings.map((listing, index) =>
        index === 0
          ? {...listing, sourceUrl: ''}
          : index === 1
            ? {...listing, priceGbp: 0}
            : index === 2
              ? {...listing, priceGbp: 10.005}
              : index === 3
                ? {...listing, retrievedDate: '', priceGbp: -4}
                : listing,
      ),
    };
    expect(runGuards(broken, null).map(f => f.guard)).toEqual([
      'missing-provenance',
      'invalid-price',
      'invalid-price',
      'missing-provenance',
      'invalid-price',
    ]);
  });
});
