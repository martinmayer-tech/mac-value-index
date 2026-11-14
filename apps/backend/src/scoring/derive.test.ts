import {sampleProfile} from '@mvi/contracts';
import {describe, expect, it} from 'vitest';

import {
  deriveMetrics,
  memoryHeadroomGb,
  modelClassFor,
  usableStorageGb,
} from './derive.js';

const profile = sampleProfile();

describe('derived metrics', () => {
  it('subtracts the reservations and never goes below zero', () => {
    expect(memoryHeadroomGb(48, profile)).toBe(36);
    expect(memoryHeadroomGb(8, profile)).toBe(0);
    expect(usableStorageGb(1000, profile)).toBe(850);
    expect(usableStorageGb(128, profile)).toBe(0);
  });

  it.each([
    [0, 'below 7B'],
    [5.9, 'below 7B'],
    [6, '7B'],
    [12, '14B'],
    [36, '32B'],
    [52, '70B'],
    [116, '120B+'],
    [500, '120B+'],
  ])('maps %d GB of headroom to %s', (headroom, label) => {
    expect(modelClassFor(headroom, profile)).toBe(label);
  });

  it('calculates unit costs', () => {
    expect(
      deriveMetrics(
        {ramGb: 48, ssdGb: 1000, priceGbp: 2000, multiCore: 20000},
        profile,
      ),
    ).toEqual({
      memoryHeadroomGb: 36,
      modelClass: '32B',
      usableStorageGb: 850,
      gbpPer1000MultiCore: 100,
      gbpPerGbRam: 2000 / 48,
      gbpPerGbUsableStorage: 2000 / 850,
    });
  });

  it('gives no storage unit cost when nothing is usable', () => {
    const derived = deriveMetrics(
      {ramGb: 16, ssdGb: 128, priceGbp: 500, multiCore: 10000},
      profile,
    );
    expect(derived.gbpPerGbUsableStorage).toBeNull();
  });
});
