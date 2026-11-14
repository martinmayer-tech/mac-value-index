// Internal link check for the built site.
//
// Fails when an internal link or asset does not resolve to a file in dist,
// or when a root-relative link does not start with the base path (which
// would break on GitHub Pages).
//
// Usage: node scripts/check-links.mjs <dist directory> [base path]

import {existsSync, readdirSync, readFileSync, statSync} from 'node:fs';
import path from 'node:path';

const dist = path.resolve(process.argv[2] ?? 'dist');
const base = process.argv[3] ?? '/mac-value-index/';

function htmlFiles(directory) {
  return readdirSync(directory).flatMap(name => {
    const full = path.join(directory, name);
    if (statSync(full).isDirectory()) {
      return htmlFiles(full);
    }
    return name.endsWith('.html') ? [full] : [];
  });
}

function resolves(urlPath) {
  const relative = decodeURIComponent(urlPath.slice(base.length));
  const target = path.join(dist, relative);
  if (urlPath.endsWith('/')) {
    return existsSync(path.join(target, 'index.html'));
  }
  return existsSync(target) && statSync(target).isFile();
}

const problems = [];
let checked = 0;
for (const file of htmlFiles(dist)) {
  const html = readFileSync(file, 'utf8');
  const page = path.relative(dist, file);
  const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]));
  for (const match of html.matchAll(/\s(?:href|src)="([^"]*)"/g)) {
    const url = match[1].replaceAll('&amp;', '&');
    if (/^(?:https?:|mailto:|data:)/.test(url)) {
      continue;
    }
    checked++;
    if (url.startsWith('#')) {
      if (url.length > 1 && !ids.has(url.slice(1))) {
        problems.push(`${page}: anchor ${url} has no matching id`);
      }
      continue;
    }
    if (!url.startsWith('/')) {
      problems.push(`${page}: relative link "${url}"; use the base path`);
      continue;
    }
    if (!url.startsWith(base)) {
      problems.push(`${page}: root-relative link "${url}" is outside ${base}`);
      continue;
    }
    const [urlPath] = url.split(/[?#]/);
    if (!resolves(urlPath)) {
      problems.push(`${page}: broken link "${url}"`);
    } else if (!urlPath.endsWith('/') && path.extname(urlPath) === '') {
      problems.push(`${page}: "${url}" is missing its trailing slash`);
    }
  }
}

if (problems.length > 0) {
  console.error(problems.join('\n'));
  console.error(`\n${problems.length} link problems.`);
  process.exit(1);
}
console.log(`Checked ${checked} internal links: all resolve under ${base}.`);
