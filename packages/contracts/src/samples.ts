// Small valid sample documents, used by tests in every package.

import type {ChipsFile, ChipVariant} from './chips.js';
import type {Listing, ListingSnapshot, SourceStatus} from './listings.js';
import type {Profile} from './profile.js';

export function sampleChip(overrides: Partial<ChipVariant> = {}): ChipVariant {
  return {
    id: 'm4-pro-12c-16g',
    family: 'M4 Pro',
    generation: 4,
    cpuCores: {total: 12, performance: 8, efficiency: 4},
    gpuCores: 16,
    geekbench: {singleCore: 3800, multiCore: 20000, metal: 100000},
    memoryBandwidthGbPerSec: 273,
    maxMemoryGb: 64,
    sources: [
      {
        url: 'https://example.com/chip',
        retrievedDate: '2026-01-05',
        note: null,
      },
    ],
    retrievedDate: '2026-01-05',
    collectedBy: 'manual',
    note: null,
    ...overrides,
  };
}

export function sampleChipsFile(
  chips: readonly ChipVariant[] = [sampleChip()],
): ChipsFile {
  return {
    schemaVersion: 1,
    geekbenchVersion: '6',
    retrievedDate: '2026-01-05',
    chips: [...chips],
  };
}

export function sampleListing(overrides: Partial<Listing> = {}): Listing {
  return {
    id: '0123456789abcdef',
    title: 'Mac mini, M4 Pro Chip, 12-core CPU, 16-core GPU',
    model: 'Mac mini',
    year: 2024,
    formFactor: 'desktop',
    chipId: 'm4-pro-12c-16g',
    ramGb: 48,
    ssdGb: 1000,
    condition: 'new',
    grade: null,
    warrantyMonths: 12,
    priceGbp: 1999,
    rrpGbp: 1999,
    seller: 'Apple UK',
    sourceUrl: 'https://example.com/listing',
    retrievedDate: '2026-01-05',
    collectedBy: 'structured',
    sku: null,
    note: null,
    ...overrides,
  };
}

export function sampleSourceStatus(
  overrides: Partial<SourceStatus> = {},
): SourceStatus {
  return {
    adapterId: 'apple-uk-new',
    name: 'Apple UK',
    kind: 'structured',
    condition: 'new',
    url: 'https://example.com/store',
    status: 'ok',
    listingCount: 1,
    error: null,
    retrievedDate: '2026-01-05',
    ...overrides,
  };
}

export function sampleSnapshot(
  listings: readonly Listing[] = [sampleListing()],
  overrides: Partial<ListingSnapshot> = {},
): ListingSnapshot {
  return {
    schemaVersion: 1,
    snapshotDate: '2026-01-05',
    sourceStatus: [sampleSourceStatus({listingCount: listings.length})],
    listings: [...listings],
    ...overrides,
  };
}

export function sampleProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    schemaVersion: 1,
    id: 'secondary-dev-llm',
    name: 'Secondary development machine with local LLMs',
    description: 'Docker, Xcode and several local LLMs.',
    isDefault: true,
    weights: {
      multiCore: 30,
      memoryHeadroom: 35,
      gpuAndBandwidth: 15,
      singleCore: 10,
      usableStorage: 10,
    },
    gpuAndBandwidthSplit: {metal: 50, memoryBandwidth: 50},
    reservations: {
      memoryGb: 12,
      storageGb: 150,
      assumption: 'macOS, Docker and Xcode.',
    },
    floors: {minRamGb: 16, minSsdGb: 512},
    belowSmallestClassLabel: 'below 7B',
    modelClasses: [
      {label: '7B', minHeadroomGb: 6, assumption: 'About 5 GB at 4-bit.'},
      {label: '14B', minHeadroomGb: 11, assumption: 'About 10 GB at 4-bit.'},
      {label: '32B', minHeadroomGb: 22, assumption: 'About 20 GB at 4-bit.'},
      {label: '70B', minHeadroomGb: 45, assumption: 'About 42 GB at 4-bit.'},
      {label: '120B+', minHeadroomGb: 75, assumption: 'About 72 GB at 4-bit.'},
    ],
    priceBands: [
      {id: 'under-1000', label: 'Under £1,000', minGbp: 0, maxGbp: 1000},
      {id: '1000-2000', label: '£1,000–£2,000', minGbp: 1000, maxGbp: 2000},
      {id: '2000-3500', label: '£2,000–£3,500', minGbp: 2000, maxGbp: 3500},
      {id: 'over-3500', label: 'Over £3,500', minGbp: 3500, maxGbp: null},
    ],
    externalStorage: {
      product: 'Example 2TB Thunderbolt SSD',
      capacityGb: 2000,
      priceGbp: 300,
      sourceUrl: 'https://example.com/ssd',
      retrievedDate: '2026-01-05',
    },
    ...overrides,
  };
}
