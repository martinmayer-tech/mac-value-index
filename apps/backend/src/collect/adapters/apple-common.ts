// Shared parsing for the Apple UK store pages.

import type {FormFactor} from '@mvi/contracts';
import {load} from 'cheerio';
import {z} from 'zod';

export const APPLE_ORIGIN = 'https://www.apple.com';
export const APPLE_SELLER = 'Apple UK';

/**
 * Apple UK states: "Most Apple hardware comes with a one-year limited
 * warranty" and "our standard one-year limited warranty with every Apple
 * Certified Refurbished product" (apple.com/uk/shop/refurbished/about).
 */
export const APPLE_WARRANTY_MONTHS = 12;

const DESKTOP_MODELS = ['mac mini', 'mac studio', 'mac pro', 'imac'];

export function formFactorOf(model: string): FormFactor {
  const lower = model.toLowerCase();
  return DESKTOP_MODELS.some(name => lower.startsWith(name))
    ? 'desktop'
    : 'laptop';
}

/** Normalises the hyphen and space variants Apple uses in titles. */
export function normaliseText(text: string): string {
  return text
    .replace(/[\u2010-\u2015]/g, '-')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Parses "512gb", "1TB" or "16 GB" into GB (1 TB = 1,000 GB). */
export function parseCapacityGb(text: string): number | null {
  const match = /^(\d+)\s*(gb|tb)$/i.exec(text.trim());
  if (match?.[1] === undefined || match[2] === undefined) {
    return null;
  }
  const amount = Number(match[1]);
  return match[2].toLowerCase() === 'tb' ? amount * 1000 : amount;
}

export interface ChipSpec {
  readonly chipFamily: string;
  readonly cpuCores: number;
  readonly gpuCores: number;
}

const CHIP_PATTERN =
  /\b(M\d+(?: (?:Pro|Max|Ultra))?) chip\b.*?(\d+)-core CPU\b.*?(\d+)-core GPU\b/i;

/** Reads the chip family and core counts from a product title. */
export function parseChip(title: string): ChipSpec | null {
  const match = CHIP_PATTERN.exec(normaliseText(title));
  if (
    match?.[1] === undefined ||
    match[2] === undefined ||
    match[3] === undefined
  ) {
    return null;
  }
  const family = match[1].replace(
    /^m(\d+)(?: (pro|max|ultra))?$/i,
    (_all, generation: string, tier: string | undefined) =>
      tier === undefined
        ? `M${generation}`
        : `M${generation} ${tier.charAt(0).toUpperCase()}${tier.slice(1).toLowerCase()}`,
  );
  return {
    chipFamily: family,
    cpuCores: Number(match[2]),
    gpuCores: Number(match[3]),
  };
}

/**
 * Extracts the JSON object literal that follows a marker in a page's
 * inline script, by matching braces outside strings.
 */
export function extractJsonObject(html: string, marker: string): unknown {
  const markerAt = html.indexOf(marker);
  const start = markerAt < 0 ? -1 : html.indexOf('{', markerAt);
  if (start < 0) {
    return null;
  }
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let position = start; position < html.length; position++) {
    const character = html.charAt(position);
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
    } else if (character === '"') {
      inString = true;
    } else if (character === '{') {
      depth++;
    } else if (character === '}') {
      depth--;
      if (depth === 0) {
        try {
          const parsed: unknown = JSON.parse(html.slice(start, position + 1));
          return parsed;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

const offerSchema = z.looseObject({
  price: z.number().optional(),
  priceCurrency: z.string().optional(),
  sku: z.string().optional(),
});

const productLdSchema = z.looseObject({
  '@type': z.literal('Product'),
  name: z.string(),
  url: z.string().optional(),
  offers: z.array(offerSchema),
});

export interface ProductOffer {
  readonly name: string;
  readonly url: string | null;
  readonly sku: string | null;
  readonly priceGbp: number;
}

/** Reads schema.org Product blocks that carry a GBP offer price. */
export function parseProductOffers(html: string): readonly ProductOffer[] {
  const $ = load(html);
  const offers: ProductOffer[] = [];
  $('script[type="application/ld+json"]').each((_index, element) => {
    let data: unknown;
    try {
      data = JSON.parse($(element).text());
    } catch {
      return;
    }
    const product = productLdSchema.safeParse(data);
    const offer = product.success ? product.data.offers[0] : undefined;
    if (
      !product.success ||
      offer?.price === undefined ||
      offer.priceCurrency !== 'GBP'
    ) {
      return;
    }
    offers.push({
      name: product.data.name,
      url: product.data.url ?? null,
      sku: offer.sku ?? null,
      priceGbp: offer.price,
    });
  });
  return offers;
}
