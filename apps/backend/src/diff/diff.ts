// Change summary between two snapshots and their results, as markdown for
// the research pull request description.

import type {
  Listing,
  ListingSnapshot,
  ProfileResult,
  Results,
} from '@mvi/contracts';

import {
  conditionLabel,
  formatGbp,
  formatNumber,
  formatStorage,
} from '../scoring/text.js';

export interface DiffInput {
  readonly fromSnapshot: ListingSnapshot;
  readonly toSnapshot: ListingSnapshot;
  readonly fromResults: Results;
  readonly toResults: Results;
}

export interface DiffSummary {
  readonly markdown: string;
  /** True when any listing, price or ranking changed. */
  readonly hasChanges: boolean;
}

function describe(listing: Listing): string {
  return `${listing.title} ${listing.ramGb}GB ${formatStorage(listing.ssdGb)} (${conditionLabel(listing.condition)}, ${listing.seller})`;
}

function defaultResult(results: Results): ProfileResult | undefined {
  return results.profiles.find(
    result => result.profile.id === results.defaultProfileId,
  );
}

function bullets(lines: readonly string[], empty: string): string {
  return lines.length === 0 ? empty : lines.map(line => `- ${line}`).join('\n');
}

function sameOrder(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

/** Builds the change summary. */
export function renderDiff(input: DiffInput): DiffSummary {
  const {fromSnapshot, toSnapshot, fromResults, toResults} = input;
  const before = new Map(fromSnapshot.listings.map(l => [l.id, l]));
  const after = new Map(toSnapshot.listings.map(l => [l.id, l]));

  const added = toSnapshot.listings.filter(l => !before.has(l.id));
  const removed = fromSnapshot.listings.filter(l => !after.has(l.id));
  const priceChanges: {
    readonly listing: Listing;
    readonly from: number;
    readonly change: number;
  }[] = [];
  for (const listing of toSnapshot.listings) {
    const previous = before.get(listing.id);
    if (previous !== undefined && previous.priceGbp !== listing.priceGbp) {
      priceChanges.push({
        listing,
        from: previous.priceGbp,
        change: listing.priceGbp - previous.priceGbp,
      });
    }
  }
  priceChanges.sort(
    (a, b) =>
      Math.abs(b.change) - Math.abs(a.change) ||
      (a.listing.id < b.listing.id ? -1 : 1),
  );

  const fromTop = defaultResult(fromResults)?.top10 ?? [];
  const toTop = defaultResult(toResults)?.top10 ?? [];
  const names = new Map<string, string>();
  for (const listing of [...fromSnapshot.listings, ...toSnapshot.listings]) {
    names.set(listing.id, describe(listing));
  }
  const name = (id: string): string => names.get(id) ?? id;
  const movement: string[] = [];
  for (const [index, id] of toTop.entries()) {
    const was = fromTop.indexOf(id);
    if (was < 0) {
      movement.push(`New at ${index + 1}: ${name(id)}`);
    } else if (was !== index) {
      movement.push(`${was + 1} to ${index + 1}: ${name(id)}`);
    }
  }
  for (const [index, id] of fromTop.entries()) {
    if (!toTop.includes(id)) {
      movement.push(`Dropped out (was ${index + 1}): ${name(id)}`);
    }
  }

  const fromWinner = fromTop[0] ?? null;
  const toWinner = toTop[0] ?? null;
  const winnerChanged = fromWinner !== toWinner;
  const failedSources = toSnapshot.sourceStatus.filter(s => s.status !== 'ok');
  const agentListings = toSnapshot.listings.filter(
    l => l.collectedBy === 'agent',
  );
  const rankingChanged = fromResults.profiles.some((result, index) => {
    const other = toResults.profiles[index];
    return (
      other?.profile.id !== result.profile.id ||
      !sameOrder(
        result.ranking.map(entry => entry.listingId),
        other.ranking.map(entry => entry.listingId),
      )
    );
  });

  const sections: string[] = [];
  if (winnerChanged) {
    sections.push(
      `> **The overall winner changed**: from ${fromWinner === null ? 'none' : name(fromWinner)} to ${toWinner === null ? 'none' : name(toWinner)}.`,
    );
  }
  sections.push(
    `## Changes from ${fromSnapshot.snapshotDate} to ${toSnapshot.snapshotDate}`,
    `${fromSnapshot.listings.length} listings before, ${toSnapshot.listings.length} after: ${added.length} added, ${removed.length} removed, ${priceChanges.length} price changes.`,
    `### Listings added (${added.length})`,
    bullets(
      added.map(l => `${describe(l)}: ${formatGbp(l.priceGbp)}`),
      'None.',
    ),
    `### Listings removed (${removed.length})`,
    bullets(
      removed.map(l => `${describe(l)}: was ${formatGbp(l.priceGbp)}`),
      'None.',
    ),
    `### Price changes, largest first (${priceChanges.length})`,
    bullets(
      priceChanges.map(
        ({listing, from, change}) =>
          `${describe(listing)}: ${formatGbp(from)} to ${formatGbp(listing.priceGbp)} (${change > 0 ? '+' : '-'}${formatGbp(Math.abs(change))}, ${change > 0 ? '+' : '-'}${formatNumber((Math.abs(change) / from) * 100, 1)}%)`,
      ),
      'None.',
    ),
    `### Movement in the top 10 (${toResults.defaultProfileId})`,
    bullets(movement, 'No movement.'),
    '### Sources that failed or were skipped',
    bullets(
      failedSources.map(s =>
        `${s.name} (\`${s.adapterId}\`): ${s.status}. ${s.error ?? ''}`.trim(),
      ),
      'None.',
    ),
    `### Agent-collected listings that need a human check (${agentListings.length})`,
    bullets(
      agentListings.map(
        l => `${describe(l)}: ${formatGbp(l.priceGbp)}, ${l.sourceUrl}`,
      ),
      'None.',
    ),
  );

  return {
    markdown: `${sections.join('\n\n')}\n`,
    hasChanges:
      added.length > 0 ||
      removed.length > 0 ||
      priceChanges.length > 0 ||
      rankingChanged,
  };
}
