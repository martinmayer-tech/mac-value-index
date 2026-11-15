import {defineConfig, devices} from '@playwright/test';

const PORT = 4399;
export const BASE_PATH = '/mac-value-index/';

// Playwright requires a default export from its config file.
//
// The suite runs against the built site, served under the GitHub Pages
// base path. Build first, against the fixture:
//   MVI_RESULTS_DIR=test/fixtures/site/results pnpm build
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: process.env['CI'] !== undefined,
  retries: process.env['CI'] === undefined ? 0 : 1,
  reporter:
    process.env['CI'] === undefined
      ? 'list'
      : [['list'], ['html', {open: 'never'}]],
  use: {
    baseURL: `http://localhost:${PORT}${BASE_PATH}`,
    trace: 'off',
  },
  projects: [
    {
      name: 'desktop',
      use: {...devices['Desktop Chrome']},
      grepInvert: /@phone/,
    },
    {
      name: 'phone',
      use: {...devices['Pixel 7']},
      grep: /@phone/,
    },
  ],
  webServer: {
    command: `pnpm exec astro preview --ignore-lock --port ${PORT}`,
    url: `http://localhost:${PORT}${BASE_PATH}`,
    reuseExistingServer: process.env['CI'] === undefined,
    timeout: 60_000,
  },
});
