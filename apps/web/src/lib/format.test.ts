import {describe, expect, it} from 'vitest';

import {
  conditionLabel,
  daysBetween,
  formatGbp,
  formatNumber,
  formatPercent,
  formatStorage,
  isoDate,
} from './format.js';
import {joinBase} from './paths.js';

describe('formatting helpers', () => {
  it('formats GBP with thousands separators', () => {
    expect(formatGbp(1099)).toBe('£1,099');
    expect(formatGbp(699.95)).toBe('£699.95');
    expect(formatGbp(12345.5)).toBe('£12,345.50');
    expect(formatGbp(-80)).toBe('-£80');
    expect(formatGbp(0)).toBe('£0');
  });

  it('formats numbers, rounding for display', () => {
    expect(formatNumber(21302)).toBe('21,302');
    expect(formatNumber(35.4149, 2)).toBe('35.41');
    expect(formatNumber(38.95, 1)).toBe('39.0');
    expect(formatPercent(11.764)).toBe('11.8%');
  });

  it('formats storage as marketed', () => {
    expect(formatStorage(256)).toBe('256GB');
    expect(formatStorage(1000)).toBe('1TB');
    expect(formatStorage(16000)).toBe('16TB');
    expect(formatStorage(1500)).toBe('1500GB');
  });

  it('labels conditions', () => {
    expect(conditionLabel('new')).toBe('New');
    expect(conditionLabel('apple-refurbished')).toBe('Apple refurbished');
    expect(conditionLabel('third-party-refurbished')).toBe(
      'Third-party refurbished',
    );
  });

  it('counts days between dates', () => {
    expect(daysBetween('2026-11-14', '2026-11-14')).toBe(0);
    expect(daysBetween('2026-11-14', '2026-11-28')).toBe(14);
    expect(daysBetween('2026-10-31', '2026-11-14')).toBe(14);
    expect(daysBetween('2026-11-14', '2026-11-13')).toBe(-1);
    expect(isoDate(new Date('2026-11-14T23:59:59Z'))).toBe('2026-11-14');
  });
});

describe('joinBase', () => {
  it('joins paths under the base, whatever the slashes', () => {
    expect(joinBase('/mac-value-index/', 'reports/')).toBe(
      '/mac-value-index/reports/',
    );
    expect(joinBase('/mac-value-index', '/reports/')).toBe(
      '/mac-value-index/reports/',
    );
    expect(joinBase('/mac-value-index/', '')).toBe('/mac-value-index/');
    expect(joinBase('/', 'sources/')).toBe('/sources/');
  });
});
