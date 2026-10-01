import { defineConfig } from '../../../apps/ui/node_modules/@playwright/test';
import { resolve } from 'node:path';
import base from '../../../apps/ui/playwright.config';

const local = (relative: string) => resolve(__dirname, relative);

// Original visual tests, drivers, validators, and viewport matrix. Only process
// launch and output location change; freshly build before running this config.
export default defineConfig({
  ...base,
  testDir: local('../../../apps/ui/tests/visual'),
  globalSetup: local('../../../apps/ui/tests/visual/global-setup.ts'),
  outputDir: local('./test-results'),
  reporter: [['list'], ['json', { outputFile: local('./test-results.json') }]],
  webServer: {
    command: 'node node_modules/vite/bin/vite.js preview --outDir node_modules/.cache/mock-build --port 4173 --strictPort',
    cwd: local('../../../apps/ui'),
    url: 'http://localhost:4173',
    reuseExistingServer: false,
  },
});
