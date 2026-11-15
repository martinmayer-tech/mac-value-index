import {beforeAll, describe, expect, it} from 'vitest';

import {buildRankingData, METRIC_LABELS} from './ranking-data.js';
import type {RankingData, RankingRow} from './ranking-data.js';
import {fixtureResults} from './test-fixture.js';
import {
  decodeViewState,
  defaultViewState,
  encodeViewState,
  filterOptions,
  filterRows,
  initialDirection,
  sortRows,
  visibleRows,
} from './view-state.js';
import type {ViewState} from './view-state.js';

let data: RankingData;
let base: ViewState;

beforeAll(async () => {
  data = buildRankingData(await fixtureResults());
  base = defaultViewState(data);
});

describe('buildRankingData', () => {
  it('copies the backend figures without changing them', async () => {
    const results = await fixtureResults();
    const [result] = results.profiles;
    const first = result?.ranking[0];
    const row = data.rows.find(candidate => candidate.id === first?.listingId);
    const figures = row?.figures[results.defaultProfileId];
    expect(figures?.rank).toBe(1);
    expect(figures?.valueScore).toBeCloseTo(first?.valueScore ?? 0, 4);
    expect(figures?.capabilityScore).toBeCloseTo(
      first?.capabilityScore ?? 0,
      4,
    );
    expect(figures?.modelClass).toBe(first?.derived.modelClass);
    expect(figures?.components).toHaveLength(5);
    expect(Object.keys(METRIC_LABELS)).toHaveLength(5);
  });

  it('includes only ranked listings, and every profile', async () => {
    const results = await fixtureResults();
    const ranked = new Set(
      results.profiles.flatMap(result =>
        result.ranking.map(entry => entry.listingId),
      ),
    );
    expect(data.rows).toHaveLength(ranked.size);
    expect(data.rows.length).toBeLessThan(results.listings.length);
    expect(data.profiles.map(profile => profile.id)).toEqual([
      'secondary-dev-llm',
      'cpu-heavy',
      'memory-heavy',
    ]);
    expect(data.profiles[0]?.weights).toEqual([30, 35, 15, 10, 10]);
    expect(data.snapshotDate).toBe('2026-11-14');
  });
});

describe('default view', () => {
  it('shows every listing for the default profile in rank order', () => {
    const rows = visibleRows(data, base);
    expect(rows).toHaveLength(data.rows.length);
    expect(rows.map(row => row.figures[base.profile]?.rank)).toEqual(
      rows.map((_, index) => index + 1),
    );
  });
});

describe('filters', () => {
  it('filters by condition', () => {
    const rows = filterRows(data.rows, {
      ...base,
      conditions: ['apple-refurbished'],
    });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every(row => row.condition === 'apple-refurbished')).toBe(true);
    expect(
      filterRows(data.rows, {
        ...base,
        conditions: ['new', 'apple-refurbished'],
      }),
    ).toHaveLength(data.rows.length);
  });

  it('filters by form factor, RAM, SSD, price and chip family', () => {
    const state: ViewState = {
      ...base,
      formFactor: 'desktop',
      minRamGb: 24,
      minSsdGb: 1000,
      maxPriceGbp: 3000,
      chipFamily: 'M6',
    };
    const rows = filterRows(data.rows, state);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.formFactor).toBe('desktop');
      expect(row.ramGb).toBeGreaterThanOrEqual(24);
      expect(row.ssdGb).toBeGreaterThanOrEqual(1000);
      expect(row.priceGbp).toBeLessThanOrEqual(3000);
      expect(row.chipFamily).toBe('M6');
    }
  });

  it('never changes a rank: filtered rows keep the backend rank', () => {
    const rows = visibleRows(data, {...base, formFactor: 'laptop'});
    const ranks = rows.map(row => row.figures[base.profile]?.rank ?? 0);
    expect(ranks[0]).toBeGreaterThan(1);
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
  });

  it('drops rows that are not ranked under the chosen profile', () => {
    const [first] = data.rows;
    if (first === undefined) {
      throw new Error('no rows');
    }
    const unranked: RankingRow = {...first, figures: {}};
    expect(filterRows([unranked], base)).toEqual([]);
    expect(sortRows([unranked, first], {...base, sort: 'value'})).toHaveLength(
      2,
    );
    expect(sortRows([unranked, first], base)[0]).toBe(first);
  });

  it('offers filter values found in the data', () => {
    const options = filterOptions(data);
    expect(options.ram).toEqual([...options.ram].sort((a, b) => a - b));
    expect(options.ram[0]).toBeGreaterThanOrEqual(16);
    expect(options.ssd[0]).toBeGreaterThanOrEqual(512);
    expect(options.chipFamilies).toContain('M6');
    expect(options.conditions).toEqual(['new', 'apple-refurbished']);
  });
});

describe('sorting', () => {
  it('sorts by price in both directions', () => {
    const ascending = sortRows(data.rows, {...base, sort: 'price'});
    const prices = ascending.map(row => row.priceGbp);
    expect([...prices].sort((a, b) => a - b)).toEqual(prices);
    const descending = sortRows(data.rows, {
      ...base,
      sort: 'price',
      direction: 'desc',
    });
    expect(descending[0]?.priceGbp).toBe(Math.max(...prices));
  });

  it('sorts by every column without losing rows', () => {
    for (const sort of [
      'rank',
      'model',
      'chip',
      'ram',
      'ssd',
      'condition',
      'price',
      'multiCore',
      'capability',
      'value',
    ] as const) {
      expect(sortRows(data.rows, {...base, sort})).toHaveLength(
        data.rows.length,
      );
    }
    const byValue = sortRows(data.rows, {
      ...base,
      sort: 'value',
      direction: 'desc',
    });
    expect(byValue[0]?.figures[base.profile]?.rank).toBe(1);
    const byModel = sortRows(data.rows, {...base, sort: 'model'});
    expect(byModel[0]?.model.startsWith('iMac')).toBe(true);
  });

  it('falls back to rank for ties, and does not change its input', () => {
    const before = data.rows.map(row => row.id);
    const sorted = sortRows(data.rows, {...base, sort: 'condition'});
    expect(data.rows.map(row => row.id)).toEqual(before);
    const firstGroup = sorted.filter(row => row.condition === 'new');
    const ranks = firstGroup.map(row => row.figures[base.profile]?.rank ?? 0);
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
  });

  it('follows the selected profile’s pre-calculated order', () => {
    const rows = visibleRows(data, {...base, profile: 'memory-heavy'});
    expect(rows.map(row => row.figures['memory-heavy']?.rank)).toEqual(
      rows.map((_, index) => index + 1),
    );
    expect(rows.map(row => row.id)).not.toEqual(
      visibleRows(data, base).map(row => row.id),
    );
  });

  it('chooses a sensible first direction per column', () => {
    expect(initialDirection('price')).toBe('asc');
    expect(initialDirection('value')).toBe('desc');
    expect(initialDirection('capability')).toBe('desc');
    expect(initialDirection('multiCore')).toBe('desc');
  });
});

describe('URL query string', () => {
  it('encodes the default view as an empty string', () => {
    expect(encodeViewState(base, data)).toBe('');
    expect(decodeViewState('', data)).toEqual(base);
  });

  it('round-trips a full view', () => {
    const state: ViewState = {
      profile: 'cpu-heavy',
      conditions: ['new', 'apple-refurbished'],
      formFactor: 'laptop',
      minRamGb: 32,
      minSsdGb: 1000,
      maxPriceGbp: 2500,
      chipFamily: 'M5 Pro',
      sort: 'price',
      direction: 'desc',
    };
    const query = encodeViewState(state, data);
    expect(query).toBe(
      'profile=cpu-heavy&condition=new%2Capple-refurbished&form=laptop&ram=32&ssd=1000&price=2500&chip=M5+Pro&sort=price&dir=desc',
    );
    expect(decodeViewState(`?${query}`, data)).toEqual(state);
  });

  it('ignores anything invalid', () => {
    expect(
      decodeViewState(
        '?profile=nope&condition=used,new&form=tablet&ram=-4&ssd=abc&price=&chip=M99&sort=colour&dir=sideways',
        data,
      ),
    ).toEqual({...base, conditions: ['new']});
  });

  it('defaults the direction to the column’s first direction', () => {
    expect(decodeViewState('sort=value', data)).toMatchObject({
      sort: 'value',
      direction: 'desc',
    });
    expect(encodeViewState({...base, direction: 'desc'}, data)).toBe(
      'sort=rank&dir=desc',
    );
  });
});
