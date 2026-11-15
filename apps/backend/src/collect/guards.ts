// Anomaly guards, run after collection against the previous snapshot.

import {isWholePence} from '@mvi/contracts';
import type {ListingSnapshot} from '@mvi/contracts';

export const MIN_LISTINGS = 40;
export const MAX_COUNT_DROP = 0.2;
export const MAX_PRICE_MOVE = 0.3;

export interface GuardFailure {
  readonly guard:
    | 'listing-count-fell'
    | 'price-moved'
    | 'source-returned-zero'
    | 'too-few-listings'
    | 'missing-provenance'
    | 'invalid-price';
  readonly message: string;
}

function percent(fraction: number): string {
  return `${Math.round(fraction * 1000) / 10}%`;
}

/**
 * Checks a new snapshot. Accepts loosely-typed listings so that it can
 * report bad data rather than rely on the schema having rejected it.
 */
export function runGuards(
  current: ListingSnapshot,
  previous: ListingSnapshot | null,
): readonly GuardFailure[] {
  const failures: GuardFailure[] = [];
  const total = current.listings.length;

  if (total < MIN_LISTINGS) {
    failures.push({
      guard: 'too-few-listings',
      message: `Only ${total} listings were collected; at least ${MIN_LISTINGS} are required.`,
    });
  }

  for (const listing of current.listings) {
    if (listing.sourceUrl === '' || listing.retrievedDate === '') {
      failures.push({
        guard: 'missing-provenance',
        message: `Listing ${listing.id} has no source URL or retrieved date.`,
      });
    }
    if (!(listing.priceGbp > 0) || !isWholePence(listing.priceGbp)) {
      failures.push({
        guard: 'invalid-price',
        message: `Listing ${listing.id} has an invalid price: ${listing.priceGbp}.`,
      });
    }
  }

  if (previous === null) {
    return failures;
  }

  const previousTotal = previous.listings.length;
  if (previousTotal > 0 && total < previousTotal * (1 - MAX_COUNT_DROP)) {
    failures.push({
      guard: 'listing-count-fell',
      message: `Listing count fell from ${previousTotal} to ${total} (${percent(1 - total / previousTotal)}).`,
    });
  }

  const previousPrices = new Map(
    previous.listings.map(listing => [listing.id, listing]),
  );
  for (const listing of current.listings) {
    const before = previousPrices.get(listing.id);
    if (before === undefined) {
      continue;
    }
    const move = Math.abs(listing.priceGbp - before.priceGbp) / before.priceGbp;
    if (move > MAX_PRICE_MOVE) {
      failures.push({
        guard: 'price-moved',
        message: `${listing.title} moved ${percent(move)}: £${before.priceGbp} to £${listing.priceGbp} (${listing.id}).`,
      });
    }
  }

  const currentCounts = new Map(
    current.sourceStatus.map(status => [status.adapterId, status]),
  );
  for (const before of previous.sourceStatus) {
    const now = currentCounts.get(before.adapterId);
    if (before.listingCount > 0 && (now?.listingCount ?? 0) === 0) {
      failures.push({
        guard: 'source-returned-zero',
        message: `Source ${before.adapterId} returned ${before.listingCount} listings last time and zero this time.`,
      });
    }
  }
  return failures;
}
