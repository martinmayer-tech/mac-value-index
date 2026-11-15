import {resultsSchema} from '@mvi/contracts';
import {z} from 'astro/zod';
import {defineCollection} from 'astro:content';

import {loadSnapshots, resultsDirectory} from './lib/load-results.js';

/**
 * Every snapshot in results/, validated against the contract schemas at
 * build time. A failed validation or unsupported schemaVersion fails the
 * build with the file name and the failing field.
 */
const snapshots = defineCollection({
  loader: {
    name: 'mvi-results',
    load: async context => {
      const directory = resultsDirectory(process.env, process.cwd());
      context.store.clear();
      for (const snapshot of await loadSnapshots(directory)) {
        context.store.set({
          id: snapshot.date,
          data: {
            date: snapshot.date,
            isLatest: snapshot.isLatest,
            results: snapshot.results,
            rankingCsv: snapshot.rankingCsv,
            reportMarkdown: snapshot.reportMarkdown,
          },
          rendered: await context.renderMarkdown(snapshot.reportMarkdown),
        });
      }
    },
  },
  schema: z.object({
    date: z.string(),
    isLatest: z.boolean(),
    results: resultsSchema,
    rankingCsv: z.string(),
    reportMarkdown: z.string(),
  }),
});

export const collections = {snapshots};
