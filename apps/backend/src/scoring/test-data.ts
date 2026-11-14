// A small fixed data set shared by the scoring, report and diff tests.

import {
  sampleChip,
  sampleListing,
  sampleProfile,
  sampleSnapshot,
  sampleSourceStatus,
} from '@mvi/contracts';
import type {
  ChipsFile,
  ChipVariant,
  Listing,
  ListingSnapshot,
  Profile,
} from '@mvi/contracts';

export const CHIPS: readonly ChipVariant[] = [
  sampleChip(),
  sampleChip({
    id: 'm4-10c-10g',
    family: 'M4',
    cpuCores: {total: 10, performance: 4, efficiency: 6},
    gpuCores: 10,
    geekbench: {singleCore: 3747, multiCore: 14978, metal: 56075},
    memoryBandwidthGbPerSec: 120,
    maxMemoryGb: 32,
  }),
  sampleChip({
    id: 'm4-max-16c-40g',
    family: 'M4 Max',
    cpuCores: {total: 16, performance: null, efficiency: null},
    gpuCores: 40,
    geekbench: {singleCore: 3880, multiCore: 25760, metal: 179746},
    memoryBandwidthGbPerSec: 546,
    maxMemoryGb: 128,
  }),
  sampleChip({
    id: 'm5-ultra-30c-64g',
    family: 'M5 Ultra',
    generation: 5,
    cpuCores: {total: 30, performance: 30, efficiency: 0},
    gpuCores: 64,
    geekbench: {singleCore: 4318, multiCore: 37777, metal: null},
    memoryBandwidthGbPerSec: 1200,
    maxMemoryGb: null,
    collectedBy: 'agent',
  }),
  sampleChip({
    id: 'm6-10c-10g',
    family: 'M6',
    generation: 6,
    cpuCores: {total: 10, performance: 5, efficiency: 5},
    gpuCores: 10,
    geekbench: {singleCore: 4561, multiCore: 18758, metal: 60000},
    memoryBandwidthGbPerSec: null,
    maxMemoryGb: 24,
  }),
];

export const CHIPS_FILE: ChipsFile = {
  schemaVersion: 1,
  geekbenchVersion: '6',
  retrievedDate: '2026-01-05',
  chips: [...CHIPS],
};

let counter = 0;

/** Builds a listing with a unique, readable id. */
export function listing(overrides: Partial<Listing> = {}): Listing {
  counter++;
  return sampleListing({
    id: counter.toString(16).padStart(16, '0'),
    sourceUrl: `https://example.com/listing/${counter}`,
    ...overrides,
  });
}

export const IDS = {
  miniProNew: '00000000000000a1',
  miniProRefurbished: '00000000000000a2',
  miniBase: '00000000000000a3',
  miniLowRam: '00000000000000a4',
  miniLowSsd: '00000000000000a5',
  macbookMax: '00000000000000a6',
  studioUltra: '00000000000000a7',
  imacNoBandwidth: '00000000000000a8',
  miniProThirdParty: '00000000000000a9',
} as const;

export const LISTINGS: readonly Listing[] = [
  sampleListing({id: IDS.miniProNew}),
  sampleListing({
    id: IDS.miniProRefurbished,
    condition: 'apple-refurbished',
    priceGbp: 1699,
    grade: 'Apple Certified Refurbished',
  }),
  sampleListing({
    id: IDS.miniBase,
    title: 'Mac mini, M4 Chip, 10-core CPU, 10-core GPU',
    chipId: 'm4-10c-10g',
    ramGb: 16,
    ssdGb: 512,
    priceGbp: 799,
    rrpGbp: 799,
  }),
  sampleListing({
    id: IDS.miniLowRam,
    chipId: 'm4-10c-10g',
    ramGb: 8,
    ssdGb: 512,
    priceGbp: 599,
  }),
  sampleListing({
    id: IDS.miniLowSsd,
    chipId: 'm4-10c-10g',
    ramGb: 16,
    ssdGb: 256,
    priceGbp: 599,
  }),
  sampleListing({
    id: IDS.macbookMax,
    title: 'MacBook Pro, 16-inch, M4 Max Chip, 16-core CPU, 40-core GPU',
    model: 'MacBook Pro 16-inch',
    formFactor: 'laptop',
    chipId: 'm4-max-16c-40g',
    ramGb: 128,
    ssdGb: 2000,
    priceGbp: 5199.5,
    rrpGbp: 5199.5,
  }),
  sampleListing({
    id: IDS.studioUltra,
    title: 'Mac Studio, M5 Ultra Chip, 30-core CPU, 64-core GPU',
    model: 'Mac Studio',
    chipId: 'm5-ultra-30c-64g',
    ramGb: 96,
    ssdGb: 1000,
    priceGbp: 5499,
  }),
  sampleListing({
    id: IDS.imacNoBandwidth,
    title: 'iMac, 24-inch, M6 Chip, 10-core CPU, 10-core GPU',
    model: 'iMac 24-inch',
    chipId: 'm6-10c-10g',
    ramGb: 16,
    ssdGb: 512,
    priceGbp: 1699,
  }),
  sampleListing({
    id: IDS.miniProThirdParty,
    condition: 'third-party-refurbished',
    seller: 'Example Refurb',
    priceGbp: 2099,
    grade: 'Excellent',
    collectedBy: 'agent',
  }),
];

export const SNAPSHOT: ListingSnapshot = sampleSnapshot(LISTINGS, {
  sourceStatus: [
    sampleSourceStatus({listingCount: 8}),
    sampleSourceStatus({
      adapterId: 'example-refurb',
      name: 'Example Refurb',
      kind: 'agent',
      condition: 'third-party-refurbished',
      status: 'failed',
      listingCount: 0,
      error: 'HTTP 503',
    }),
  ],
});

export const PROFILES: readonly Profile[] = [
  sampleProfile({
    id: 'memory-heavy',
    name: 'Memory-heavy',
    isDefault: false,
    weights: {
      multiCore: 15,
      memoryHeadroom: 55,
      gpuAndBandwidth: 15,
      singleCore: 5,
      usableStorage: 10,
    },
  }),
  sampleProfile(),
  sampleProfile({
    id: 'cpu-heavy',
    name: 'CPU-heavy',
    isDefault: false,
    weights: {
      multiCore: 50,
      memoryHeadroom: 15,
      gpuAndBandwidth: 5,
      singleCore: 20,
      usableStorage: 10,
    },
  }),
];
