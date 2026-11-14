// Apple UK store, new Macs (structured adapter).
//
// Each family page (/uk/shop/buy-mac/<family>) embeds the configurator
// data: the chip tiers, the memory and storage options, and the part
// numbers of the standard configurations. Every configuration has its own
// page whose schema.org JSON-LD carries the exact name and price, for
// example:
//   /uk/shop/buy-mac/mac-mini/m5-pro-chip-15-core-cpu-16-core-gpu-48gb-memory-1tb-storage
//
// The adapter resolves one standard configuration per chip tier to learn
// the page-name pattern, then requests every memory and storage
// combination. A combination Apple does not sell redirects to the family
// page and is skipped. Colour and display finish are not enumerated.

import {z} from 'zod';

import type {CollectContext, RawListing, SourceAdapter} from '../types.js';

import {
  APPLE_ORIGIN,
  APPLE_SELLER,
  APPLE_WARRANTY_MONTHS,
  extractJsonObject,
  formFactorOf,
  normaliseText,
  parseCapacityGb,
  parseChip,
  parseProductOffers,
} from './apple-common.js';

const STORE_URL = `${APPLE_ORIGIN}/uk/shop/buy-mac`;

/** Families checked on every run. One that is not sold redirects away. */
export const FAMILIES = [
  'mac-mini',
  'mac-studio',
  'mac-pro',
  'imac',
  'macbook-air',
  'macbook-pro',
] as const;

const COLOUR_KEY = 'chassis-dimensionColor';
const FINISH_KEY = 'display-dimensionFinish';
const CHIP_KEY = 'processor-dimensionChip';
const MEMORY_KEY = 'memory-dimensionMemory';
const STORAGE_KEY = 'storage-dimensionCapacity';
const STANDARD_FINISHES = ['standard', 'glossy'];

const productSchema = z.looseObject({
  aosContainerPartNumber: z.string().optional(),
  btrOrFdPartNumber: z.string().nullable().optional(),
  dimensions: z.record(z.string(), z.string()),
});

const optionsSchema = z.looseObject({variantOrder: z.array(z.string())});

const selectionSchema = z.looseObject({
  products: z.array(productSchema),
  configDisplayValues: z.looseObject({
    [MEMORY_KEY]: optionsSchema,
    [STORAGE_KEY]: optionsSchema,
  }),
});
type Selection = z.infer<typeof selectionSchema>;
type Product = z.infer<typeof productSchema>;

const CHIP_SLUG =
  /(?:m\d+(?:-pro|-max|-ultra)?-chip-)?(\d+)-core-cpu-(\d+)-core-gpu/;
const CONFIG_SLUG = /\d+gb-memory-\d+(?:gb|tb)-storage/;

export interface Tier {
  /** Chip key from the page, for example "m5pro-18-20" or "10-10". */
  readonly key: string;
  /** Dimensions other than colour and finish, for example screen size. */
  readonly group: string;
  readonly year: number | null;
  /** Part number of a standard configuration in this tier, if any. */
  readonly partNumber: string | null;
}

function tierKey(product: Product): string | null {
  for (const [name, value] of Object.entries(product.dimensions)) {
    if (name.endsWith('cpuCoreCount-gpuCoreCount')) {
      return value;
    }
  }
  return null;
}

function isPreferred(product: Product): boolean {
  const finish = product.dimensions[FINISH_KEY];
  return finish === undefined || STANDARD_FINISHES.includes(finish);
}

/** One tier per chip variant and size, ignoring colour and finish. */
export function findTiers(selection: Selection): readonly Tier[] {
  const tiers = new Map<string, Tier>();
  const ordered = [...selection.products].sort(
    (a, b) => Number(isPreferred(b)) - Number(isPreferred(a)),
  );
  for (const product of ordered) {
    const key = tierKey(product);
    if (key === null) {
      continue;
    }
    const group = Object.entries(product.dimensions)
      .filter(
        ([name]) =>
          name !== COLOUR_KEY &&
          name !== FINISH_KEY &&
          name !== CHIP_KEY &&
          !name.endsWith('cpuCoreCount-gpuCoreCount'),
      )
      .map(([name, value]) => `${name}=${value}`)
      .sort()
      .join('&');
    const id = `${group}|${key}`;
    const year = Number(
      /_(20\d{2})$/.exec(product.aosContainerPartNumber ?? '')?.[1],
    );
    const partNumber = product.btrOrFdPartNumber ?? null;
    const existing = tiers.get(id);
    if (existing === undefined) {
      tiers.set(id, {
        key,
        group,
        year: Number.isInteger(year) ? year : null,
        partNumber,
      });
    } else if (existing.partNumber === null && partNumber !== null) {
      tiers.set(id, {...existing, partNumber});
    }
  }
  return [...tiers.values()];
}

/** Rewrites the chip part of a configuration page name for another tier. */
export function slugForTier(seedSlug: string, key: string): string | null {
  const match = /^(?:(m\d+)(pro|max|ultra)?-)?(\d+)-(\d+)$/.exec(key);
  if (match?.[3] === undefined || match[4] === undefined) {
    return null;
  }
  const [, generation, suffix, cpu, gpu] = match;
  if (!CHIP_SLUG.test(seedSlug)) {
    return null;
  }
  return seedSlug.replace(CHIP_SLUG, (all: string) => {
    const cores = `${cpu}-core-cpu-${gpu}-core-gpu`;
    if (generation === undefined) {
      // The page does not name the chip, so keep the seed's chip name.
      return all.replace(/\d+-core-cpu-\d+-core-gpu$/, cores);
    }
    const name = suffix === undefined ? generation : `${generation}-${suffix}`;
    return `${name}-chip-${cores}`;
  });
}

/** Replaces the memory and storage part of a configuration page name. */
export function slugForConfig(
  slug: string,
  memory: string,
  storage: string,
): string | null {
  if (!CONFIG_SLUG.test(slug)) {
    return null;
  }
  return slug.replace(CONFIG_SLUG, `${memory}-memory-${storage}-storage`);
}

/** Parses a configuration page into a listing. Null when not a product. */
export function parseConfigurationPage(
  html: string,
  sourceUrl: string,
  year: number | null,
  retrievedDate: string,
): RawListing | null {
  const [offer] = parseProductOffers(html);
  if (offer === undefined) {
    return null;
  }
  const title = normaliseText(offer.name);
  const parts = title.split(',').map(part => part.trim());
  const chip = parseChip(title);
  const memory = parts.find(part => /memory$/i.test(part));
  const storage = parts.find(part => /storage$/i.test(part));
  const ramGb = parseCapacityGb(memory?.replace(/\s*memory$/i, '') ?? '');
  const ssdGb = parseCapacityGb(storage?.replace(/\s*storage$/i, '') ?? '');
  const [family, size] = parts;
  if (
    family === undefined ||
    chip === null ||
    ramGb === null ||
    ssdGb === null
  ) {
    return null;
  }
  const model =
    size !== undefined && /^\d+-inch$/.test(size)
      ? `${family} ${size}`
      : family;
  return {
    title,
    model,
    year,
    formFactor: formFactorOf(model),
    chipFamily: chip.chipFamily,
    cpuCores: chip.cpuCores,
    gpuCores: chip.gpuCores,
    ramGb,
    ssdGb,
    condition: 'new',
    grade: null,
    warrantyMonths: APPLE_WARRANTY_MONTHS,
    priceGbp: offer.priceGbp,
    rrpGbp: offer.priceGbp,
    seller: APPLE_SELLER,
    sourceUrl,
    retrievedDate,
    collectedBy: 'structured',
    sku: offer.sku,
    note: null,
  };
}

function slugOf(url: string, family: string): string | null {
  const prefix = `${STORE_URL}/${family}/`;
  return url.startsWith(prefix) ? url.slice(prefix.length) : null;
}

async function collectFamily(
  family: string,
  context: CollectContext,
): Promise<readonly RawListing[]> {
  const familyUrl = `${STORE_URL}/${family}`;
  const page = await context.http.get(familyUrl);
  if (page.status !== 200 || page.finalUrl !== familyUrl) {
    context.warn(`${family}: not sold on the UK store (${page.finalUrl}).`);
    return [];
  }
  const selection = selectionSchema.safeParse(
    extractJsonObject(page.body, 'productSelectionData:'),
  );
  if (!selection.success) {
    throw new Error(`${family}: configurator data not found in the page.`);
  }
  const memoryOptions =
    selection.data.configDisplayValues[MEMORY_KEY].variantOrder;
  const storageOptions =
    selection.data.configDisplayValues[STORAGE_KEY].variantOrder;
  const tiers = findTiers(selection.data);

  // Learn the page-name pattern for each size from a standard configuration.
  const seeds = new Map<string, string>();
  for (const tier of tiers) {
    if (tier.partNumber === null || seeds.has(tier.group)) {
      continue;
    }
    const resolved = await context.http.get(
      `${APPLE_ORIGIN}/uk/shop/product/${tier.partNumber}`,
    );
    const slug = slugOf(resolved.finalUrl, family);
    if (resolved.status === 200 && slug !== null) {
      seeds.set(tier.group, slug);
    }
  }

  const listings: RawListing[] = [];
  for (const tier of tiers) {
    const seed = seeds.get(tier.group);
    const tierSlug = seed === undefined ? null : slugForTier(seed, tier.key);
    if (tierSlug === null) {
      context.warn(`${family}: no page pattern for chip tier ${tier.key}.`);
      continue;
    }
    for (const memory of memoryOptions) {
      for (const storage of storageOptions) {
        const slug = slugForConfig(tierSlug, memory, storage);
        if (slug === null) {
          continue;
        }
        const url = `${familyUrl}/${slug}`;
        const response = await context.http.get(url);
        if (response.status !== 200 || response.finalUrl !== url) {
          // Apple does not sell this combination.
          continue;
        }
        const listing = parseConfigurationPage(
          response.body,
          url,
          tier.year,
          context.retrievedDate,
        );
        if (listing === null) {
          context.warn(`${family}: could not read ${slug}.`);
          continue;
        }
        listings.push(listing);
      }
    }
  }
  return listings;
}

export const appleUkNew: SourceAdapter = {
  id: 'apple-uk-new',
  kind: 'structured',
  condition: 'new',
  name: 'Apple UK Store',
  url: `${APPLE_ORIGIN}/uk/shop/buy-mac`,
  async collect(context: CollectContext): Promise<readonly RawListing[]> {
    const listings: RawListing[] = [];
    for (const family of FAMILIES) {
      listings.push(...(await collectFamily(family, context)));
    }
    return listings;
  },
};
