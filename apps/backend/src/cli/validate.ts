// Validates every file in data/, profiles/ and results/ against its schema.

import {access} from 'node:fs/promises';

import {
  listResultDates,
  listSnapshotDates,
  readChips,
  readIndex,
  readProfiles,
  readResults,
  readSnapshot,
} from '../io/files.js';
import type {Repository} from '../io/files.js';

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function exists(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

export interface ValidationReport {
  readonly filesChecked: number;
  readonly errors: readonly string[];
}

/** Checks every data file. Collects all errors instead of stopping. */
export async function validateRepository(
  repository: Repository,
): Promise<ValidationReport> {
  const errors: string[] = [];
  let filesChecked = 0;
  const attempt = async <T>(read: () => Promise<T>): Promise<T | null> => {
    filesChecked++;
    try {
      return await read();
    } catch (error) {
      errors.push(messageOf(error));
      return null;
    }
  };

  const chips = await attempt(() => readChips(repository));
  const chipIds = new Set(chips?.chips.map(chip => chip.id) ?? []);

  const profiles = await attempt(() => readProfiles(repository));
  if (profiles !== null) {
    const defaults = profiles.filter(profile => profile.isDefault).length;
    if (defaults !== 1) {
      errors.push(
        `profiles/: exactly one profile must be the default; found ${defaults}.`,
      );
    }
  }

  for (const date of await listSnapshotDates(repository)) {
    const snapshot = await attempt(() => readSnapshot(repository, date));
    if (snapshot === null || chips === null) {
      continue;
    }
    for (const listing of snapshot.listings) {
      if (!chipIds.has(listing.chipId)) {
        errors.push(
          `data/listings/${date}.json: listing ${listing.id} is not mapped to a chip in chips.json ("${listing.chipId}").`,
        );
      }
    }
  }

  const resultDates = await listResultDates(repository);
  for (const date of resultDates) {
    await attempt(() => readResults(repository, date));
    for (const file of [
      repository.reportFile(date),
      repository.csvFile(date),
    ]) {
      filesChecked++;
      if (!(await exists(file))) {
        errors.push(`${repository.relative(file)}: missing.`);
      }
    }
  }
  if (resultDates.length > 0) {
    const index = await attempt(() => readIndex(repository));
    if (index !== null && index.snapshots.join(',') !== resultDates.join(',')) {
      errors.push(
        'results/index.json: snapshots do not match the result directories.',
      );
    }
  }
  return {filesChecked, errors};
}
