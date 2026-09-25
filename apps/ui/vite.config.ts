import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// The `demo` mode (`.env.demo`, `pnpm build:demo`) publishes the mock build under GitHub Pages'
// `/narration-utils/demo/` subpath (see docs/prds/public-app-demo.prd.md D3); every other mode
// (dev, `mock`, `test`, production) keeps the app at the site root.
export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss()],
  base: mode === 'demo' ? '/narration-utils/demo/' : '/',
  build: { outDir: 'dist', emptyOutDir: true },
  test: {
    // tests/visual/**/*.spec.ts and tests/aria/**/*.spec.ts are Playwright specs (run via `pnpm run
    // screenshots` and `pnpm run aria`), not Vitest tests - Vitest's default include pattern
    // matches *.spec.ts too, so they must be excluded explicitly. scripts/*.test.mjs are node:test suites (the
    // `test-node` target).
    exclude: ['node_modules/**', 'tests/visual/**', 'tests/aria/**', 'tests/atlas/**', 'scripts/**'],
    setupFiles: ['./src/test-setup.ts'],
    // Vitest's 5 s default is a unit-test value. App.test.tsx mounts the whole app (Story Bible included) in jsdom: about a
    // second on a developer machine, three to five times that on a busy CI runner. 15 s still fails a genuine hang, and
    // `slowTestThreshold` is left at its default so a test that gets slow stays visible in the report. One uniform value
    // beats per-test overrides, which would hide the next test that gets slow.
    testTimeout: 15_000,
    // Coverage runs through scripts/ci/coverage-gate.mjs (the `test` target), which lists the logic files
    // to instrument and compares them with scripts/ci/coverage-floors.json. `vitest --coverage` works by hand too.
    coverage: { provider: 'v8' },
  },
}));
