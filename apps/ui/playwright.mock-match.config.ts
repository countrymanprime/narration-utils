import { defineConfig } from '@playwright/test';
import base from './playwright.config';

// The pixel-match tool (tests/visual/mock-match, mock-fidelity-primitives-and-components.prd.md Phase 0, D91 on #509): the
// visual suite's server and browser settings, its own tests and its own setup, which clears the output folder and writes
// the score table at the end. MOCK_MATCH_CHROMIUM points at a Chromium other than Playwright's own (a container whose
// browser is older than the pinned Playwright).
const executablePath = process.env.MOCK_MATCH_CHROMIUM;

export default defineConfig({
  ...base,
  testDir: './tests/visual/mock-match',
  testMatch: '*.spec.ts',
  testIgnore: [],
  globalSetup: './tests/visual/mock-match/global-setup.ts',
  use: { ...base.use, launchOptions: { ...base.use?.launchOptions, ...(executablePath ? { executablePath } : {}) } },
});
