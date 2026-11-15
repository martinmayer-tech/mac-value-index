// Stage wiring for the CLI. Each command reads files and writes files.

import {appendFile} from 'node:fs/promises';
import {parseArgs} from 'node:util';

import type {ListingSnapshot} from '@mvi/contracts';

import {ADAPTERS} from '../collect/adapters/index.js';
import {collect} from '../collect/collect.js';
import {runGuards} from '../collect/guards.js';
import type {GuardFailure} from '../collect/guards.js';
import {HttpClient} from '../collect/http.js';
import type {SourceAdapter} from '../collect/types.js';
import {renderDiff} from '../diff/diff.js';
import {
  listSnapshotDates,
  readChips,
  readProfiles,
  readResults,
  readSnapshot,
  Repository,
  writeIndex,
  writeResults,
  writeSnapshot,
  writeText,
} from '../io/files.js';
import {renderCsv} from '../report/csv.js';
import {renderReport} from '../report/markdown.js';
import {buildResults} from '../scoring/build-results.js';

import {validateRepository} from './validate.js';

export const EXIT_OK = 0;
export const EXIT_ERROR = 1;
export const EXIT_INVALID = 2;
export const EXIT_GUARD = 3;

export interface CliDeps {
  /** Repository root. */
  readonly root: string;
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
  readonly env: Readonly<Record<string, string | undefined>>;
  /** Today's date as YYYY-MM-DD. Only the collect stage reads the clock. */
  readonly today: () => string;
  readonly adapters?: readonly SourceAdapter[];
  readonly fetch?: typeof fetch;
  readonly sleep?: (milliseconds: number) => Promise<void>;
}

const USAGE = `Usage: pnpm backend <command> [options]

Commands:
  collect [--source <id>]... [--date <YYYY-MM-DD>] [--guard-report <file>]
  validate
  score [--snapshot <date>]
  report [--snapshot <date>]
  diff <from> <to> [--output <file>]
  run [--source <id>]... [--date <date>] [--diff-output <file>] [--guard-report <file>]

Exit codes: 0 success, 1 error, 2 validation failure, 3 anomaly guard failure.`;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

class UsageError extends Error {}

async function jobSummary(deps: CliDeps, markdown: string): Promise<void> {
  const file = deps.env['GITHUB_STEP_SUMMARY'];
  if (file !== undefined && file !== '') {
    await appendFile(file, `${markdown}\n`, 'utf8');
  }
}

async function latestSnapshotDate(repository: Repository): Promise<string> {
  const latest = (await listSnapshotDates(repository)).at(-1);
  if (latest === undefined) {
    throw new Error('No snapshot found in data/listings/.');
  }
  return latest;
}

function requireDate(value: string | undefined, name: string): string | null {
  if (value === undefined) {
    return null;
  }
  if (!DATE.test(value)) {
    throw new UsageError(`${name} must be a date as YYYY-MM-DD.`);
  }
  return value;
}

function guardMarkdown(failures: readonly GuardFailure[]): string {
  return [
    '## Anomaly guards failed',
    '',
    ...failures.map(failure => `- **${failure.guard}**: ${failure.message}`),
    '',
  ].join('\n');
}

interface CollectOutcome {
  readonly code: number;
  readonly snapshot: ListingSnapshot | null;
  readonly previousDate: string | null;
}

interface CollectFlags {
  readonly source?: string[] | undefined;
  readonly date?: string | undefined;
  readonly 'guard-report'?: string | undefined;
}

async function collectStage(
  deps: CliDeps,
  repository: Repository,
  flags: CollectFlags,
): Promise<CollectOutcome> {
  const date = requireDate(flags.date, '--date') ?? deps.today();
  const adapters = deps.adapters ?? ADAPTERS;
  const only = flags.source ?? null;
  const unknown = (only ?? []).filter(
    id => !adapters.some(adapter => adapter.id === id),
  );
  if (unknown.length > 0) {
    throw new UsageError(
      `Unknown source: ${unknown.join(', ')}. Known: ${adapters.map(a => a.id).join(', ')}.`,
    );
  }
  const chips = await readChips(repository);
  const http = new HttpClient({
    cacheDir: repository.cacheDir,
    date,
    ...(deps.fetch === undefined ? {} : {fetch: deps.fetch}),
    ...(deps.sleep === undefined ? {} : {sleep: deps.sleep}),
  });
  const result = await collect({
    adapters,
    only,
    http,
    chips,
    date,
    log: deps.out,
  });
  for (const warning of result.warnings) {
    deps.err(`warning: ${warning}`);
  }
  const previousDate =
    (await listSnapshotDates(repository)).filter(d => d < date).at(-1) ?? null;

  if (!result.snapshot.sourceStatus.some(status => status.status === 'ok')) {
    const reason = 'No source succeeded; nothing was written.';
    deps.err(reason);
    await jobSummary(deps, `## Collection failed\n\n${reason}`);
    return {code: EXIT_ERROR, snapshot: null, previousDate};
  }
  if (result.unmapped.length > 0) {
    const reason = [
      'Listings refer to chip variants missing from data/chips.json; nothing was written:',
      ...result.unmapped.map(item => `  - ${item}`),
    ].join('\n');
    deps.err(reason);
    await jobSummary(deps, `## Collection failed validation\n\n${reason}`);
    return {code: EXIT_INVALID, snapshot: null, previousDate};
  }

  const file = await writeSnapshot(repository, result.snapshot);
  deps.out(
    `Wrote ${repository.relative(file)}: ${result.snapshot.listings.length} listings (${http.networkRequests} requests).`,
  );

  const previous =
    previousDate === null ? null : await readSnapshot(repository, previousDate);
  const failures = runGuards(result.snapshot, previous);
  if (failures.length > 0) {
    const markdown = guardMarkdown(failures);
    deps.err(markdown);
    await jobSummary(deps, markdown);
    if (flags['guard-report'] !== undefined) {
      await writeText(flags['guard-report'], markdown);
    }
    return {code: EXIT_GUARD, snapshot: result.snapshot, previousDate};
  }
  deps.out('Anomaly guards passed.');
  return {code: EXIT_OK, snapshot: result.snapshot, previousDate};
}

async function validateStage(
  deps: CliDeps,
  repository: Repository,
): Promise<number> {
  const report = await validateRepository(repository);
  if (report.errors.length > 0) {
    for (const error of report.errors) {
      deps.err(error);
    }
    deps.err(`Validation failed: ${report.errors.length} problems.`);
    await jobSummary(
      deps,
      `## Validation failed\n\n${report.errors.map(e => `- ${e}`).join('\n')}`,
    );
    return EXIT_INVALID;
  }
  deps.out(`Validation passed: ${report.filesChecked} files.`);
  return EXIT_OK;
}

async function scoreStage(
  deps: CliDeps,
  repository: Repository,
  snapshotFlag: string | undefined,
): Promise<string> {
  const date =
    requireDate(snapshotFlag, '--snapshot') ??
    (await latestSnapshotDate(repository));
  const results = buildResults(
    await readSnapshot(repository, date),
    await readChips(repository),
    await readProfiles(repository),
  );
  const file = await writeResults(repository, results);
  await writeIndex(repository);
  deps.out(`Wrote ${repository.relative(file)} and results/index.json.`);
  return date;
}

async function reportStage(
  deps: CliDeps,
  repository: Repository,
  snapshotFlag: string | undefined,
): Promise<void> {
  const date =
    requireDate(snapshotFlag, '--snapshot') ??
    (await latestSnapshotDate(repository));
  const results = await readResults(repository, date);
  await writeText(repository.reportFile(date), renderReport(results));
  await writeText(repository.csvFile(date), renderCsv(results));
  deps.out(
    `Wrote ${repository.relative(repository.reportFile(date))} and ${repository.relative(repository.csvFile(date))}.`,
  );
}

async function diffStage(
  deps: CliDeps,
  repository: Repository,
  from: string,
  to: string,
  output: string | undefined,
): Promise<boolean> {
  const summary = renderDiff({
    fromSnapshot: await readSnapshot(repository, from),
    toSnapshot: await readSnapshot(repository, to),
    fromResults: await readResults(repository, from),
    toResults: await readResults(repository, to),
  });
  if (output === undefined) {
    deps.out(summary.markdown);
  } else {
    await writeText(output, summary.markdown);
    deps.out(`Wrote ${output}.`);
  }
  return summary.hasChanges;
}

/** Runs one CLI command and returns the process exit code. */
export async function runCli(
  argv: readonly string[],
  deps: CliDeps,
): Promise<number> {
  const [command, ...rest] = argv;
  const repository = new Repository(deps.root);
  try {
    const {values, positionals} = parseArgs({
      args: rest,
      allowPositionals: true,
      options: {
        source: {type: 'string', multiple: true},
        date: {type: 'string'},
        snapshot: {type: 'string'},
        output: {type: 'string'},
        'diff-output': {type: 'string'},
        'guard-report': {type: 'string'},
        help: {type: 'boolean', short: 'h'},
      },
    });
    if (command === undefined || command === 'help' || values.help === true) {
      deps.out(USAGE);
      return command === undefined ? EXIT_ERROR : EXIT_OK;
    }
    switch (command) {
      case 'collect':
        return (await collectStage(deps, repository, values)).code;
      case 'validate':
        return await validateStage(deps, repository);
      case 'score':
        await scoreStage(deps, repository, values.snapshot);
        return EXIT_OK;
      case 'report':
        await reportStage(deps, repository, values.snapshot);
        return EXIT_OK;
      case 'diff': {
        const from = requireDate(positionals[0], '<from>');
        const to = requireDate(positionals[1], '<to>');
        if (from === null || to === null) {
          throw new UsageError('diff needs two snapshot dates: <from> <to>.');
        }
        await diffStage(deps, repository, from, to, values.output);
        return EXIT_OK;
      }
      case 'run': {
        const collected = await collectStage(deps, repository, values);
        if (collected.snapshot === null) {
          return collected.code;
        }
        const date = collected.snapshot.snapshotDate;
        await scoreStage(deps, repository, date);
        await reportStage(deps, repository, date);
        const validation = await validateStage(deps, repository);
        if (validation !== EXIT_OK) {
          return validation;
        }
        if (collected.previousDate !== null) {
          const changed = await diffStage(
            deps,
            repository,
            collected.previousDate,
            date,
            values['diff-output'],
          );
          deps.out(
            changed
              ? 'Changes found.'
              : 'No listing, price or ranking changed.',
          );
        }
        if (collected.code === EXIT_OK) {
          await jobSummary(
            deps,
            `## Research run succeeded\n\nSnapshot ${date}: ${collected.snapshot.listings.length} listings.`,
          );
        }
        return collected.code;
      }
      default:
        throw new UsageError(`Unknown command "${command}".`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    deps.err(message);
    if (error instanceof UsageError) {
      deps.err(USAGE);
      return EXIT_ERROR;
    }
    await jobSummary(deps, `## Backend failed\n\n\`\`\`\n${message}\n\`\`\``);
    return error instanceof Error && error.name === 'ContractError'
      ? EXIT_INVALID
      : EXIT_ERROR;
  }
}
