import {sampleProfile} from '@mvi/contracts';
import fc from 'fast-check';
import {describe, expect, it} from 'vitest';

import {
  compareScored,
  normalise,
  paretoFrontier,
  rank,
  scoreListings,
  valueScore,
} from './score.js';
import type {Scored, ScoreInput} from './score.js';

const profile = sampleProfile();

function input(overrides: Partial<ScoreInput> = {}): ScoreInput {
  return {
    id: 'a',
    priceGbp: 1000,
    multiCore: 10000,
    singleCore: 3000,
    metal: 50000,
    memoryBandwidthGbPerSec: 100,
    memoryHeadroomGb: 20,
    usableStorageGb: 400,
    ...overrides,
  };
}

function scored(overrides: Partial<Scored>): Scored {
  const [base] = scoreListings([input()], profile);
  if (base === undefined) {
    throw new Error('no score');
  }
  return {...base, ...overrides};
}

describe('normalise', () => {
  it('divides by the best value', () => {
    expect(normalise(5, 10)).toBe(0.5);
    expect(normalise(10, 10)).toBe(1);
  });

  it('is zero when the best value is zero, and clamps to zero and one', () => {
    expect(normalise(0, 0)).toBe(0);
    expect(normalise(12, 10)).toBe(1);
    expect(normalise(-1, 10)).toBe(0);
  });
});

describe('scoreListings', () => {
  it('scores a single listing at 100', () => {
    const [only] = scoreListings([input()], profile);
    expect(only?.capabilityScore).toBe(100);
    expect(only?.valueScore).toBe(100);
    expect(only?.components.multiCore).toEqual({
      raw: 10000,
      normalised: 1,
      weighted: 30,
    });
  });

  it('returns nothing for no listings', () => {
    expect(scoreListings([], profile)).toEqual([]);
  });

  it('weights each normalised metric', () => {
    const [half] = scoreListings(
      [
        input({
          id: 'half',
          multiCore: 5000,
          singleCore: 1500,
          metal: 25000,
          memoryBandwidthGbPerSec: 50,
          memoryHeadroomGb: 10,
          usableStorageGb: 200,
        }),
        input({id: 'best'}),
      ],
      profile,
    );
    expect(half?.capabilityScore).toBeCloseTo(50, 10);
    expect(half?.components.gpuAndBandwidth.normalised).toBeCloseTo(0.5, 10);
    expect(half?.components.memoryHeadroom.weighted).toBeCloseTo(17.5, 10);
  });

  it('splits GPU and bandwidth as the profile says', () => {
    const [entry] = scoreListings(
      [
        input({id: 'x', metal: 50000, memoryBandwidthGbPerSec: 50}),
        input({id: 'y', metal: 25000, memoryBandwidthGbPerSec: 100}),
      ],
      sampleProfile({gpuAndBandwidthSplit: {metal: 100, memoryBandwidth: 0}}),
    );
    expect(entry?.components.gpuAndBandwidth.normalised).toBe(1);
  });

  it('handles a metric that is zero for every listing', () => {
    const [entry] = scoreListings([input({usableStorageGb: 0})], profile);
    expect(entry?.components.usableStorage.weighted).toBe(0);
    expect(entry?.capabilityScore).toBe(90);
  });

  it('calculates value as capability per £1,000', () => {
    expect(valueScore(50, 2000)).toBe(25);
  });
});

describe('ranking order', () => {
  it('sorts by value score, highest first', () => {
    const order = rank([
      scored({id: 'low', valueScore: 10}),
      scored({id: 'high', valueScore: 30}),
      scored({id: 'mid', valueScore: 20}),
    ]).map(entry => entry.id);
    expect(order).toEqual(['high', 'mid', 'low']);
  });

  it('breaks ties on capability, then price, then id', () => {
    const tie = {valueScore: 20, capabilityScore: 40, priceGbp: 2000};
    expect(
      rank([
        scored({...tie, id: 'b'}),
        scored({...tie, id: 'a'}),
        scored({...tie, id: 'cheap', priceGbp: 1500}),
        scored({...tie, id: 'capable', capabilityScore: 45}),
      ]).map(entry => entry.id),
    ).toEqual(['capable', 'cheap', 'a', 'b']);
    expect(compareScored(scored({id: 'a'}), scored({id: 'a'}))).toBe(0);
  });

  it('does not change its input', () => {
    const entries = [scored({id: 'b', valueScore: 1}), scored({id: 'a'})];
    rank(entries);
    expect(entries.map(entry => entry.id)).toEqual(['b', 'a']);
  });
});

describe('paretoFrontier', () => {
  it('keeps listings no other listing dominates', () => {
    const frontier = paretoFrontier([
      scored({id: 'cheap', priceGbp: 500, capabilityScore: 20}),
      scored({id: 'mid', priceGbp: 1000, capabilityScore: 50}),
      scored({id: 'dominated', priceGbp: 1200, capabilityScore: 40}),
      scored({id: 'top', priceGbp: 3000, capabilityScore: 90}),
      scored({id: 'pricey-equal', priceGbp: 3500, capabilityScore: 90}),
    ]);
    expect(frontier).toEqual(['cheap', 'mid', 'top']);
  });

  it('keeps exact duplicates, and handles one or no listings', () => {
    const twin = {priceGbp: 1000, capabilityScore: 50};
    expect(
      paretoFrontier([scored({...twin, id: 'a'}), scored({...twin, id: 'b'})]),
    ).toEqual(['a', 'b']);
    expect(paretoFrontier([scored({id: 'only'})])).toEqual(['only']);
    expect(paretoFrontier([])).toEqual([]);
  });
});

const inputArbitrary = fc.record({
  priceGbp: fc.integer({min: 300, max: 12000}),
  multiCore: fc.integer({min: 5000, max: 40000}),
  singleCore: fc.integer({min: 2000, max: 5000}),
  metal: fc.integer({min: 20000, max: 300000}),
  memoryBandwidthGbPerSec: fc.integer({min: 60, max: 1200}),
  memoryHeadroomGb: fc.integer({min: 0, max: 500}),
  usableStorageGb: fc.integer({min: 0, max: 8000}),
});

const inputsArbitrary = fc
  .array(inputArbitrary, {minLength: 1, maxLength: 12})
  .map(items => items.map((item, index) => ({...item, id: `id-${index}`})));

describe('properties', () => {
  it('keeps every score within its bounds', () => {
    fc.assert(
      fc.property(inputsArbitrary, inputs => {
        for (const entry of scoreListings(inputs, profile)) {
          expect(entry.capabilityScore).toBeGreaterThanOrEqual(0);
          expect(entry.capabilityScore).toBeLessThanOrEqual(100);
          expect(entry.valueScore).toBeGreaterThanOrEqual(0);
        }
      }),
    );
  });

  it('never lowers a value score when a price is lowered', () => {
    fc.assert(
      fc.property(
        inputsArbitrary,
        fc.integer({min: 1, max: 250}),
        (inputs, cut) => {
          const before = scoreListings(inputs, profile);
          const cheaper = inputs.map((item, index) =>
            index === 0 ? {...item, priceGbp: item.priceGbp - cut} : item,
          );
          const after = scoreListings(cheaper, profile);
          expect(after[0]?.valueScore).toBeGreaterThanOrEqual(
            before[0]?.valueScore ?? Infinity,
          );
          // Price is not a capability input, so nothing else moves.
          expect(after.slice(1)).toEqual(before.slice(1));
        },
      ),
    );
  });

  it('ranks every listing exactly once, in a consistent order', () => {
    fc.assert(
      fc.property(inputsArbitrary, inputs => {
        const ranked = rank(scoreListings(inputs, profile));
        expect(ranked.map(entry => entry.id).sort()).toEqual(
          inputs.map(item => item.id).sort(),
        );
        for (let index = 1; index < ranked.length; index++) {
          const previous = ranked[index - 1];
          const current = ranked[index];
          if (previous !== undefined && current !== undefined) {
            expect(compareScored(previous, current)).toBeLessThanOrEqual(0);
          }
        }
        expect(rank([...ranked].reverse())).toEqual(ranked);
      }),
    );
  });

  it('always puts the best-value listing on the Pareto frontier', () => {
    fc.assert(
      fc.property(inputsArbitrary, inputs => {
        const scoredAll = scoreListings(inputs, profile);
        const frontier = paretoFrontier(scoredAll);
        expect(frontier.length).toBeGreaterThan(0);
        expect(frontier).toContain(rank(scoredAll)[0]?.id);
      }),
    );
  });
});
