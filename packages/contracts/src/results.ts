import {z} from 'zod';

import {chipVariantSchema} from './chips.js';
import {
  conditionSchema,
  findDuplicates,
  gbpSchema,
  isoDateSchema,
  nonEmptyStringSchema,
  nonNegativeIntSchema,
  positiveIntSchema,
  schemaVersionSchema,
  slugSchema,
} from './common.js';
import {
  listingIdSchema,
  listingSchema,
  sourceStatusSchema,
} from './listings.js';
import {externalStorageSchema, profileSchema} from './profile.js';

/** Chip figures copied onto each listing so the site needs no lookups. */
export const listingChipSchema = z.strictObject({
  family: nonEmptyStringSchema,
  generation: positiveIntSchema,
  cpuCores: positiveIntSchema,
  performanceCores: positiveIntSchema.nullable(),
  efficiencyCores: nonNegativeIntSchema.nullable(),
  gpuCores: positiveIntSchema,
  /** Short label, for example "M4 Pro (12-core CPU, 16-core GPU)". */
  label: nonEmptyStringSchema,
  singleCore: positiveIntSchema.nullable(),
  multiCore: positiveIntSchema.nullable(),
  metal: positiveIntSchema.nullable(),
  memoryBandwidthGbPerSec: z.number().positive().nullable(),
  maxMemoryGb: positiveIntSchema.nullable(),
});
export type ListingChip = z.infer<typeof listingChipSchema>;

export const resultListingSchema = listingSchema.extend({
  chip: listingChipSchema,
  /** True when the listing is in the top 10 under every profile. */
  isStable: z.boolean(),
});
export type ResultListing = z.infer<typeof resultListingSchema>;

export const scoreComponentSchema = z.strictObject({
  /** The metric value before normalisation. */
  raw: z.number().nonnegative(),
  /** raw divided by the best value in the snapshot: zero to one. */
  normalised: z.number().min(0).max(1),
  /** normalised multiplied by the profile weight. */
  weighted: z.number().min(0).max(100),
});
export type ScoreComponent = z.infer<typeof scoreComponentSchema>;

export const scoreComponentsSchema = z.strictObject({
  multiCore: scoreComponentSchema,
  memoryHeadroom: scoreComponentSchema,
  gpuAndBandwidth: scoreComponentSchema,
  singleCore: scoreComponentSchema,
  usableStorage: scoreComponentSchema,
});
export type ScoreComponents = z.infer<typeof scoreComponentsSchema>;

export const derivedMetricsSchema = z.strictObject({
  memoryHeadroomGb: z.number().nonnegative(),
  /** Largest model class that fits at 4-bit quantisation. */
  modelClass: nonEmptyStringSchema,
  usableStorageGb: z.number().nonnegative(),
  gbpPer1000MultiCore: z.number().positive(),
  gbpPerGbRam: z.number().positive(),
  /** Null when no storage is usable after the reservation. */
  gbpPerGbUsableStorage: z.number().positive().nullable(),
});
export type DerivedMetrics = z.infer<typeof derivedMetricsSchema>;

export const rankedListingSchema = z.strictObject({
  listingId: listingIdSchema,
  /** Rank by value score within the profile; 1 is best. */
  rank: positiveIntSchema,
  /** Weighted sum of normalised metrics: zero to 100. */
  capabilityScore: z.number().min(0).max(100),
  /** Capability score per £1,000. This is the ranking key. */
  valueScore: z.number().nonnegative(),
  components: scoreComponentsSchema,
  derived: derivedMetricsSchema,
  isParetoOptimal: z.boolean(),
  isTop10: z.boolean(),
  /** One plain-English line describing the listing. */
  summary: nonEmptyStringSchema,
});
export type RankedListing = z.infer<typeof rankedListingSchema>;

export const EXCLUSION_REASONS = [
  'below-ram-floor',
  'below-ssd-floor',
  'missing-benchmark',
  'missing-memory-bandwidth',
] as const;
export const exclusionReasonSchema = z.enum(EXCLUSION_REASONS);
export type ExclusionReason = z.infer<typeof exclusionReasonSchema>;

export const exclusionSchema = z.strictObject({
  listingId: listingIdSchema,
  reason: exclusionReasonSchema,
  detail: nonEmptyStringSchema,
});
export type Exclusion = z.infer<typeof exclusionSchema>;

export const priceBandPickSchema = z.strictObject({
  bandId: slugSchema,
  label: nonEmptyStringSchema,
  minGbp: z.number().nonnegative(),
  maxGbp: z.number().positive().nullable(),
  /** Best-ranked listing in the band; null when the band is empty. */
  listingId: listingIdSchema.nullable(),
});
export type PriceBandPick = z.infer<typeof priceBandPickSchema>;

export const sensitivityEntrySchema = z.strictObject({
  listingId: listingIdSchema,
  /** Rank in the profile's normal ranking. */
  baselineRank: positiveIntSchema,
  /** Rank after desktops are re-scored with external storage. */
  rank: positiveIntSchema,
  /** True when external storage was added (desktops only). */
  adjusted: z.boolean(),
  priceGbp: gbpSchema,
  usableStorageGb: z.number().nonnegative(),
  capabilityScore: z.number().min(0).max(100),
  valueScore: z.number().nonnegative(),
});
export type SensitivityEntry = z.infer<typeof sensitivityEntrySchema>;

export const storageSensitivitySchema = z.strictObject({
  externalStorage: externalStorageSchema,
  entries: z.array(sensitivityEntrySchema),
  top10: z.array(listingIdSchema).max(10),
  /** True when the best option differs from the normal ranking. */
  winnerChanged: z.boolean(),
  summary: nonEmptyStringSchema,
});
export type StorageSensitivity = z.infer<typeof storageSensitivitySchema>;

export const conclusionSchema = z.strictObject({
  winnerListingId: listingIdSchema.nullable(),
  /** Three sentences or fewer, built from calculated figures only. */
  text: nonEmptyStringSchema,
});
export type Conclusion = z.infer<typeof conclusionSchema>;

export const profileResultSchema = z.strictObject({
  profile: profileSchema,
  ranking: z.array(rankedListingSchema),
  top10: z.array(listingIdSchema).max(10),
  paretoFrontier: z.array(listingIdSchema),
  priceBandPicks: z.array(priceBandPickSchema),
  exclusions: z.array(exclusionSchema),
  storageSensitivity: storageSensitivitySchema,
  conclusion: conclusionSchema,
});
export type ProfileResult = z.infer<typeof profileResultSchema>;

export const refurbishedAlternativeSchema = z.strictObject({
  listingId: listingIdSchema,
  condition: conditionSchema,
  seller: nonEmptyStringSchema,
  priceGbp: gbpSchema,
  /** New price minus this price. Negative when it costs more than new. */
  savingGbp: z.number(),
  savingPercent: z.number(),
});

export const newVersusRefurbishedSchema = z.strictObject({
  model: nonEmptyStringSchema,
  chipId: slugSchema,
  chipLabel: nonEmptyStringSchema,
  ramGb: positiveIntSchema,
  ssdGb: positiveIntSchema,
  newListingId: listingIdSchema,
  newPriceGbp: gbpSchema,
  alternatives: z.array(refurbishedAlternativeSchema).min(1),
});
export type NewVersusRefurbished = z.infer<typeof newVersusRefurbishedSchema>;

export const resultsSchema = z
  .strictObject({
    schemaVersion: schemaVersionSchema,
    snapshotDate: isoDateSchema,
    geekbenchVersion: nonEmptyStringSchema,
    defaultProfileId: slugSchema,
    normalisation: z.strictObject({
      method: z.literal('divide-by-snapshot-best'),
      description: nonEmptyStringSchema,
    }),
    /** Every listing in the snapshot, ranked or excluded. */
    listings: z.array(resultListingSchema),
    profiles: z.array(profileResultSchema).min(1),
    stability: z.strictObject({
      profileIds: z.array(slugSchema),
      /** Listings in the top 10 under every profile. */
      stableListingIds: z.array(listingIdSchema),
      summary: nonEmptyStringSchema,
    }),
    newVersusRefurbished: z.array(newVersusRefurbishedSchema),
    /** Chip variants used by this snapshot, with their sources. */
    chips: z.array(chipVariantSchema),
    sources: z.array(sourceStatusSchema),
  })
  .superRefine((results, context) => {
    const listingIds = new Set(results.listings.map(listing => listing.id));
    const profileIds = results.profiles.map(result => result.profile.id);
    for (const id of findDuplicates(profileIds)) {
      context.addIssue({
        code: 'custom',
        path: ['profiles'],
        message: `duplicate profile id "${id}"`,
      });
    }
    if (!profileIds.includes(results.defaultProfileId)) {
      context.addIssue({
        code: 'custom',
        path: ['defaultProfileId'],
        message: 'defaultProfileId must match a profile',
      });
    }
    for (const [index, result] of results.profiles.entries()) {
      const referenced = [
        ...result.ranking.map(entry => entry.listingId),
        ...result.exclusions.map(entry => entry.listingId),
      ];
      for (const id of referenced) {
        if (!listingIds.has(id)) {
          context.addIssue({
            code: 'custom',
            path: ['profiles', index],
            message: `unknown listing id "${id}"`,
          });
        }
      }
      for (const id of findDuplicates(referenced)) {
        context.addIssue({
          code: 'custom',
          path: ['profiles', index],
          message: `listing "${id}" is ranked or excluded more than once`,
        });
      }
      const ranksInOrder = result.ranking.every(
        (entry, position) => entry.rank === position + 1,
      );
      if (!ranksInOrder) {
        context.addIssue({
          code: 'custom',
          path: ['profiles', index, 'ranking'],
          message: 'ranking must be ordered by rank, starting at 1',
        });
      }
    }
  });
export type Results = z.infer<typeof resultsSchema>;
