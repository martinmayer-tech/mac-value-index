import {z} from 'zod';

import {findDuplicates, isoDateSchema, schemaVersionSchema} from './common.js';

export const resultsIndexSchema = z
  .strictObject({
    schemaVersion: schemaVersionSchema,
    /** The most recent snapshot date. */
    latest: isoDateSchema,
    /** Every snapshot date, oldest first. */
    snapshots: z.array(isoDateSchema).min(1),
  })
  .superRefine((index, context) => {
    for (const date of findDuplicates(index.snapshots)) {
      context.addIssue({
        code: 'custom',
        path: ['snapshots'],
        message: `duplicate snapshot "${date}"`,
      });
    }
    const sorted = [...index.snapshots].sort();
    if (sorted.some((date, position) => date !== index.snapshots[position])) {
      context.addIssue({
        code: 'custom',
        path: ['snapshots'],
        message: 'snapshots must be sorted oldest first',
      });
    }
    if (sorted.at(-1) !== index.latest) {
      context.addIssue({
        code: 'custom',
        path: ['latest'],
        message: 'latest must be the most recent snapshot',
      });
    }
  });
export type ResultsIndex = z.infer<typeof resultsIndexSchema>;
