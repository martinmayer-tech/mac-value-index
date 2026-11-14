// Apple UK Certified Refurbished store (structured adapter).
//
// The page embeds a product grid (REFURB_GRID_BOOTSTRAP) with memory,
// storage, release year and price for every tile, and schema.org JSON-LD
// offers. Tiles give the specification; each price is cross-checked
// against the JSON-LD offer for the same part number.

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

const URL = `${APPLE_ORIGIN}/uk/shop/refurbished/mac`;

const MODEL_NAMES: Readonly<Record<string, string>> = {
  macmini: 'Mac mini',
  macstudio: 'Mac Studio',
  macpro: 'Mac Pro',
  imac: 'iMac',
  macbookair: 'MacBook Air',
  macbookpro: 'MacBook Pro',
};

const tileSchema = z.looseObject({
  title: z.string(),
  partNumber: z.string(),
  productDetailsUrl: z.string(),
  filters: z.looseObject({
    dimensions: z.looseObject({
      refurbClearModel: z.string().optional(),
      dimensionScreensize: z.string().optional(),
      dimensionRelYear: z.string().optional(),
      tsMemorySize: z.string().optional(),
      dimensionCapacity: z.string().optional(),
    }),
  }),
  price: z.looseObject({
    currentPrice: z.looseObject({raw_amount: z.string()}),
    originalProductAmount: z.number().optional(),
    priceCurrency: z.string().optional(),
  }),
});

const gridSchema = z.looseObject({tiles: z.array(z.unknown())});

function modelName(model: string, screenSize: string | undefined): string {
  const inches = /^(\d+)inch$/.exec(screenSize ?? '')?.[1];
  return inches === undefined ? model : `${model} ${inches}-inch`;
}

/** Parses the refurbished store page into raw listings. */
export function parseRefurbishedPage(
  html: string,
  retrievedDate: string,
  warn: (message: string) => void,
): readonly RawListing[] {
  const grid = gridSchema.safeParse(
    extractJsonObject(html, 'REFURB_GRID_BOOTSTRAP'),
  );
  if (!grid.success) {
    throw new Error('Refurbished product grid not found in the page.');
  }
  const offerPrices = new Map<string, number>();
  for (const offer of parseProductOffers(html)) {
    if (offer.sku !== null) {
      offerPrices.set(offer.sku, offer.priceGbp);
    }
  }

  const listings: RawListing[] = [];
  for (const rawTile of grid.data.tiles) {
    const tile = tileSchema.safeParse(rawTile);
    if (!tile.success) {
      warn('Skipped a refurbished tile with an unexpected shape.');
      continue;
    }
    const {title, partNumber, price, filters} = tile.data;
    const dimensions = filters.dimensions;
    const model = MODEL_NAMES[dimensions.refurbClearModel ?? ''];
    if (model === undefined) {
      // Displays and accessories share the grid.
      continue;
    }
    const chip = parseChip(title);
    const ramGb = parseCapacityGb(dimensions.tsMemorySize ?? '');
    const ssdGb = parseCapacityGb(dimensions.dimensionCapacity ?? '');
    const priceGbp = Number(price.currentPrice.raw_amount);
    if (
      chip === null ||
      ramGb === null ||
      ssdGb === null ||
      !Number.isFinite(priceGbp) ||
      (price.priceCurrency !== undefined && price.priceCurrency !== 'GBP')
    ) {
      warn(`Skipped ${partNumber}: chip, memory, storage or price unreadable.`);
      continue;
    }
    const offerPrice = offerPrices.get(partNumber);
    if (offerPrice !== undefined && offerPrice !== priceGbp) {
      warn(
        `Skipped ${partNumber}: grid price ${priceGbp} differs from JSON-LD offer ${offerPrice}.`,
      );
      continue;
    }
    const year = Number(dimensions.dimensionRelYear);
    const fullModel = modelName(model, dimensions.dimensionScreensize);
    const rrp = price.originalProductAmount;
    listings.push({
      title: normaliseText(title),
      model: fullModel,
      year: Number.isInteger(year) && year >= 2020 ? year : null,
      formFactor: formFactorOf(fullModel),
      chipFamily: chip.chipFamily,
      cpuCores: chip.cpuCores,
      gpuCores: chip.gpuCores,
      ramGb,
      ssdGb,
      condition: 'apple-refurbished',
      grade: 'Apple Certified Refurbished',
      warrantyMonths: APPLE_WARRANTY_MONTHS,
      priceGbp,
      rrpGbp: rrp !== undefined && rrp > 0 ? rrp : null,
      seller: APPLE_SELLER,
      sourceUrl: `${APPLE_ORIGIN}${tile.data.productDetailsUrl.split('?')[0] ?? ''}`,
      retrievedDate,
      collectedBy: 'structured',
      sku: partNumber,
      note: null,
    });
  }
  return listings;
}

export const appleUkRefurbished: SourceAdapter = {
  id: 'apple-uk-refurbished',
  kind: 'structured',
  condition: 'apple-refurbished',
  name: 'Apple UK Certified Refurbished',
  url: URL,
  async collect(context: CollectContext): Promise<readonly RawListing[]> {
    const response = await context.http.get(URL);
    if (response.status !== 200) {
      throw new Error(`${URL} returned HTTP ${response.status}`);
    }
    return parseRefurbishedPage(
      response.body,
      context.retrievedDate,
      context.warn,
    );
  },
};
