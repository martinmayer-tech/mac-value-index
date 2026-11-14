// Reads results/ at build time and validates every file against the
// contract schemas. Any failure stops the build, naming the file and field.

import {readFile} from 'node:fs/promises';
import path from 'node:path';

import {
  assertSupportedSchemaVersion,
  ContractError,
  parseContract,
  resultsIndexSchema,
  resultsSchema,
} from '@mvi/contracts';
import type {Results} from '@mvi/contracts';

export interface Snapshot {
  readonly date: string;
  readonly isLatest: boolean;
  readonly results: Results;
  readonly reportMarkdown: string;
  readonly rankingCsv: string;
}

/** Directory holding index.json and the dated result directories. */
export function resultsDirectory(
  env: Readonly<Record<string, string | undefined>>,
  appRoot: string,
): string {
  const override = env['MVI_RESULTS_DIR'];
  return override !== undefined && override !== ''
    ? path.resolve(override)
    : path.resolve(appRoot, '..', '..', 'results');
}

async function readJson(file: string, name: string): Promise<unknown> {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch {
    throw new ContractError(name, ['file is missing or unreadable']);
  }
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed;
  } catch {
    throw new ContractError(name, ['file is not valid JSON']);
  }
}

async function readRequired(file: string, name: string): Promise<string> {
  try {
    return await readFile(file, 'utf8');
  } catch {
    throw new ContractError(name, ['file is missing or unreadable']);
  }
}

/** Loads and validates every snapshot, newest first. */
export async function loadSnapshots(
  directory: string,
): Promise<readonly Snapshot[]> {
  const indexName = 'results/index.json';
  const rawIndex = await readJson(
    path.join(directory, 'index.json'),
    indexName,
  );
  assertSupportedSchemaVersion(rawIndex, indexName);
  const index = parseContract(resultsIndexSchema, rawIndex, indexName);

  const snapshots: Snapshot[] = [];
  for (const date of index.snapshots) {
    const name = `results/${date}/results.json`;
    const raw = await readJson(
      path.join(directory, date, 'results.json'),
      name,
    );
    assertSupportedSchemaVersion(raw, name);
    const results = parseContract(resultsSchema, raw, name);
    if (results.snapshotDate !== date) {
      throw new ContractError(name, [
        `snapshotDate: ${results.snapshotDate} does not match the directory`,
      ]);
    }
    snapshots.push({
      date,
      isLatest: date === index.latest,
      results,
      reportMarkdown: await readRequired(
        path.join(directory, date, 'report.md'),
        `results/${date}/report.md`,
      ),
      rankingCsv: await readRequired(
        path.join(directory, date, 'ranking.csv'),
        `results/${date}/ranking.csv`,
      ),
    });
  }
  return snapshots.reverse();
}
