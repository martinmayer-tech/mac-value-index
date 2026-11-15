// Reads the fixture the site under test was built from, so the tests can
// compare the page with results.json.

import {readFileSync} from 'node:fs';
import path from 'node:path';

import {parseContract, resultsSchema} from '@mvi/contracts';
import type {ProfileResult, ResultListing, Results} from '@mvi/contracts';

export const LATEST = '2026-11-14';
export const OLDER = '2026-10-31';

const file = path.join(
  import.meta.dirname,
  '..',
  'test',
  'fixtures',
  'site',
  'results',
  LATEST,
  'results.json',
);

export const results: Results = parseContract(
  resultsSchema,
  JSON.parse(readFileSync(file, 'utf8')),
  file,
);

export function profile(id: string): ProfileResult {
  const found = results.profiles.find(result => result.profile.id === id);
  if (found === undefined) {
    throw new Error(`No profile ${id} in the fixture.`);
  }
  return found;
}

export function listing(id: string): ResultListing {
  const found = results.listings.find(candidate => candidate.id === id);
  if (found === undefined) {
    throw new Error(`No listing ${id} in the fixture.`);
  }
  return found;
}

/** Listing ids in rank order for a profile. */
export function rankedIds(profileId: string): readonly string[] {
  return profile(profileId).ranking.map(entry => entry.listingId);
}
