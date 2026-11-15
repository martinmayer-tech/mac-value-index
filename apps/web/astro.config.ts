import {readdir, readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import preact from '@astrojs/preact';
import sitemap from '@astrojs/sitemap';
import type {AstroIntegration} from 'astro';
import {defineConfig} from 'astro/config';

/** GitHub Pages project site: https://<owner>.github.io/mac-value-index/ */
export const SITE = 'https://martinmayer-tech.github.io';
export const BASE = '/mac-value-index';

const ISLAND_STYLE = /<style>astro-island[^<]*<\/style>/;

async function htmlFiles(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, {withFileTypes: true})) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await htmlFiles(full)));
    } else if (entry.name.endsWith('.html')) {
      files.push(full);
    }
  }
  return files;
}

/**
 * Astro writes the island's display rule as a <style> element in the body,
 * which is not valid HTML. This moves it into <head> after the build.
 */
const islandStyleInHead: AstroIntegration = {
  name: 'island-style-in-head',
  hooks: {
    'astro:build:done': async ({dir}) => {
      for (const file of await htmlFiles(fileURLToPath(dir))) {
        const html = await readFile(file, 'utf8');
        const style = ISLAND_STYLE.exec(html)?.[0];
        if (style !== undefined) {
          await writeFile(
            file,
            html.replace(style, '').replace('</head>', `${style}</head>`),
          );
        }
      }
    },
  },
};

// Astro requires a default export from its config file.
export default defineConfig({
  site: SITE,
  base: BASE,
  trailingSlash: 'always',
  output: 'static',
  build: {format: 'directory'},
  integrations: [preact(), sitemap(), islandStyleInHead],
});
