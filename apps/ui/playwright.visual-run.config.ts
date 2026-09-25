import { defineConfig } from '@playwright/test';

// The whole-run checks of a sharded visual suite (tests/visual/whole-run.check.ts): CI runs `pnpm run screenshots
// --shard=i/n` in several jobs with UI_VISUAL_SHARDED=1, then this over the merged capture records. Playwright is only the
// TypeScript runner here: no browser, no web server.
export default defineConfig({
  testDir: './tests/visual',
  testMatch: 'whole-run.check.ts',
  workers: 1,
  retries: 0,
  reporter: [['list']],
});
