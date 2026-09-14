import { defineConfig } from '@playwright/test';

// Screenshot-capture config for the wireframe-vs-app visual parity suite
// (shared/ui/tests/visual). Not a pixel-diff regression gate - see
// tests/visual/state-catalog.ts and docs/testing/visual-deviations.md for the full picture.
export default defineConfig({
  testDir: './tests/visual',
  fullyParallel: true,
  // The app suite hits one shared `dev:mock` server - too much parallelism
  // causes occasional page.goto timeouts under contention (the wireframe
  // suite has no such server and isn't affected).
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
