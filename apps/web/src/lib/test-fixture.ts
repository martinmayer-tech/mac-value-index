// Loads the committed site fixture for unit tests.

import path from 'node:path';

import type {Results} from '@mvi/contracts';

import {loadSnapshots} from './load-results.js';

export const FIXTURE_RESULTS_DIR = path.join(
  import.meta.dirname,
  '..',
  '..',
  'test',
  'fixtures',
  'site',
  'results',
);

/** The latest snapshot's results from the fixture. */
export async function fixtureResults(): Promise<Results> {
  const [latest] = await loadSnapshots(FIXTURE_RESULTS_DIR);
  if (latest === undefined) {
    throw new Error('The site fixture has no snapshots.');
  }
  return latest.results;
}
