import { defineConfig } from '@playwright/test';

// Screenshot-capture config for the app's visual test suite
// (apps/ui/tests/visual). Not a pixel-diff regression gate: it fails on
// pages that error, overflow sideways, render blank, or render identically to
// another state - see tests/visual/lib/validators.ts and global-setup.ts.
// Chromium's partial raster flips a few anti-aliased pixels on rounded/shadowed fixed elements between identical runs.
const LAUNCH = { args: ['--disable-partial-raster'] };

// The suite screenshots the production build (mock backend, see .env.mock), served by `vite preview`,
// not the dev server: what ships is what gets captured, and a fresh browser context per test loads a
// handful of bundled files instead of the whole unbundled module graph. A port of its own means a
// developer's running `dev:mock` (5173) is never mistaken for it. UI_APP_PORT moves it (default 4173,
// vite preview's own default) when another project's preview is already listening there.
const PORT = Number(process.env.UI_APP_PORT ?? 4173);
const ORIGIN = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './tests/visual',
  globalSetup: './tests/visual/global-setup.ts',
  fullyParallel: true,
  // One shared static server, and Chromium is CPU-bound: 4 workers matches a CI runner's 4 vCPUs.
  workers: 4,
  // No retries: a capture that only passes on the second try is a flaky
  // capture, and a retry would hide exactly that.
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: ORIGIN,
    launchOptions: LAUNCH,
    // Nothing is kept for a passing test. A failing one leaves test-results/<test>/trace.zip (DOM snapshots,
    // network and console for every action), which CI uploads with the run: `pnpm exec playwright show-trace <zip>`.
    // `retain-on-failure` records every test but keeps the trace only on failure, so it needs no retry (ADR 0023: no retries).
    trace: 'retain-on-failure',
    video: 'off',
    screenshot: 'off',
  },
  webServer: {
    command: `pnpm run build:mock && pnpm exec vite preview --outDir node_modules/.cache/mock-build --port ${PORT} --strictPort`,
    url: ORIGIN,
    // Always build fresh: attaching to an old preview would screenshot an old bundle.
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
