import { defineConfig } from '@playwright/test';
import base from './playwright.config';
// Local only (not committed): this container's Chromium is the full browser, which asks for /favicon.ico; serve one.
export default defineConfig({
  ...base,
  webServer: {
    ...base.webServer,
    command: `pnpm run build:mock && printf '' > node_modules/.cache/mock-build/favicon.ico && pnpm exec vite preview --outDir node_modules/.cache/mock-build --port 4173 --strictPort`,
    timeout: 240_000,
  },
});
