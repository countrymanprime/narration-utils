import { defineConfig } from '@playwright/test';

// Component atlas: every Storybook story x theme x viewport, captured and
// checked (a11y, play(), overflow, console errors). Run through `pnpm atlas`,
// which builds Storybook first - the spec enumerates storybook-static/index.json.
export default defineConfig({
  testDir: './tests/atlas',
  fullyParallel: true,
  workers: 4,
  retries: 0,
  reporter: [['list']],
  use: { baseURL: 'http://localhost:6106', reducedMotion: 'reduce', trace: 'off', video: 'off', screenshot: 'off' },
  webServer: {
    command: 'pnpm exec vite preview --outDir storybook-static --port 6106 --strictPort',
    url: 'http://localhost:6106/index.json',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
