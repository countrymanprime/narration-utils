import { defineConfig } from '@playwright/test';

// App capture: every {page, state, viewport} in tests/visual/state-catalog.ts. It fails on page errors,
// failed requests, sideways overflow, blank screenshots, and states that render identically - see
// tests/visual/lib/validators.ts and global-setup.ts. It is not a pixel-diff gate.
export default defineConfig({
  testDir: './tests/visual',
  globalSetup: './tests/visual/global-setup.ts',
  fullyParallel: true,
  workers: 4,
  // No retries: a capture that only passes on the second try is a flaky capture.
  retries: 0,
  reporter: [['list']],
  use: { baseURL: '{{BASE_URL}}', trace: 'off', video: 'off', screenshot: 'off' },
  webServer: {
    command: '{{DEV_COMMAND}}',
    url: '{{BASE_URL}}',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
