// All file reads and writes for the backend live here.

import {mkdir, readdir, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';

import {
  assertSupportedSchemaVersion,
  chipsFileSchema,
  listingSnapshotSchema,
  parseContract,
  profileSchema,
  resultsIndexSchema,
  resultsSchema,
} from '@mvi/contracts';
import type {
  ChipsFile,
  ListingSnapshot,
  Profile,
  Results,
  ResultsIndex,
} from '@mvi/contracts';
import {parse as parseYaml} from 'yaml';
import type {z} from 'zod';

const DATE_FILE = /^(\d{4}-\d{2}-\d{2})\.json$/;
const DATE_DIR = /^\d{4}-\d{2}-\d{2}$/;

/** Locations of every data file, relative to the repository root. */
export class Repository {
  readonly root: string;

  constructor(root: string) {
    this.root = root;
  }

  get chipsFile(): string {
    return path.join(this.root, 'data', 'chips.json');
  }
  get listingsDir(): string {
    return path.join(this.root, 'data', 'listings');
  }
  get profilesDir(): string {
    return path.join(this.root, 'profiles');
  }
  get resultsDir(): string {
    return path.join(this.root, 'results');
  }
  get indexFile(): string {
    return path.join(this.resultsDir, 'index.json');
  }
  get cacheDir(): string {
    return path.join(this.root, '.cache');
  }
  snapshotFile(date: string): string {
    return path.join(this.listingsDir, `${date}.json`);
  }
  resultsFile(date: string): string {
    return path.join(this.resultsDir, date, 'results.json');
  }
  reportFile(date: string): string {
    return path.join(this.resultsDir, date, 'report.md');
  }
  csvFile(date: string): string {
    return path.join(this.resultsDir, date, 'ranking.csv');
  }
  /** Path shown in messages: relative to the root, with forward slashes. */
  relative(file: string): string {
    return path.relative(this.root, file).split(path.sep).join('/');
  }
}

/** Fixed JSON formatting, so output is byte-identical between runs. */
export function stableJson(data: unknown): string {
  return `${JSON.stringify(data, null, 2)}\n`;
}

async function readUnknownJson(file: string): Promise<unknown> {
  const parsed: unknown = JSON.parse(await readFile(file, 'utf8'));
  return parsed;
}

async function readValidated<Schema extends z.ZodType>(
  repository: Repository,
  file: string,
  schema: Schema,
): Promise<z.infer<Schema>> {
  const name = repository.relative(file);
  const data = await readUnknownJson(file);
  assertSupportedSchemaVersion(data, name);
  return parseContract(schema, data, name);
}

/** Validates, then writes with fixed formatting. Keys follow the schema. */
async function writeValidated(
  repository: Repository,
  file: string,
  schema: z.ZodType,
  data: unknown,
): Promise<void> {
  const parsed = parseContract(schema, data, repository.relative(file));
  await writeText(file, stableJson(parsed));
}

export async function writeText(file: string, text: string): Promise<void> {
  await mkdir(path.dirname(file), {recursive: true});
  await writeFile(file, text, 'utf8');
}

export async function readText(file: string): Promise<string> {
  return readFile(file, 'utf8');
}

async function listDir(directory: string): Promise<readonly string[]> {
  try {
    return (await readdir(directory)).sort();
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

export async function readChips(repository: Repository): Promise<ChipsFile> {
  return readValidated(repository, repository.chipsFile, chipsFileSchema);
}

/** Snapshot dates on disk, oldest first. */
export async function listSnapshotDates(
  repository: Repository,
): Promise<readonly string[]> {
  const dates: string[] = [];
  for (const name of await listDir(repository.listingsDir)) {
    const date = DATE_FILE.exec(name)?.[1];
    if (date !== undefined) {
      dates.push(date);
    }
  }
  return dates;
}

/** Result dates on disk, oldest first. */
export async function listResultDates(
  repository: Repository,
): Promise<readonly string[]> {
  return (await listDir(repository.resultsDir)).filter(name =>
    DATE_DIR.test(name),
  );
}

export async function readSnapshot(
  repository: Repository,
  date: string,
): Promise<ListingSnapshot> {
  const file = repository.snapshotFile(date);
  const snapshot = await readValidated(repository, file, listingSnapshotSchema);
  if (snapshot.snapshotDate !== date) {
    throw new Error(
      `${repository.relative(file)}: snapshotDate ${snapshot.snapshotDate} does not match the file name`,
    );
  }
  return snapshot;
}

export async function writeSnapshot(
  repository: Repository,
  snapshot: ListingSnapshot,
): Promise<string> {
  const file = repository.snapshotFile(snapshot.snapshotDate);
  await writeValidated(repository, file, listingSnapshotSchema, snapshot);
  return file;
}

/** Reads every profile, in file-name order. */
export async function readProfiles(
  repository: Repository,
): Promise<readonly Profile[]> {
  const profiles: Profile[] = [];
  for (const name of await listDir(repository.profilesDir)) {
    if (!name.endsWith('.yaml')) {
      continue;
    }
    const file = path.join(repository.profilesDir, name);
    const relative = repository.relative(file);
    const data: unknown = parseYaml(await readFile(file, 'utf8'));
    assertSupportedSchemaVersion(data, relative);
    const profile = parseContract(profileSchema, data, relative);
    if (`${profile.id}.yaml` !== name) {
      throw new Error(
        `${relative}: profile id "${profile.id}" does not match the file name`,
      );
    }
    profiles.push(profile);
  }
  return profiles;
}

export async function readResults(
  repository: Repository,
  date: string,
): Promise<Results> {
  const file = repository.resultsFile(date);
  const results = await readValidated(repository, file, resultsSchema);
  if (results.snapshotDate !== date) {
    throw new Error(
      `${repository.relative(file)}: snapshotDate ${results.snapshotDate} does not match the directory name`,
    );
  }
  return results;
}

export async function writeResults(
  repository: Repository,
  results: Results,
): Promise<string> {
  const file = repository.resultsFile(results.snapshotDate);
  await writeValidated(repository, file, resultsSchema, results);
  return file;
}

export async function readIndex(repository: Repository): Promise<ResultsIndex> {
  return readValidated(repository, repository.indexFile, resultsIndexSchema);
}

/** Rewrites results/index.json from the result directories on disk. */
export async function writeIndex(
  repository: Repository,
): Promise<ResultsIndex> {
  const snapshots = [...(await listResultDates(repository))];
  const latest = snapshots.at(-1);
  if (latest === undefined) {
    throw new Error('No results to index.');
  }
  const index: ResultsIndex = {schemaVersion: 1, latest, snapshots};
  await writeValidated(
    repository,
    repository.indexFile,
    resultsIndexSchema,
    index,
  );
  return index;
}
