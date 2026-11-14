import {describe, expect, it} from 'vitest';

import {fakeNetwork, fixture, testClient} from '../test-helpers.js';
import type {Route} from '../test-helpers.js';
import {rawListingSchema} from '../types.js';
import type {CollectContext} from '../types.js';

import {
  extractJsonObject,
  formFactorOf,
  parseCapacityGb,
  parseChip,
  parseProductOffers,
} from './apple-common.js';
import {
  appleUkNew,
  findTiers,
  parseConfigurationPage,
  slugForConfig,
  slugForTier,
} from './apple-uk-new.js';
import {
  appleUkRefurbished,
  parseRefurbishedPage,
} from './apple-uk-refurbished.js';

import {ADAPTERS} from './index.js';

const DATE = '2026-11-14';
const STORE = 'https://www.apple.com/uk/shop';

function context(
  routes: Readonly<Record<string, Route>>,
  warnings: string[] = [],
): CollectContext {
  return {
    http: testClient(fakeNetwork(routes)),
    retrievedDate: DATE,
    warn: message => warnings.push(message),
  };
}

describe('shared Apple parsing', () => {
  it('parses capacities', () => {
    expect(parseCapacityGb('512gb')).toBe(512);
    expect(parseCapacityGb('1TB')).toBe(1000);
    expect(parseCapacityGb('16 GB')).toBe(16);
    expect(parseCapacityGb('lots')).toBeNull();
  });

  it('parses chips, with Apple’s non-breaking hyphens', () => {
    expect(
      parseChip(
        'Refurbished 14-inch MacBook Pro Apple M5 Pro chip with 15‑Core CPU and 16‑Core GPU - Silver',
      ),
    ).toEqual({chipFamily: 'M5 Pro', cpuCores: 15, gpuCores: 16});
    expect(
      parseChip('Mac Studio, M5 ULTRA Chip, 30-core CPU, 64-core GPU'),
    ).toEqual({chipFamily: 'M5 Ultra', cpuCores: 30, gpuCores: 64});
    expect(parseChip('iMac, M6 Chip, 12-core CPU, 12-core GPU')).toEqual({
      chipFamily: 'M6',
      cpuCores: 12,
      gpuCores: 12,
    });
    expect(parseChip('Studio Display - Standard glass')).toBeNull();
  });

  it('classifies form factors', () => {
    expect(formFactorOf('Mac mini')).toBe('desktop');
    expect(formFactorOf('iMac 24-inch')).toBe('desktop');
    expect(formFactorOf('Mac Studio')).toBe('desktop');
    expect(formFactorOf('MacBook Air 13-inch')).toBe('laptop');
  });

  it('extracts an embedded JSON object, respecting strings', () => {
    const html = 'x = {"a":"} \\" {","b":{"c":1}}; y = {"d":2}';
    expect(extractJsonObject(html, 'x =')).toEqual({a: '} " {', b: {c: 1}});
    expect(extractJsonObject(html, 'missing')).toBeNull();
    expect(extractJsonObject('x = {"a": 1', 'x =')).toBeNull();
    expect(extractJsonObject('x = {not json}', 'x =')).toBeNull();
  });

  it('reads only GBP product offers from JSON-LD', () => {
    const html = `
      <script type="application/ld+json">{"@type":"Product","name":"A","offers":[{"price":10,"priceCurrency":"GBP","sku":"S1"}]}</script>
      <script type="application/ld+json">{"@type":"Product","name":"B","offers":[{"price":10,"priceCurrency":"USD"}]}</script>
      <script type="application/ld+json">{"@type":"Product","name":"C","offers":[{"priceCurrency":"GBP"}]}</script>
      <script type="application/ld+json">{"@type":"BreadcrumbList"}</script>
      <script type="application/ld+json">{broken</script>`;
    expect(parseProductOffers(html)).toEqual([
      {name: 'A', url: null, sku: 'S1', priceGbp: 10},
    ]);
  });
});

describe('apple-uk-refurbished', () => {
  it('parses the recorded store page', async () => {
    const warnings: string[] = [];
    const listings = parseRefurbishedPage(
      await fixture('apple/refurbished-mac.html'),
      DATE,
      message => warnings.push(message),
    );
    expect(warnings).toEqual([]);
    // Eleven tiles recorded; the Studio Display is not a Mac.
    expect(listings).toHaveLength(10);
    for (const listing of listings) {
      expect(rawListingSchema.safeParse(listing).success).toBe(true);
    }
    expect(listings.find(l => l.sku === 'G1KZMB/A')).toEqual({
      title:
        'Refurbished Mac mini Apple M4 Pro Chip with 12-Core CPU and 16-Core GPU, 10Gb Ethernet',
      model: 'Mac mini',
      year: 2024,
      formFactor: 'desktop',
      chipFamily: 'M4 Pro',
      cpuCores: 12,
      gpuCores: 16,
      ramGb: 48,
      ssdGb: 512,
      condition: 'apple-refurbished',
      grade: 'Apple Certified Refurbished',
      warrantyMonths: 12,
      priceGbp: 1949,
      rrpGbp: null,
      seller: 'Apple UK',
      sourceUrl:
        'https://www.apple.com/uk/shop/product/g1kzmb/a/Refurbished-Mac-mini-Apple-M4-Pro-Chip-with-12-Core-CPU-and-16-Core-GPU-10Gb-Ethernet-',
      retrievedDate: DATE,
      collectedBy: 'structured',
      sku: 'G1KZMB/A',
      note: null,
    });
    const air = listings.find(l => l.sku === 'FC7A4B/A');
    expect(air).toMatchObject({
      model: 'MacBook Air 15-inch',
      formFactor: 'laptop',
      chipFamily: 'M4',
      ramGb: 16,
      ssdGb: 256,
      priceGbp: 1019,
      rrpGbp: 1099,
      year: 2025,
    });
  });

  it('skips tiles it cannot read and prices that disagree', () => {
    const tile = (overrides: object) => ({
      title:
        'Refurbished Mac mini Apple M4 Chip with 10-Core CPU and 10-Core GPU',
      partNumber: 'AAA',
      productDetailsUrl: '/uk/shop/product/aaa?fnode=1',
      filters: {
        dimensions: {
          refurbClearModel: 'macmini',
          tsMemorySize: '16gb',
          dimensionCapacity: '256gb',
        },
      },
      price: {currentPrice: {raw_amount: '679.00'}, priceCurrency: 'GBP'},
      ...overrides,
    });
    const tiles = [
      tile({}),
      tile({partNumber: 'BAD-CHIP', title: 'Refurbished Mac mini'}),
      tile({partNumber: 'MISMATCH'}),
      tile({
        partNumber: 'USD',
        price: {currentPrice: {raw_amount: '1'}, priceCurrency: 'USD'},
      }),
      {unexpected: true},
    ];
    const html = `
      <script type="application/ld+json">{"@type":"Product","name":"x","offers":[{"price":700,"priceCurrency":"GBP","sku":"MISMATCH"}]}</script>
      <script>window.REFURB_GRID_BOOTSTRAP = ${JSON.stringify({tiles})};</script>`;
    const warnings: string[] = [];
    const listings = parseRefurbishedPage(html, DATE, m => warnings.push(m));
    expect(listings.map(listing => listing.sku)).toEqual(['AAA']);
    expect(listings[0]).toMatchObject({year: null, rrpGbp: null});
    expect(warnings).toEqual([
      'Skipped BAD-CHIP: chip, memory, storage or price unreadable.',
      'Skipped MISMATCH: grid price 679 differs from JSON-LD offer 700.',
      'Skipped USD: chip, memory, storage or price unreadable.',
      'Skipped a refurbished tile with an unexpected shape.',
    ]);
  });

  it('fails clearly when the grid is missing or the page errors', async () => {
    expect(() => parseRefurbishedPage('<html></html>', DATE, () => 0)).toThrow(
      /product grid not found/,
    );
    await expect(
      appleUkRefurbished.collect(
        context({[`${STORE}/refurbished/mac`]: {status: 500 - 97}}),
      ),
    ).rejects.toThrow(/HTTP 403/);
  });

  it('collects through the HTTP client', async () => {
    const listings = await appleUkRefurbished.collect(
      context({
        [`${STORE}/refurbished/mac`]: {
          body: await fixture('apple/refurbished-mac.html'),
        },
      }),
    );
    expect(listings).toHaveLength(10);
  });
});

describe('apple-uk-new', () => {
  it('rewrites configuration page names', () => {
    const seed =
      'm5-pro-chip-15-core-cpu-16-core-gpu-24gb-memory-512gb-storage';
    expect(slugForTier(seed, 'm5pro-18-20')).toBe(
      'm5-pro-chip-18-core-cpu-20-core-gpu-24gb-memory-512gb-storage',
    );
    expect(slugForTier(seed, 'm6-12-12')).toBe(
      'm6-chip-12-core-cpu-12-core-gpu-24gb-memory-512gb-storage',
    );
    expect(
      slugForTier(
        '13-inch-starlight-m5-chip-10-core-cpu-8-core-gpu-16gb-memory-512gb-storage',
        '10-10',
      ),
    ).toBe(
      '13-inch-starlight-m5-chip-10-core-cpu-10-core-gpu-16gb-memory-512gb-storage',
    );
    expect(slugForTier(seed, 'unknown')).toBeNull();
    expect(slugForTier('no-chip-here', 'm6-12-12')).toBeNull();
    expect(slugForConfig(seed, '48gb', '1tb')).toBe(
      'm5-pro-chip-15-core-cpu-16-core-gpu-48gb-memory-1tb-storage',
    );
    expect(
      slugForConfig(
        '24-inch-pink-m6-chip-12-core-cpu-12-core-gpu-16gb-memory-256gb-storage-standard-glass-stand',
        '32gb',
        '2tb',
      ),
    ).toBe(
      '24-inch-pink-m6-chip-12-core-cpu-12-core-gpu-32gb-memory-2tb-storage-standard-glass-stand',
    );
    expect(slugForConfig('nothing', '16gb', '1tb')).toBeNull();
  });

  it('finds one tier per chip variant and size, preferring standard finish', () => {
    const product = (
      dimensions: Record<string, string>,
      partNumber: string | null,
    ) => ({
      aosContainerPartNumber: 'RO_MBP_2026',
      btrOrFdPartNumber: partNumber,
      dimensions,
    });
    const base = {
      'chassis-dimensionScreensize': '14inch',
      'processor-dimensionChip': 'm6',
      'processor-dimensionChip-cpuCoreCount-gpuCoreCount': 'm6-12-12',
    };
    const tiers = findTiers({
      configDisplayValues: {
        'memory-dimensionMemory': {variantOrder: []},
        'storage-dimensionCapacity': {variantOrder: []},
      },
      products: [
        product(
          {
            ...base,
            'chassis-dimensionColor': 'silver',
            'display-dimensionFinish': 'nano_texture',
          },
          'NANO',
        ),
        product(
          {
            ...base,
            'chassis-dimensionColor': 'silver',
            'display-dimensionFinish': 'standard',
          },
          null,
        ),
        product(
          {
            ...base,
            'chassis-dimensionColor': 'spaceblack',
            'display-dimensionFinish': 'standard',
          },
          'STD',
        ),
        product({...base, 'chassis-dimensionScreensize': '16inch'}, null),
        product({'chassis-dimensionColor': 'blue'}, 'NOCHIP'),
      ],
    });
    expect(tiers).toEqual([
      {
        key: 'm6-12-12',
        group: 'chassis-dimensionScreensize=14inch',
        year: 2026,
        partNumber: 'STD',
      },
      {
        key: 'm6-12-12',
        group: 'chassis-dimensionScreensize=16inch',
        year: 2026,
        partNumber: null,
      },
    ]);
  });

  it('parses a recorded configuration page', async () => {
    const url = `${STORE}/buy-mac/mac-mini/m5-pro-chip-15-core-cpu-16-core-gpu-48gb-memory-1tb-storage`;
    const listing = parseConfigurationPage(
      await fixture('apple/mac-mini-m5-pro-15-16-48gb-1tb.html'),
      url,
      2026,
      DATE,
    );
    expect(listing).toEqual({
      title:
        'Mac mini, M5 Pro Chip, 15-core CPU, 16-core GPU, 48GB memory, 1TB storage',
      model: 'Mac mini',
      year: 2026,
      formFactor: 'desktop',
      chipFamily: 'M5 Pro',
      cpuCores: 15,
      gpuCores: 16,
      ramGb: 48,
      ssdGb: 1000,
      condition: 'new',
      grade: null,
      warrantyMonths: 12,
      priceGbp: 2599,
      rrpGbp: 2599,
      seller: 'Apple UK',
      sourceUrl: url,
      retrievedDate: DATE,
      collectedBy: 'structured',
      sku: 'Z1UD+CLVV+CLW2+CLW6+CLWG+CLWK+CLXM+CLXP+BCLXG',
      note: null,
    });
    expect(rawListingSchema.safeParse(listing).success).toBe(true);
  });

  it('includes the screen size in laptop model names', () => {
    const html = `<script type="application/ld+json">{"@type":"Product","name":"MacBook Pro, 14-inch, M6 Chip, 12-core CPU, 12-core GPU, Space Black, Standard display, 16GB memory, 1TB storage","offers":[{"price":1999,"priceCurrency":"GBP","sku":"X"}]}</script>`;
    expect(
      parseConfigurationPage(html, 'https://x.example/a', null, DATE),
    ).toMatchObject({
      model: 'MacBook Pro 14-inch',
      formFactor: 'laptop',
      ramGb: 16,
      ssdGb: 1000,
    });
  });

  it('returns null for pages that are not a readable product', () => {
    expect(
      parseConfigurationPage('<html></html>', 'https://x.example', null, DATE),
    ).toBeNull();
    const noSpecs = `<script type="application/ld+json">{"@type":"Product","name":"Mac mini","offers":[{"price":899,"priceCurrency":"GBP"}]}</script>`;
    expect(
      parseConfigurationPage(noSpecs, 'https://x.example', null, DATE),
    ).toBeNull();
  });

  it('collects every configuration Apple sells, skipping the rest', async () => {
    const family = `${STORE}/buy-mac/mac-mini`;
    const m5pro = 'm5-pro-chip-15-core-cpu-16-core-gpu';
    const m6 = 'm6-chip-12-core-cpu-12-core-gpu';
    const routes: Record<string, Route> = {
      [family]: {body: await fixture('apple/buy-mac-mini.html')},
      [`${STORE}/product/MHQN4B/A`]: {
        redirectTo: `${family}/${m5pro}-24gb-memory-512gb-storage`,
      },
      [`${family}/${m5pro}-24gb-memory-512gb-storage`]: {
        body: await fixture('apple/mac-mini-m5-pro-15-16-24gb-512gb.html'),
      },
      [`${family}/${m5pro}-48gb-memory-1tb-storage`]: {
        body: await fixture('apple/mac-mini-m5-pro-15-16-48gb-1tb.html'),
      },
      [`${family}/${m6}-16gb-memory-256gb-storage`]: {
        body: await fixture('apple/mac-mini-m6-12-12-16gb-256gb.html'),
      },
      // Sold, but the page cannot be read.
      [`${family}/${m6}-48gb-memory-1tb-storage`]: {body: '<html></html>'},
      // Not sold: Apple redirects to the family page.
      [`${family}/${m6}-16gb-memory-1tb-storage`]: {redirectTo: family},
      // A family Apple no longer sells redirects away.
      [`${STORE}/buy-mac/mac-pro`]: {
        redirectTo: 'https://www.apple.com/uk/mac/',
      },
      'https://www.apple.com/uk/mac/': {body: 'Mac'},
    };
    const warnings: string[] = [];
    // A family whose page has no configurator data fails the adapter.
    await expect(
      appleUkNew.collect(
        context(
          {...routes, [`${STORE}/buy-mac/imac`]: {body: '<html></html>'}},
          warnings,
        ),
      ),
    ).rejects.toThrow('imac: configurator data not found in the page.');

    warnings.length = 0;
    const listings = await appleUkNew.collect(context(routes, warnings));
    expect(
      listings.map(
        l => `${l.chipFamily} ${l.ramGb}/${l.ssdGb} £${l.priceGbp} ${l.year}`,
      ),
    ).toEqual(['M5 Pro 48/1000 £2599 2026', 'M6 16/256 £899 2026']);
    expect(warnings).toEqual([
      `mac-mini: could not read ${m6}-48gb-memory-1tb-storage.`,
      'mac-studio: not sold on the UK store (https://www.apple.com/uk/shop/buy-mac/mac-studio).',
      'mac-pro: not sold on the UK store (https://www.apple.com/uk/mac/).',
      'imac: not sold on the UK store (https://www.apple.com/uk/shop/buy-mac/imac).',
      'macbook-air: not sold on the UK store (https://www.apple.com/uk/shop/buy-mac/macbook-air).',
      'macbook-pro: not sold on the UK store (https://www.apple.com/uk/shop/buy-mac/macbook-pro).',
    ]);
  });

  it('warns when no page pattern can be learnt for a tier', async () => {
    const family = `${STORE}/buy-mac/mac-mini`;
    const warnings: string[] = [];
    const listings = await appleUkNew.collect(
      context(
        {[family]: {body: await fixture('apple/buy-mac-mini.html')}},
        warnings,
      ),
    );
    expect(listings).toEqual([]);
    expect(warnings.slice(0, 3)).toEqual([
      'mac-mini: no page pattern for chip tier m5pro-15-16.',
      'mac-mini: no page pattern for chip tier m5pro-18-20.',
      'mac-mini: no page pattern for chip tier m6-12-12.',
    ]);
  });
});

describe('adapter registry', () => {
  it('lists the Apple adapters with unique ids', () => {
    expect(ADAPTERS.map(adapter => adapter.id)).toEqual([
      'apple-uk-new',
      'apple-uk-refurbished',
    ]);
    expect(ADAPTERS.every(adapter => adapter.kind === 'structured')).toBe(true);
  });
});
