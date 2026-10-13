import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  // Extensions need Playwright's bundled Chromium channel (not Google Chrome).
  projects: [
    {
      name: 'chromium-extension',
      testIgnore: ['**/hq-manual.spec.mjs'],
      use: { channel: 'chromium' }
    },
    {
      name: 'hq-manual',
      testMatch: ['**/hq-manual.spec.mjs'],
      timeout: 5 * 60_000,
      use: { channel: 'chromium' }
    }
  ]
});
