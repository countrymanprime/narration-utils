import { defineConfig } from '@playwright/test';

// Aria-snapshot config: the role trees of the dialogs, the slide-over and the navigation (tests/aria, ADR 0065). Kept apart
// from the visual suite (playwright.config.ts) because that suite is one screenshot per catalog state at three fixed
// viewports and a snapshot is neither; this one reuses its drivers and the same production mock build, and may open the
// drawer at its own 390 px size. Run by the `ui-visual` job after the visual suite (`pnpm --dir apps/ui run aria`).
//
// A snapshot is partial by default (what it lists must be there, in order; extra nodes are fine), and the navigation list is
// pinned with `children: equal`. Update them with `pnpm --dir apps/ui run aria --update-snapshots`, then trim the result
// back to what matters and read the diff: a changed tree is a changed screen-reader experience.
const PORT = Number(process.env.UI_ARIA_PORT ?? 4174);
const ORIGIN = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './tests/aria',
  // Inside the visual suite's test-results/, which Playwright empties at the start of each run: a folder of its own keeps the
  // visual traces when this runs second, and the CI upload of test-results/ still finds both.
  outputDir: './test-results/aria',
  fullyParallel: true,
  workers: 2,
  // No retries: red must mean real (ADR 0023).
  retries: 0,
  reporter: [['list']],
  // On CI a snapshot is only ever compared: a missing or renamed file fails instead of being written from the current tree.
  updateSnapshots: process.env.CI ? 'none' : 'missing',
  expect: { toMatchAriaSnapshot: { pathTemplate: '{testDir}/snapshots/{arg}{ext}' } },
  use: {
    baseURL: ORIGIN,
    // A failing test leaves test-results/<test>/trace.zip, which the `ui-visual` job uploads with the visual suite's.
    trace: 'retain-on-failure',
    video: 'off',
    screenshot: 'off',
  },
  webServer: {
    // Its own port (the visual suite uses 4173) and its own build folder, so the two never mistake each other's server or
    // wipe each other's bundle, and a fresh build like the visual suite (ADR 0038).
    command: `pnpm exec vite build --mode mock --outDir node_modules/.cache/aria-build && pnpm exec vite preview --outDir node_modules/.cache/aria-build --port ${PORT} --strictPort`,
    url: ORIGIN,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
