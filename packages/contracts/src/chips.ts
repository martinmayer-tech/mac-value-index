import {z} from 'zod';

import {
  collectedBySchema,
  findDuplicates,
  httpsUrlSchema,
  isoDateSchema,
  nonEmptyStringSchema,
  nonNegativeIntSchema,
  positiveIntSchema,
  schemaVersionSchema,
  slugSchema,
} from './common.js';

export const chipSourceSchema = z.strictObject({
  url: httpsUrlSchema,
  retrievedDate: isoDateSchema,
  /** What the source was used for, and the text that was read. */
  note: z.string().nullable(),
});
export type ChipSource = z.infer<typeof chipSourceSchema>;

export const geekbenchScoresSchema = z.strictObject({
  singleCore: positiveIntSchema.nullable(),
  multiCore: positiveIntSchema.nullable(),
  metal: positiveIntSchema.nullable(),
});
export type GeekbenchScores = z.infer<typeof geekbenchScoresSchema>;

export const chipVariantSchema = z.strictObject({
  id: slugSchema,
  /** Chip family, for example "M4 Pro". */
  family: nonEmptyStringSchema,
  /** Apple silicon generation, for example 4 for the M4 family. */
  generation: positiveIntSchema,
  /**
   * Total CPU cores, and the split where Apple states one. "performance"
   * counts every core that is not an efficiency core (Apple's "super" and
   * "performance" cores); the exact wording is kept in the note.
   */
  cpuCores: z
    .strictObject({
      total: positiveIntSchema,
      performance: positiveIntSchema.nullable(),
      efficiency: nonNegativeIntSchema.nullable(),
    })
    .refine(
      cores =>
        cores.performance === null ||
        cores.efficiency === null ||
        cores.performance + cores.efficiency === cores.total,
      {message: 'performance and efficiency cores must sum to total'},
    ),
  gpuCores: positiveIntSchema,
  /** Scores from one Geekbench version only; null when not verified. */
  geekbench: geekbenchScoresSchema,
  memoryBandwidthGbPerSec: z.number().positive().nullable(),
  maxMemoryGb: positiveIntSchema.nullable(),
  sources: z.array(chipSourceSchema).min(1),
  retrievedDate: isoDateSchema,
  collectedBy: collectedBySchema,
  note: z.string().nullable(),
});
export type ChipVariant = z.infer<typeof chipVariantSchema>;

/** Total CPU cores of a chip variant. */
export function totalCpuCores(chip: Pick<ChipVariant, 'cpuCores'>): number {
  return chip.cpuCores.total;
}

/** Key that identifies a variant by family and core counts. */
export function chipCoreKey(
  family: string,
  cpuCores: number,
  gpuCores: number,
): string {
  return `${family.toLowerCase()}|${cpuCores}|${gpuCores}`;
}

export const chipsFileSchema = z
  .strictObject({
    schemaVersion: schemaVersionSchema,
    /** The single Geekbench version used for every score in the file. */
    geekbenchVersion: nonEmptyStringSchema,
    retrievedDate: isoDateSchema,
    chips: z.array(chipVariantSchema).min(1),
  })
  .superRefine((file, context) => {
    for (const id of findDuplicates(file.chips.map(chip => chip.id))) {
      context.addIssue({
        code: 'custom',
        path: ['chips'],
        message: `duplicate chip id "${id}"`,
      });
    }
    const coreKeys = file.chips.map(chip =>
      chipCoreKey(chip.family, totalCpuCores(chip), chip.gpuCores),
    );
    for (const key of findDuplicates(coreKeys)) {
      context.addIssue({
        code: 'custom',
        path: ['chips'],
        message: `duplicate chip variant "${key}"`,
      });
    }
  });
export type ChipsFile = z.infer<typeof chipsFileSchema>;
