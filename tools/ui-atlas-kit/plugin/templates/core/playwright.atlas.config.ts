// ui-atlas-kit 0.3.0 vendored: do not edit here. Change plugin/templates/core in the kit and run `ui-atlas sync`.
import { defineConfig } from '@playwright/test';

// Component atlas: every Storybook story x theme x viewport, captured and
// checked (a11y, play(), overflow, console errors). Run through `pnpm atlas`,
// which builds Storybook first - the spec enumerates storybook-static/index.json.
// UI_ATLAS_PORT moves the static server (default 6106) when several repos run at once.
const port = Number(process.env.UI_ATLAS_PORT ?? 6106);
// Chromium's partial raster flips a few anti-aliased pixels on rounded/shadowed fixed elements between identical runs.
const LAUNCH = { args: ['--disable-partial-raster'] };

export default defineConfig({
  testDir: './tests/atlas',
  fullyParallel: true,
  workers: 4,
  retries: 0,
  reporter: [['list']],
  use: { baseURL: `http://localhost:${port}`, reducedMotion: 'reduce', launchOptions: LAUNCH, trace: 'off', video: 'off', screenshot: 'off' },
  webServer: {
    // npx --no-install runs the repo's own vite whichever package manager installed it.
    command: `npx --no-install vite preview --outDir storybook-static --port ${port} --strictPort`,
    url: `http://localhost:${port}/index.json`,
    // Attaching to whatever already listens on the port could be another repo's Storybook; opt in with UI_REUSE_SERVER=1.
    reuseExistingServer: Boolean(process.env.UI_REUSE_SERVER),
    timeout: 30_000,
  },
});
