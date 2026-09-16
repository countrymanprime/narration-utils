import { defineConfig } from '@playwright/test';

// Screenshot-capture config for the app's visual test suite
// (shared/ui/tests/visual). Not a pixel-diff regression gate - see
// tests/visual/state-catalog.ts for the full picture.
export default defineConfig({
  testDir: './tests/visual',
  fullyParallel: true,
  // The suite hits one shared `dev:mock` server - too much parallelism
  // causes occasional page.goto timeouts under contention.
  workers: 4,
  retries: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'off',
    video: 'off',
    screenshot: 'off',
  },
  webServer: {
    command: 'npm run dev:mock',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
