import { defineConfig } from '@playwright/test';

// App capture: every {page, state, viewport} in tests/visual/state-catalog.ts. It fails on page errors,
// failed requests, sideways overflow, blank screenshots, and states that render identically - see
// tests/visual/lib/validators.ts and global-setup.ts. It is not a pixel-diff gate.
// UI_APP_PORT moves the dev server (default 5173) when several repos run at once.
const port = Number(process.env.UI_APP_PORT ?? 5173);
// Chromium's partial raster flips a few anti-aliased pixels on rounded/shadowed fixed elements between identical runs.
const LAUNCH = { args: ['--disable-partial-raster'] };

export default defineConfig({
  testDir: './tests/visual',
  globalSetup: './tests/visual/global-setup.ts',
  fullyParallel: true,
  workers: 4,
  // No retries: a capture that only passes on the second try is a flaky capture.
  retries: 0,
  reporter: [['list']],
  use: { baseURL: `http://localhost:${port}`, launchOptions: LAUNCH, trace: 'off', video: 'off', screenshot: 'off' },
  webServer: {
    // TODO(ui-atlas-init): add `--mode <name>` etc. if the app needs a special dev mode (a mock API).
    command: `npx --no-install vite --port ${port} --strictPort`,
    url: `http://localhost:${port}`,
    // Attaching to whatever already listens on the port could be a different app (your own dev server); opt in with UI_REUSE_SERVER=1.
    reuseExistingServer: Boolean(process.env.UI_REUSE_SERVER),
    timeout: 30_000,
  },
});
