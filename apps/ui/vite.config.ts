import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: '/',
  build: { outDir: 'dist', emptyOutDir: true },
  test: {
    // tests/visual/**/*.spec.ts are Playwright specs (run via `pnpm run
    // screenshots`), not Vitest tests - Vitest's default include pattern
    // matches *.spec.ts too, so it must be excluded explicitly.
    exclude: ['node_modules/**', 'tests/visual/**', 'tests/atlas/**'],
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
});
