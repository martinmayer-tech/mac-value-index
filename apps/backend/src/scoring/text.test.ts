import {describe, expect, it} from 'vitest';

import {
  chipLabel,
  conclusionText,
  conditionLabel,
  configurationName,
  formatGbp,
  formatNumber,
  formatStorage,
  summaryLine,
} from './text.js';
import type {ConclusionParts, SummaryParts} from './text.js';

const parts: SummaryParts = {
  model: 'Mac mini',
  chipFamily: 'M4 Pro',
  cpuCores: 12,
  gpuCores: 16,
  ramGb: 48,
  ssdGb: 1000,
  condition: 'apple-refurbished',
  priceGbp: 2119,
  multiCore: 20487,
  modelClass: '32B',
  fitsSmallestClass: true,
  usableStorageGb: 850,
};

describe('formatting', () => {
  it('formats numbers with thousands separators', () => {
    expect(formatNumber(0)).toBe('0');
    expect(formatNumber(999)).toBe('999');
    expect(formatNumber(1000)).toBe('1,000');
    expect(formatNumber(1234567.891, 2)).toBe('1,234,567.89');
    expect(formatNumber(-1234.5, 1)).toBe('-1,234.5');
    expect(formatNumber(-0.001, 2)).toBe('0.00');
  });

  it('formats GBP with and without pence', () => {
    expect(formatGbp(1699)).toBe('£1,699');
    expect(formatGbp(699.95)).toBe('£699.95');
    expect(formatGbp(1019.5)).toBe('£1,019.50');
    expect(formatGbp(-80)).toBe('-£80');
  });

  it('formats storage as marketed', () => {
    expect(formatStorage(512)).toBe('512GB');
    expect(formatStorage(1000)).toBe('1TB');
    expect(formatStorage(2000)).toBe('2TB');
    expect(formatStorage(1500)).toBe('1500GB');
  });

  it('labels conditions and chips', () => {
    expect(conditionLabel('new')).toBe('new');
    expect(conditionLabel('third-party-refurbished')).toBe(
      'third-party refurbished',
    );
    expect(chipLabel('M4 Pro', 12, 16)).toBe(
      'M4 Pro (12-core CPU, 16-core GPU)',
    );
    expect(configurationName(parts)).toBe(
      'Mac mini M4 Pro 12/16-core 48GB 1TB',
    );
  });
});

describe('summaryLine', () => {
  it('follows the agreed form', () => {
    expect(summaryLine(parts)).toBe(
      'Mac mini M4 Pro 12/16-core 48GB 1TB (Apple refurbished) is £2,119, scores 20,487 multi-core, runs models up to 32B, and stores 850 GB usable.',
    );
  });

  it('words headroom below the smallest class differently', () => {
    expect(
      summaryLine({...parts, modelClass: 'below 7B', fitsSmallestClass: false}),
    ).toContain('runs only models below 7B');
  });
});

describe('conclusionText', () => {
  const conclusion: ConclusionParts = {
    ...parts,
    seller: 'Apple UK',
    profileName: 'Secondary development machine',
    capabilityScore: 61.234,
    valueScore: 28.8976,
    isStable: true,
    profileCount: 3,
    runnerUp: {name: 'Mac mini M6 12/12-core 32GB 1TB', priceGbp: 1799},
  };

  it('mentions stability when the winner is stable', () => {
    const text = conclusionText(conclusion);
    expect(text).toContain('value score of 28.90');
    expect(text).toContain('capability score of 61.2 out of 100');
    expect(text.endsWith('It is in the top 10 under all 3 profiles.')).toBe(
      true,
    );
  });

  it('names the runner-up otherwise, and never exceeds three sentences', () => {
    const text = conclusionText({...conclusion, isStable: false});
    expect(text).toContain(
      'The runner-up is Mac mini M6 12/12-core 32GB 1TB at £1,799.',
    );
    expect(text.split('. ').length).toBeLessThanOrEqual(3);
  });

  it('stops at two sentences with no runner-up', () => {
    const text = conclusionText({
      ...conclusion,
      isStable: false,
      runnerUp: null,
    });
    expect(text.endsWith('850 GB of usable storage.')).toBe(true);
  });

  it('does not claim stability for a single profile', () => {
    const text = conclusionText({...conclusion, profileCount: 1});
    expect(text).toContain('The runner-up is');
  });
});
