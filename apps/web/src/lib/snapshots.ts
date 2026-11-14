// Access to the validated snapshots from pages and components.

import type {ProfileResult, ResultListing, Results} from '@mvi/contracts';
import {getCollection} from 'astro:content';
import type {CollectionEntry} from 'astro:content';

export type SnapshotEntry = CollectionEntry<'snapshots'>;

/** Every snapshot, newest first. */
export async function getSnapshots(): Promise<readonly SnapshotEntry[]> {
  const entries = await getCollection('snapshots');
  return entries.sort((a, b) => (a.data.date < b.data.date ? 1 : -1));
}

/** The latest snapshot. The build fails when there is none. */
export async function getLatestSnapshot(): Promise<SnapshotEntry> {
  const latest = (await getSnapshots()).find(entry => entry.data.isLatest);
  if (latest === undefined) {
    throw new Error('results/index.json does not mark a latest snapshot.');
  }
  return latest;
}

/** The default profile's results. */
export function defaultProfileResult(results: Results): ProfileResult {
  const result = results.profiles.find(
    candidate => candidate.profile.id === results.defaultProfileId,
  );
  if (result === undefined) {
    throw new Error('Default profile missing from results.json.');
  }
  return result;
}

/** Listings by id. */
export function listingLookup(
  results: Results,
): ReadonlyMap<string, ResultListing> {
  return new Map(results.listings.map(listing => [listing.id, listing]));
}

/** Short configuration name, for example "Mac mini M4 Pro 48GB 1TB". */
export function listingName(listing: ResultListing): string {
  const storage =
    listing.ssdGb >= 1000 && listing.ssdGb % 1000 === 0
      ? `${listing.ssdGb / 1000}TB`
      : `${listing.ssdGb}GB`;
  return `${listing.model} ${listing.chip.family} ${listing.ramGb}GB ${storage}`;
}
