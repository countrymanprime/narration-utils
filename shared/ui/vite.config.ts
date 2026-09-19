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
    exclude: ['node_modules/**', 'tests/visual/**'],
  },
});
