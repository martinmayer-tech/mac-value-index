import {cp, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';

import {beforeEach, describe, expect, it} from 'vitest';

import {loadSnapshots, resultsDirectory} from './load-results.js';
import {FIXTURE_RESULTS_DIR} from './test-fixture.js';

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'mvi-web-'));
  await cp(FIXTURE_RESULTS_DIR, directory, {recursive: true});
});

async function edit(
  file: string,
  change: (text: string) => string,
): Promise<void> {
  const target = path.join(directory, file);
  await writeFile(target, change(await readFile(target, 'utf8')));
}

describe('loadSnapshots', () => {
  it('loads every snapshot, newest first, with report and CSV', async () => {
    const snapshots = await loadSnapshots(directory);
    expect(snapshots.map(snapshot => snapshot.date)).toEqual([
      '2026-11-14',
      '2026-10-31',
    ]);
    expect(snapshots.map(snapshot => snapshot.isLatest)).toEqual([true, false]);
    expect(snapshots[0]?.reportMarkdown).toContain('# Mac value index');
    expect(snapshots[0]?.rankingCsv.startsWith('rank,listing_id,')).toBe(true);
  });

  it('fails with the file name and the failing field', async () => {
    await edit('2026-11-14/results.json', text =>
      text.replace('"geekbenchVersion": "6"', '"geekbenchVersion": 6'),
    );
    await expect(loadSnapshots(directory)).rejects.toThrow(
      /results\/2026-11-14\/results\.json failed validation:\n {2}geekbenchVersion: /,
    );
  });

  it('fails on an unsupported schema version', async () => {
    await edit('2026-10-31/results.json', text =>
      text.replace('"schemaVersion": 1', '"schemaVersion": 2'),
    );
    await expect(loadSnapshots(directory)).rejects.toThrow(
      /results\/2026-10-31\/results\.json failed validation:\n {2}schemaVersion: unsupported version 2/,
    );
    await edit('index.json', text =>
      text.replace('"schemaVersion": 1', '"schemaVersion": 7'),
    );
    await expect(loadSnapshots(directory)).rejects.toThrow(
      /results\/index\.json failed validation/,
    );
  });

  it('fails when a file is missing, malformed or misplaced', async () => {
    await rm(path.join(directory, '2026-11-14', 'ranking.csv'));
    await expect(loadSnapshots(directory)).rejects.toThrow(
      'results/2026-11-14/ranking.csv failed validation',
    );
    await rm(path.join(directory, '2026-11-14', 'report.md'));
    await expect(loadSnapshots(directory)).rejects.toThrow(
      'results/2026-11-14/report.md failed validation',
    );
    await edit('2026-10-31/results.json', text =>
      text.replace(
        '"snapshotDate": "2026-10-31"',
        '"snapshotDate": "2026-10-30"',
      ),
    );
    await expect(loadSnapshots(directory)).rejects.toThrow(
      'snapshotDate: 2026-10-30 does not match the directory',
    );
    await writeFile(
      path.join(directory, '2026-10-31', 'results.json'),
      '{oops',
    );
    await expect(loadSnapshots(directory)).rejects.toThrow(
      'file is not valid JSON',
    );
    await rm(path.join(directory, 'index.json'));
    await expect(loadSnapshots(directory)).rejects.toThrow(
      'results/index.json failed validation:\n  file is missing or unreadable',
    );
  });
});

describe('resultsDirectory', () => {
  it('defaults to the repository results directory', () => {
    expect(resultsDirectory({}, '/repo/apps/web')).toBe(
      path.resolve('/repo/results'),
    );
    expect(resultsDirectory({MVI_RESULTS_DIR: ''}, '/repo/apps/web')).toBe(
      path.resolve('/repo/results'),
    );
  });

  it('can be pointed at a fixture', () => {
    expect(resultsDirectory({MVI_RESULTS_DIR: '/tmp/fixture'}, '/x')).toBe(
      path.resolve('/tmp/fixture'),
    );
  });
});
