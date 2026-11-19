import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const directory = path.dirname(fileURLToPath(import.meta.url));
const resultsDirectory = process.env.FALKENWARTE_QA_RESULTS_DIR ?? path.join(directory, 'results');

export default defineConfig({
  testDir: path.join(directory, process.env.FALKENWARTE_PRODUCTION_SMOKE === '1'
    ? 'production'
    : process.env.FALKENWARTE_PLUGIN_IMAGE_UPGRADE === '1' ? 'plugin-upgrade' : 'tests'),
  outputDir: path.join(resultsDirectory, 'artifacts'),
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45_000,
  expect: { timeout: 7_000 },
  reporter: [
    ['list'],
    [path.resolve(directory, '../../qa/playwright-reporter.mjs')],
    ['html', { outputFolder: path.join(resultsDirectory, 'html'), open: 'never' }],
  ],
  use: {
    baseURL: process.env.FALKENWARTE_BASE_URL ?? 'http://127.0.0.1:8080',
    browserName: 'chromium',
    headless: true,
    viewport: { width: 1440, height: 960 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    serviceWorkers: 'block',
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
  },
  globalSetup: path.join(directory, 'support/global-setup.mjs'),
});
