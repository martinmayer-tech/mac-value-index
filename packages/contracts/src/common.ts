import {z} from 'zod';

import {
  ADAPTER_KINDS,
  COLLECTED_BY,
  CONDITIONS,
  FORM_FACTORS,
  SCHEMA_VERSION,
} from './constants.js';

export const schemaVersionSchema = z.literal(SCHEMA_VERSION);

/** Calendar date as YYYY-MM-DD. */
export const isoDateSchema = z.iso.date();

export const httpsUrlSchema = z.url({protocol: /^https$/});

export const positiveIntSchema = z.int().positive();

export const nonNegativeIntSchema = z.int().nonnegative();

/** True when the amount is a whole number of pence. */
export function isWholePence(amount: number): boolean {
  const pence = amount * 100;
  return Math.abs(pence - Math.round(pence)) < 1e-6;
}

/** Price in GBP including VAT: positive and a whole number of pence. */
export const gbpSchema = z
  .number()
  .positive()
  .refine(isWholePence, {message: 'must be a whole number of pence'});

export const conditionSchema = z.enum(CONDITIONS);
export type Condition = z.infer<typeof conditionSchema>;

export const formFactorSchema = z.enum(FORM_FACTORS);
export type FormFactor = z.infer<typeof formFactorSchema>;

export const collectedBySchema = z.enum(COLLECTED_BY);
export type CollectedBy = z.infer<typeof collectedBySchema>;

export const adapterKindSchema = z.enum(ADAPTER_KINDS);
export type AdapterKind = z.infer<typeof adapterKindSchema>;

/** Lowercase, hyphen-separated identifier. */
export const slugSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'must be a lowercase hyphenated id');

export const nonEmptyStringSchema = z.string().trim().min(1);

/** Returns the values that occur more than once, in first-seen order. */
export function findDuplicates(values: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      duplicates.add(value);
    }
    seen.add(value);
  }
  return [...duplicates];
}
