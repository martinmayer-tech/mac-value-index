import {z} from 'zod';

import {
  adapterKindSchema,
  collectedBySchema,
  conditionSchema,
  findDuplicates,
  formFactorSchema,
  gbpSchema,
  httpsUrlSchema,
  isoDateSchema,
  nonEmptyStringSchema,
  nonNegativeIntSchema,
  positiveIntSchema,
  schemaVersionSchema,
  slugSchema,
} from './common.js';

/** Stable hash of seller, model, chip variant, RAM, SSD and condition. */
export const listingIdSchema = z
  .string()
  .regex(/^[a-f0-9]{16}$/, 'must be a 16-character lowercase hex id');

export const listingSchema = z.strictObject({
  id: listingIdSchema,
  /** Product title exactly as the source states it. */
  title: nonEmptyStringSchema,
  /** Normalised model name, for example "MacBook Pro 14-inch". */
  model: nonEmptyStringSchema,
  year: z.int().min(2020).max(2100).nullable(),
  formFactor: formFactorSchema,
  /** Id of a chip variant in chips.json. */
  chipId: slugSchema,
  ramGb: positiveIntSchema,
  ssdGb: positiveIntSchema,
  condition: conditionSchema,
  grade: z.string().nullable(),
  warrantyMonths: nonNegativeIntSchema.nullable(),
  /** Price in GBP including VAT. */
  priceGbp: gbpSchema,
  /** Apple's price for the same configuration when new, where known. */
  rrpGbp: gbpSchema.nullable(),
  seller: nonEmptyStringSchema,
  sourceUrl: httpsUrlSchema,
  retrievedDate: isoDateSchema,
  collectedBy: collectedBySchema,
  sku: z.string().nullable(),
  note: z.string().nullable(),
});
export type Listing = z.infer<typeof listingSchema>;

export const SOURCE_STATUSES = ['ok', 'failed', 'skipped'] as const;
export const sourceStatusValueSchema = z.enum(SOURCE_STATUSES);

export const sourceStatusSchema = z.strictObject({
  adapterId: slugSchema,
  name: nonEmptyStringSchema,
  kind: adapterKindSchema,
  condition: conditionSchema,
  url: httpsUrlSchema,
  status: sourceStatusValueSchema,
  listingCount: nonNegativeIntSchema,
  error: z.string().nullable(),
  retrievedDate: isoDateSchema,
});
export type SourceStatus = z.infer<typeof sourceStatusSchema>;

export const listingSnapshotSchema = z
  .strictObject({
    schemaVersion: schemaVersionSchema,
    snapshotDate: isoDateSchema,
    sourceStatus: z.array(sourceStatusSchema),
    listings: z.array(listingSchema),
  })
  .superRefine((snapshot, context) => {
    const ids = snapshot.listings.map(listing => listing.id);
    for (const id of findDuplicates(ids)) {
      context.addIssue({
        code: 'custom',
        path: ['listings'],
        message: `duplicate listing id "${id}"`,
      });
    }
    const adapterIds = snapshot.sourceStatus.map(status => status.adapterId);
    for (const id of findDuplicates(adapterIds)) {
      context.addIssue({
        code: 'custom',
        path: ['sourceStatus'],
        message: `duplicate adapter id "${id}"`,
      });
    }
  });
export type ListingSnapshot = z.infer<typeof listingSnapshotSchema>;
