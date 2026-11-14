// Guards the architecture: the web app presents results and nothing else.
// The ESLint boundary rule is the main enforcement; this test backs it up.

import {readdir, readFile} from 'node:fs/promises';
import path from 'node:path';

import {describe, expect, it} from 'vitest';

const APP_ROOT = path.join(import.meta.dirname, '..', '..');
const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.astro', '.mjs'];

async function sourceFiles(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, {withFileTypes: true})) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (
        !['node_modules', 'dist', '.astro', 'test', 'test-results'].includes(
          entry.name,
        )
      ) {
        files.push(...(await sourceFiles(full)));
      }
    } else if (
      SOURCE_EXTENSIONS.some(extension => entry.name.endsWith(extension)) &&
      !entry.name.endsWith('.test.ts')
    ) {
      files.push(full);
    }
  }
  return files;
}

const files = await sourceFiles(APP_ROOT);

/** Patterns that would mean scoring logic had leaked into the web app. */
const SCORING_PATTERNS: readonly (readonly [string, RegExp])[] = [
  [
    'imports from apps/backend',
    /from\s+['"][^'"]*(?:apps\/backend|backend\/src|@mvi\/backend)/,
  ],
  ['reads profile weights to calculate', /weights\.[a-zA-Z]+\s*[*/]/],
  ['normalises a metric', /\bnormalis(?:e|ed|ation)\s*\(/],
  [
    'calculates a value score',
    /capabilityScore\s*\/\s*|\/\s*[a-zA-Z.]*priceGbp/,
  ],
  ['calculates memory headroom', /ramGb\s*-\s*|reservations\./],
  [
    'fetches at runtime',
    /\bfetch\s*\(|XMLHttpRequest|sendBeacon|new WebSocket/,
  ],
];

describe('web app boundary', () => {
  it('finds the source files', () => {
    expect(files.length).toBeGreaterThan(15);
  });

  it.each(SCORING_PATTERNS)('never %s', async (_name, pattern) => {
    const offenders: string[] = [];
    for (const file of files) {
      const source = await readFile(file, 'utf8');
      // Display text on the methodology page describes the formulas.
      const code = file.endsWith('methodology.astro')
        ? (source.split('\n---\n')[0] ?? '')
        : source;
      if (pattern.test(code)) {
        offenders.push(path.relative(APP_ROOT, file));
      }
    }
    expect(offenders).toEqual([]);
  });

  it('loads no third-party fonts, scripts or styles', async () => {
    const offenders: string[] = [];
    for (const file of files) {
      const source = await readFile(file, 'utf8');
      if (/<(?:script|link)[^>]+(?:src|href)=["']https?:/.test(source)) {
        offenders.push(path.relative(APP_ROOT, file));
      }
    }
    expect(offenders).toEqual([]);
  });
});
