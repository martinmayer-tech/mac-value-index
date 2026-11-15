import {cp, mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';

import {sampleChip, sampleChipsFile, sampleProfile} from '@mvi/contracts';
import {beforeEach, describe, expect, it} from 'vitest';
import {stringify} from 'yaml';

import type {RawListing, SourceAdapter} from '../collect/types.js';
import {
  listResultDates,
  readIndex,
  readProfiles,
  readResults,
  readSnapshot,
  Repository,
  stableJson,
} from '../io/files.js';

import {
  EXIT_ERROR,
  EXIT_GUARD,
  EXIT_INVALID,
  EXIT_OK,
  runCli,
} from './commands.js';
import type {CliDeps} from './commands.js';
import {validateRepository} from './validate.js';

function raw(index: number, overrides: Partial<RawListing> = {}): RawListing {
  return {
    title: `Mac mini ${index}`,
    model: 'Mac mini',
    year: 2024,
    formFactor: 'desktop',
    chipFamily: 'M4 Pro',
    cpuCores: 12,
    gpuCores: 16,
    ramGb: 16 + index,
    ssdGb: 1000,
    condition: 'new',
    grade: null,
    warrantyMonths: 12,
    priceGbp: 1500 + index * 10,
    rrpGbp: null,
    seller: 'Apple UK',
    sourceUrl: `https://example.com/${index}`,
    retrievedDate: '2026-01-05',
    collectedBy: 'structured',
    sku: null,
    note: null,
    ...overrides,
  };
}

function adapter(listings: () => readonly RawListing[]): SourceAdapter {
  return {
    id: 'apple-uk-new',
    kind: 'structured',
    condition: 'new',
    name: 'Apple UK Store',
    url: 'https://example.com/store',
    collect: () => Promise.resolve(listings()),
  };
}

const fifty = (): readonly RawListing[] =>
  Array.from({length: 50}, (_, index) => raw(index));

interface Harness {
  readonly root: string;
  readonly repository: Repository;
  readonly out: string[];
  readonly err: string[];
  run(argv: readonly string[], overrides?: Partial<CliDeps>): Promise<number>;
}

async function harness(): Promise<Harness> {
  const root = await mkdtemp(path.join(tmpdir(), 'mvi-cli-'));
  await mkdir(path.join(root, 'data'), {recursive: true});
  await mkdir(path.join(root, 'profiles'), {recursive: true});
  await writeFile(
    path.join(root, 'data', 'chips.json'),
    stableJson(sampleChipsFile([sampleChip()])),
  );
  for (const profile of [
    sampleProfile(),
    sampleProfile({id: 'cpu-heavy', isDefault: false}),
  ]) {
    await writeFile(
      path.join(root, 'profiles', `${profile.id}.yaml`),
      stringify(profile),
    );
  }
  const out: string[] = [];
  const err: string[] = [];
  let day = 4;
  return {
    root,
    repository: new Repository(root),
    out,
    err,
    run: (argv, overrides = {}) =>
      runCli(argv, {
        root,
        out: line => out.push(line),
        err: line => err.push(line),
        env: {},
        today: () => `2026-01-${String(++day).padStart(2, '0')}`,
        adapters: [adapter(fifty)],
        ...overrides,
      }),
  };
}

let h: Harness;
beforeEach(async () => {
  h = await harness();
});

describe('backend CLI', () => {
  it('runs every stage and writes all outputs', async () => {
    expect(await h.run(['run'])).toBe(EXIT_OK);
    const snapshot = await readSnapshot(h.repository, '2026-01-05');
    expect(snapshot.listings).toHaveLength(50);
    const results = await readResults(h.repository, '2026-01-05');
    expect(results.profiles).toHaveLength(2);
    expect(await readIndex(h.repository)).toEqual({
      schemaVersion: 1,
      latest: '2026-01-05',
      snapshots: ['2026-01-05'],
    });
    const report = await readFile(
      h.repository.reportFile('2026-01-05'),
      'utf8',
    );
    expect(report).toContain('## Conclusion');
    const csv = await readFile(h.repository.csvFile('2026-01-05'), 'utf8');
    expect(csv.split('\n')).toHaveLength(52);
    expect(h.out.join('\n')).toContain('Anomaly guards passed.');
    expect(await h.run(['validate'])).toBe(EXIT_OK);
  });

  it('scores deterministically: a second run is byte-identical', async () => {
    await h.run(['collect']);
    await h.run(['score']);
    const file = h.repository.resultsFile('2026-01-05');
    const first = await readFile(file, 'utf8');
    expect(await h.run(['score', '--snapshot', '2026-01-05'])).toBe(EXIT_OK);
    expect(await readFile(file, 'utf8')).toBe(first);
  });

  it('writes a diff between two runs, and the job summary', async () => {
    await h.run(['run']);
    const summary = path.join(h.root, 'summary.md');
    const diffFile = path.join(h.root, 'out', 'diff.md');
    const cheaper = (): readonly RawListing[] =>
      fifty().map((listing, index) =>
        index === 0 ? {...listing, priceGbp: 1400} : listing,
      );
    const code = await h.run(['run', '--diff-output', diffFile], {
      adapters: [adapter(cheaper)],
      env: {GITHUB_STEP_SUMMARY: summary},
    });
    expect(code).toBe(EXIT_OK);
    expect(await readFile(diffFile, 'utf8')).toContain('1 price changes');
    expect(h.out).toContain('Changes found.');
    expect(await readFile(summary, 'utf8')).toContain('Research run succeeded');
    expect(await listResultDates(h.repository)).toEqual([
      '2026-01-05',
      '2026-01-06',
    ]);

    h.out.length = 0;
    expect(await h.run(['diff', '2026-01-05', '2026-01-06'])).toBe(EXIT_OK);
    expect(h.out.join('\n')).toContain(
      '## Changes from 2026-01-05 to 2026-01-06',
    );

    expect(await h.run(['run'], {adapters: [adapter(cheaper)]})).toBe(EXIT_OK);
    expect(h.out).toContain('No listing, price or ranking changed.');
  });

  it('exits 3 on a guard failure but still writes everything', async () => {
    const report = path.join(h.root, 'guards.md');
    const summary = path.join(h.root, 'summary.md');
    const code = await h.run(['run', '--guard-report', report], {
      adapters: [adapter(() => fifty().slice(0, 10))],
      env: {GITHUB_STEP_SUMMARY: summary},
    });
    expect(code).toBe(EXIT_GUARD);
    expect(await readFile(report, 'utf8')).toContain(
      '**too-few-listings**: Only 10 listings were collected',
    );
    expect(await readFile(summary, 'utf8')).toContain('Anomaly guards failed');
    expect(
      (await readResults(h.repository, '2026-01-05')).listings,
    ).toHaveLength(10);
    expect(
      await h.run(['collect'], {
        adapters: [adapter(() => fifty().slice(0, 10))],
      }),
    ).toBe(EXIT_GUARD);
  });

  it('exits 1 and writes nothing when no source succeeds', async () => {
    const failing: SourceAdapter = {
      ...adapter(fifty),
      collect: () => Promise.reject(new Error('HTTP 503')),
    };
    expect(await h.run(['run'], {adapters: [failing]})).toBe(EXIT_ERROR);
    expect(h.err).toContain('No source succeeded; nothing was written.');
    expect(await listResultDates(h.repository)).toEqual([]);
  });

  it('exits 2 when a listing has a chip missing from chips.json', async () => {
    const code = await h.run(['collect'], {
      adapters: [adapter(() => [...fifty(), raw(99, {chipFamily: 'M9'})])],
    });
    expect(code).toBe(EXIT_INVALID);
    expect(h.err.join('\n')).toContain('M9 with 12-core CPU and 16-core GPU');
  });

  it('prints adapter warnings and honours --source and --date', async () => {
    const noisy: SourceAdapter = {
      ...adapter(fifty),
      collect: context => {
        context.warn('odd tile');
        return Promise.resolve(fifty());
      },
    };
    expect(
      await h.run(
        ['collect', '--source', 'apple-uk-new', '--date', '2026-02-01'],
        {
          adapters: [noisy],
          sleep: () => Promise.resolve(),
          fetch: () => Promise.resolve(new Response('')),
        },
      ),
    ).toBe(EXIT_OK);
    expect(h.err).toContain('warning: apple-uk-new: odd tile');
    expect((await readSnapshot(h.repository, '2026-02-01')).snapshotDate).toBe(
      '2026-02-01',
    );
    expect(await h.run(['collect', '--source', 'nope'])).toBe(EXIT_ERROR);
    expect(h.err.join('\n')).toContain(
      'Unknown source: nope. Known: apple-uk-new.',
    );
    expect(await h.run(['collect', '--date', 'tomorrow'])).toBe(EXIT_ERROR);
  });

  it('explains usage errors', async () => {
    expect(await h.run([])).toBe(EXIT_ERROR);
    expect(await h.run(['help'])).toBe(EXIT_OK);
    expect(await h.run(['score', '--help'])).toBe(EXIT_OK);
    expect(h.out.join('\n')).toContain('Usage: pnpm backend <command>');
    expect(await h.run(['frobnicate'])).toBe(EXIT_ERROR);
    expect(h.err).toContain('Unknown command "frobnicate".');
    expect(await h.run(['diff', '2026-01-05'])).toBe(EXIT_ERROR);
    expect(await h.run(['score', '--bogus'])).toBe(EXIT_ERROR);
  });

  it('fails cleanly with no snapshot, and reports contract errors as invalid', async () => {
    const summary = path.join(h.root, 'summary.md');
    expect(await h.run(['score'], {env: {GITHUB_STEP_SUMMARY: summary}})).toBe(
      EXIT_ERROR,
    );
    expect(h.err).toContain('No snapshot found in data/listings/.');
    expect(await readFile(summary, 'utf8')).toContain('Backend failed');
    await h.run(['collect']);
    await writeFile(h.repository.chipsFile, '{"schemaVersion": 1}');
    expect(await h.run(['score'])).toBe(EXIT_INVALID);
    expect(h.err.join('\n')).toContain('data/chips.json failed validation');
  });
});

describe('validate', () => {
  it('passes an empty repository with valid inputs', async () => {
    const report = await validateRepository(h.repository);
    expect(report.errors).toEqual([]);
  });

  it('collects every problem instead of stopping at the first', async () => {
    await h.run(['run']);
    const summary = path.join(h.root, 'summary.md');
    await writeFile(h.repository.chipsFile, '{"schemaVersion": 99}');
    await writeFile(
      path.join(h.root, 'profiles', 'cpu-heavy.yaml'),
      stringify({
        ...sampleProfile({id: 'cpu-heavy'}),
        weights: {multiCore: 100},
      }),
    );
    await rm(h.repository.csvFile('2026-01-05'));
    const results = h.repository.resultsFile('2026-01-05');
    await writeFile(
      results,
      (await readFile(results, 'utf8')).replace(
        '"geekbenchVersion": "6"',
        '"geekbenchVersion": 6',
      ),
    );
    expect(
      await h.run(['validate'], {env: {GITHUB_STEP_SUMMARY: summary}}),
    ).toBe(EXIT_INVALID);
    const errors = h.err.join('\n');
    expect(errors).toContain('data/chips.json failed validation');
    expect(errors).toContain('unsupported version 99');
    expect(errors).toContain('profiles/cpu-heavy.yaml failed validation');
    expect(errors).toContain('results/2026-01-05/ranking.csv: missing.');
    expect(errors).toContain(
      'results/2026-01-05/results.json failed validation',
    );
    expect(errors).toContain('geekbenchVersion');
    expect(await readFile(summary, 'utf8')).toContain('Validation failed');
  });

  it('checks defaults, chip mapping, file names and the index', async () => {
    await h.run(['run']);
    await writeFile(
      path.join(h.root, 'profiles', 'cpu-heavy.yaml'),
      stringify(sampleProfile({id: 'cpu-heavy'})),
    );
    await writeFile(
      h.repository.chipsFile,
      stableJson(sampleChipsFile([sampleChip({id: 'renamed-chip'})])),
    );
    await cp(
      h.repository.snapshotFile('2026-01-05'),
      h.repository.snapshotFile('2026-01-09'),
    );
    await cp(
      path.join(h.repository.resultsDir, '2026-01-05'),
      path.join(h.repository.resultsDir, '2026-01-09'),
      {recursive: true},
    );
    const {errors} = await validateRepository(h.repository);
    const all = errors.join('\n');
    expect(all).toContain('exactly one profile must be the default; found 2.');
    expect(all).toContain(
      'is not mapped to a chip in chips.json ("m4-pro-12c-16g")',
    );
    expect(all).toContain(
      'data/listings/2026-01-09.json: snapshotDate 2026-01-05 does not match the file name',
    );
    expect(all).toContain(
      'results/2026-01-09/results.json: snapshotDate 2026-01-05 does not match the directory name',
    );
    expect(all).toContain(
      'results/index.json: snapshots do not match the result directories.',
    );
  });

  it('rejects a profile whose id does not match its file name', async () => {
    await writeFile(
      path.join(h.root, 'profiles', 'misnamed.yaml'),
      stringify(sampleProfile({id: 'other', isDefault: false})),
    );
    await writeFile(path.join(h.root, 'profiles', 'notes.txt'), 'ignored');
    await expect(readProfiles(h.repository)).rejects.toThrow(
      'profiles/misnamed.yaml: profile id "other" does not match the file name',
    );
  });
});
