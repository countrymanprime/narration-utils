# 0038. The visual suite captures the production build, not the dev server

**Status:** Accepted (amends ADR-0023)
**Date:** 2026-09-19
**Supersedes:**

## Context

The visual suite booted `vite --mode mock` (the dev server) and screenshotted it. Two things were wrong with that:

- It is not what ships. Dev mode runs React StrictMode's double effects and serves an unbundled module graph, so a capture could differ from the app users get. The capture code already has to ignore an aborted request that only the dev double-effect produces (`tests/visual/lib/capture.ts`).
- It was slow. Every test opens a fresh browser context, so nothing is cached between tests, and each one re-fetched the whole unbundled module graph from the dev server. Measured on the desktop viewport locally, serving a built bundle took the same 75 tests from 37.5s to 29.8s.

## Decision

`shared/ui/playwright.config.ts` builds the app in mock mode (`pnpm run build:mock`, which is `vite build --mode mock` into `node_modules/.cache/mock-build`) and serves that build with `vite preview` on port 4173. The port is separate from the dev server's 5173 so a developer's running `dev:mock` is never mistaken for it, and `reuseExistingServer` is off so an old bundle is never captured.

The mock backend is still selected by `VITE_USE_MOCK_API` in `.env.mock`, which Vite bakes in at build time, so the built app behaves like the dev-mode mock app.

## Consequences

- Screenshots, and the `docs/images/ui` documentation screenshots synced from them, show the production build.
- The suite is about 20% faster per test, and a run pays one bundle build (a few seconds) up front.
- The build output lives under `node_modules/`, which git and ESLint already ignore, so no ignore-file changes are needed.
- There is no hot reload: `pnpm screenshots` rebuilds the bundle itself on every run, but to iterate on the UI use `pnpm dev:mock` directly.
- To capture the dev server again, write a new ADR that supersedes this one (see `docs/adr/README.md`).
