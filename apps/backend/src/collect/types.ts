import {
  collectedBySchema,
  conditionSchema,
  formFactorSchema,
  gbpSchema,
  httpsUrlSchema,
  isoDateSchema,
  nonEmptyStringSchema,
  nonNegativeIntSchema,
  positiveIntSchema,
} from '@mvi/contracts';
import type {AdapterKind, Condition} from '@mvi/contracts';
import {z} from 'zod';

import type {HttpClient} from './http.js';

/**
 * A listing as read from a source, before it is mapped to a chip variant.
 * Structured and agent adapters produce the same shape and are validated
 * with the same schema.
 */
export const rawListingSchema = z.strictObject({
  title: nonEmptyStringSchema,
  model: nonEmptyStringSchema,
  year: z.int().min(2020).max(2100).nullable(),
  formFactor: formFactorSchema,
  /** Chip family as the source names it, for example "M4 Pro". */
  chipFamily: z.string().regex(/^M\d+(?: (?:Pro|Max|Ultra))?$/),
  cpuCores: positiveIntSchema,
  gpuCores: positiveIntSchema,
  ramGb: positiveIntSchema,
  ssdGb: positiveIntSchema,
  condition: conditionSchema,
  grade: z.string().nullable(),
  warrantyMonths: nonNegativeIntSchema.nullable(),
  priceGbp: gbpSchema,
  rrpGbp: gbpSchema.nullable(),
  seller: nonEmptyStringSchema,
  sourceUrl: httpsUrlSchema,
  retrievedDate: isoDateSchema,
  collectedBy: collectedBySchema,
  sku: z.string().nullable(),
  note: z.string().nullable(),
});
export type RawListing = z.infer<typeof rawListingSchema>;

export interface CollectContext {
  readonly http: HttpClient;
  /** The snapshot date, used as every listing's retrieved date. */
  readonly retrievedDate: string;
  /** Records a non-fatal problem, such as a tile that could not be read. */
  readonly warn: (message: string) => void;
}

/** One source of listings. Add a file per source in adapters/. */
export interface SourceAdapter {
  readonly id: string;
  readonly kind: AdapterKind;
  readonly condition: Condition;
  /** Human-readable source name, shown on the sources page. */
  readonly name: string;
  /** The page a reader can open to see the source. */
  readonly url: string;
  collect(context: CollectContext): Promise<readonly RawListing[]>;
}

/** Thrown by an adapter that cannot run, for example without an API key. */
export class AdapterSkippedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AdapterSkippedError';
  }
}
