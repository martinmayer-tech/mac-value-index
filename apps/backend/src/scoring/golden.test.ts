// Golden-file test: a small fixed snapshot must produce exactly the
// committed results.json and report.md. Regenerate deliberately with
// UPDATE_GOLDEN=1 pnpm test, and review the diff.

import {mkdir, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';

import {describe, expect, it} from 'vitest';

import {stableJson} from '../io/files.js';
import {renderCsv} from '../report/csv.js';
import {renderReport} from '../report/markdown.js';

import {buildResults} from './build-results.js';
import {CHIPS_FILE, PROFILES, SNAPSHOT} from './test-data.js';

const GOLDEN_DIR = path.join(import.meta.dirname, '..', '..', 'test', 'golden');
const update = process.env['UPDATE_GOLDEN'] === '1';

async function expectGolden(name: string, actual: string): Promise<void> {
  const file = path.join(GOLDEN_DIR, name);
  if (update) {
    await mkdir(GOLDEN_DIR, {recursive: true});
    await writeFile(file, actual, 'utf8');
  }
  expect(actual).toBe(await readFile(file, 'utf8'));
}

describe('golden files', () => {
  const results = buildResults(SNAPSHOT, CHIPS_FILE, PROFILES);

  it('produces the expected results.json', async () => {
    await expectGolden('results.json', stableJson(results));
  });

  it('produces the expected report.md', async () => {
    await expectGolden('report.md', renderReport(results));
  });

  it('produces the expected ranking.csv', async () => {
    await expectGolden('ranking.csv', renderCsv(results));
  });

  it('gives byte-identical output when run twice', () => {
    expect(stableJson(buildResults(SNAPSHOT, CHIPS_FILE, PROFILES))).toBe(
      stableJson(results),
    );
  });
});
