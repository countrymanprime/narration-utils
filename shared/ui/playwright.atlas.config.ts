// ui-atlas-kit 0.1.0 vendored: do not edit here. Change plugin/templates/core in the kit and run `ui-atlas sync`.
import { defineConfig } from '@playwright/test';

// Component atlas: every Storybook story x theme x viewport, captured and
// checked (a11y, play(), overflow, console errors). Run through `pnpm atlas`,
// which builds Storybook first - the spec enumerates storybook-static/index.json.
// UI_ATLAS_PORT moves the static server (default 6106) when several repos run at once.
const port = Number(process.env.UI_ATLAS_PORT ?? 6106);

export default defineConfig({
  testDir: './tests/atlas',
  fullyParallel: true,
  workers: 4,
  retries: 0,
  reporter: [['list']],
  use: { baseURL: `http://localhost:${port}`, reducedMotion: 'reduce', trace: 'off', video: 'off', screenshot: 'off' },
  webServer: {
    // npx --no-install runs the repo's own vite whichever package manager installed it.
    command: `npx --no-install vite preview --outDir storybook-static --port ${port} --strictPort`,
    url: `http://localhost:${port}/index.json`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
