import {z} from 'zod';

import {
  findDuplicates,
  gbpSchema,
  httpsUrlSchema,
  isoDateSchema,
  nonEmptyStringSchema,
  nonNegativeIntSchema,
  positiveIntSchema,
  schemaVersionSchema,
  slugSchema,
} from './common.js';

/** The five weighted metrics, in display order. */
export const METRIC_KEYS = [
  'multiCore',
  'memoryHeadroom',
  'gpuAndBandwidth',
  'singleCore',
  'usableStorage',
] as const;
export const metricKeySchema = z.enum(METRIC_KEYS);
export type MetricKey = z.infer<typeof metricKeySchema>;

const weightSchema = z.number().min(0).max(100);

export const weightsSchema = z
  .strictObject({
    multiCore: weightSchema,
    memoryHeadroom: weightSchema,
    gpuAndBandwidth: weightSchema,
    singleCore: weightSchema,
    usableStorage: weightSchema,
  })
  .refine(
    weights =>
      weights.multiCore +
        weights.memoryHeadroom +
        weights.gpuAndBandwidth +
        weights.singleCore +
        weights.usableStorage ===
      100,
    {message: 'weights must sum to 100'},
  );
export type Weights = z.infer<typeof weightsSchema>;

/** How the "GPU and bandwidth" metric splits between its two inputs. */
export const gpuAndBandwidthSplitSchema = z
  .strictObject({
    metal: weightSchema,
    memoryBandwidth: weightSchema,
  })
  .refine(split => split.metal + split.memoryBandwidth === 100, {
    message: 'split must sum to 100',
  });

export const modelClassSchema = z.strictObject({
  /** Model size label, for example "32B". */
  label: nonEmptyStringSchema,
  /** Smallest memory headroom, in GB, that runs this class. */
  minHeadroomGb: z.number().positive(),
  assumption: nonEmptyStringSchema,
});
export type ModelClass = z.infer<typeof modelClassSchema>;

export const priceBandSchema = z.strictObject({
  id: slugSchema,
  label: nonEmptyStringSchema,
  /** Inclusive lower bound in GBP. */
  minGbp: z.number().nonnegative(),
  /** Exclusive upper bound in GBP; null for no upper bound. */
  maxGbp: z.number().positive().nullable(),
});
export type PriceBand = z.infer<typeof priceBandSchema>;

export const externalStorageSchema = z.strictObject({
  product: nonEmptyStringSchema,
  capacityGb: positiveIntSchema,
  priceGbp: gbpSchema,
  sourceUrl: httpsUrlSchema,
  retrievedDate: isoDateSchema,
});
export type ExternalStorage = z.infer<typeof externalStorageSchema>;

export const profileSchema = z
  .strictObject({
    schemaVersion: schemaVersionSchema,
    id: slugSchema,
    name: nonEmptyStringSchema,
    description: nonEmptyStringSchema,
    isDefault: z.boolean(),
    weights: weightsSchema,
    gpuAndBandwidthSplit: gpuAndBandwidthSplitSchema,
    reservations: z.strictObject({
      /** GB of RAM reserved for macOS, Docker and Xcode. */
      memoryGb: nonNegativeIntSchema,
      /** GB of SSD reserved for macOS, Xcode, simulators and images. */
      storageGb: nonNegativeIntSchema,
      assumption: nonEmptyStringSchema,
    }),
    floors: z.strictObject({
      minRamGb: nonNegativeIntSchema,
      minSsdGb: nonNegativeIntSchema,
    }),
    /** Label used when headroom is below the smallest model class. */
    belowSmallestClassLabel: nonEmptyStringSchema,
    modelClasses: z.array(modelClassSchema).min(1),
    priceBands: z.array(priceBandSchema).min(1),
    externalStorage: externalStorageSchema,
  })
  .superRefine((profile, context) => {
    const thresholds = profile.modelClasses.map(c => c.minHeadroomGb);
    const ascending = thresholds.every((value, index) =>
      thresholds.slice(0, index).every(earlier => earlier < value),
    );
    if (!ascending) {
      context.addIssue({
        code: 'custom',
        path: ['modelClasses'],
        message: 'model classes must be in ascending order of minHeadroomGb',
      });
    }
    for (const id of findDuplicates(profile.priceBands.map(b => b.id))) {
      context.addIssue({
        code: 'custom',
        path: ['priceBands'],
        message: `duplicate price band id "${id}"`,
      });
    }
    for (const [index, band] of profile.priceBands.entries()) {
      if (band.maxGbp !== null && band.maxGbp <= band.minGbp) {
        context.addIssue({
          code: 'custom',
          path: ['priceBands', index],
          message: 'maxGbp must be greater than minGbp',
        });
      }
    }
  });
export type Profile = z.infer<typeof profileSchema>;
