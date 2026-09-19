import { defineConfig } from '@playwright/test';

// Screenshot-capture config for the app's visual test suite
// (shared/ui/tests/visual). Not a pixel-diff regression gate: it fails on
// pages that error, overflow sideways, render blank, or render identically to
// another state - see tests/visual/lib/validators.ts and global-setup.ts.
export default defineConfig({
  testDir: './tests/visual',
  globalSetup: './tests/visual/global-setup.ts',
  fullyParallel: true,
  // The suite hits one shared `dev:mock` server - too much parallelism
  // causes occasional page.goto timeouts under contention.
  workers: 4,
  // No retries: a capture that only passes on the second try is a flaky
  // capture, and a retry would hide exactly that.
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'off',
    video: 'off',
    screenshot: 'off',
  },
  webServer: {
    command: 'pnpm run dev:mock',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
