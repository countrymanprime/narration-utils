import { defineConfig } from '../../../apps/ui/node_modules/@playwright/test';
import { resolve } from 'node:path';
import base from './capture.config';
const local = (relative: string) => resolve(__dirname, relative);
export default defineConfig({
  ...base,
  testDir: local('../../../apps/ui/tests/visual/mock-match'),
  testIgnore: [],
  globalSetup: local('../../../apps/ui/tests/visual/mock-match/global-setup.ts'),
  outputDir: local('./benchmark-test-results'),
  reporter: [['list'], ['json', { outputFile: local('./benchmark-results.json') }]],
});
