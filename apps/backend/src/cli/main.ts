#!/usr/bin/env node
// Entry point: argument parsing and stage wiring only.

import {existsSync} from 'node:fs';
import path from 'node:path';

import {runCli} from './commands.js';

/** Finds the repository root: the nearest directory with the workspace file. */
function findRoot(start: string): string {
  let directory = start;
  for (;;) {
    if (existsSync(path.join(directory, 'pnpm-workspace.yaml'))) {
      return directory;
    }
    const parent = path.dirname(directory);
    if (parent === directory) {
      return start;
    }
    directory = parent;
  }
}

process.exitCode = await runCli(process.argv.slice(2), {
  root: findRoot(process.cwd()),
  out: line => {
    process.stdout.write(`${line}\n`);
  },
  err: line => {
    process.stderr.write(`${line}\n`);
  },
  env: process.env,
  today: () => new Date().toISOString().slice(0, 10),
});
