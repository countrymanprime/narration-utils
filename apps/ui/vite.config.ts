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
    // Coverage runs through scripts/ci/coverage-gate.mjs (the `test` target), which lists the logic files
    // to instrument and compares them with scripts/ci/coverage-floors.json. `vitest --coverage` works by hand too.
    coverage: { provider: 'v8' },
  },
});
