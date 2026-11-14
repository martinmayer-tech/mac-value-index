import {fileURLToPath} from 'node:url';

import {defineConfig} from 'vitest/config';

// vitest requires a default export from its config file.
export default defineConfig({
  resolve: {
    // Tests run against contract sources, so no build step is needed.
    alias: [
      {
        find: /^@mvi\/contracts\/constants$/,
        replacement: fileURLToPath(
          new URL('./packages/contracts/src/constants.ts', import.meta.url),
        ),
      },
      {
        find: /^@mvi\/contracts$/,
        replacement: fileURLToPath(
          new URL('./packages/contracts/src/index.ts', import.meta.url),
        ),
      },
    ],
  },
  test: {
    include: ['{apps,packages}/*/src/**/*.test.{ts,tsx}'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/e2e/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'lcov', 'json-summary'],
      include: ['{apps,packages}/*/src/**/*.{ts,tsx}'],
      exclude: [
        '**/*.test.{ts,tsx}',
        '**/*.d.ts',
        // Astro components, pages and the island are covered by the
        // Playwright end-to-end suite, not by unit tests.
        'apps/web/src/components/**',
        'apps/web/src/pages/**',
        'apps/web/src/layouts/**',
        'apps/web/src/content.config.ts',
        // CLI entry point: argument wiring only, exercised via run-cli tests.
        'apps/backend/src/cli/main.ts',
      ],
      thresholds: {
        lines: 80,
        branches: 80,
        'apps/backend/src/scoring/**': {lines: 95, branches: 95},
        'packages/contracts/src/**': {lines: 95, branches: 95},
      },
    },
  },
});
