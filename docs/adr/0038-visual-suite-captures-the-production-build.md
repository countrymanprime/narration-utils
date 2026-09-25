# 0038. The visual suite captures the production build, not the dev server

- **Status:** Accepted
- **Date:** 2026-09-19
- **Related:** Amends [ADR-0023](0023-visual-suite-capture-contract-and-storybook.md)

## Context and problem

The visual suite booted `vite --mode mock` (the dev server) and screenshotted it. Two things were wrong with that:

- It is not what ships. Dev mode runs React StrictMode's double effects and serves an unbundled module graph, so a capture could differ from the app users get. The capture code already has to ignore an aborted request that only the dev double-effect produces (`tests/visual/lib/capture.ts`).
- It was slow. Every test opens a fresh browser context, so nothing is cached between tests, and each one re-fetched the whole unbundled module graph from the dev server. Measured on the desktop viewport locally, serving a built bundle took the same 75 tests from 37.5s to 29.8s.

## Decision drivers

- Captures should show what ships; dev mode runs React StrictMode's double effects and serves an unbundled module graph.
- Speed: every test opens a fresh browser context and re-fetched the whole unbundled module graph from the dev server.

## Considered options

1. Build the app in mock mode and serve the build with `vite preview`
2. Keep the status quo: boot the dev server (`vite --mode mock`) and screenshot it

## Decision outcome

**Chosen option: build the app in mock mode and serve the build with `vite preview`**, because the dev server is not what ships and was slower, since each test re-fetched the whole unbundled module graph.

`shared/ui/playwright.config.ts` builds the app in mock mode (`pnpm run build:mock`, which is `vite build --mode mock` into `node_modules/.cache/mock-build`) and serves that build with `vite preview` on port 4173. The port is separate from the dev server's 5173 so a developer's running `dev:mock` is never mistaken for it, and `reuseExistingServer` is off so an old bundle is never captured.

The mock backend is still selected by `VITE_USE_MOCK_API` in `.env.mock`, which Vite bakes in at build time, so the built app behaves like the dev-mode mock app.

### Consequences

- **Good:** Screenshots, and the `docs/images/ui` documentation screenshots synced from them, show the production build.
- **Neutral:** The suite is about 20% faster per test, and a run pays one bundle build (a few seconds) up front.
- **Good:** The build output lives under `node_modules/`, which git and ESLint already ignore, so no ignore-file changes are needed.
- **Bad:** There is no hot reload: `pnpm screenshots` rebuilds the bundle itself on every run, but to iterate on the UI use `pnpm dev:mock` directly.
- **Neutral:** To capture the dev server again, write a new ADR that supersedes this one (see `docs/adr/README.md`).

### Confirmation

Not recorded when this decision was made.

## Pros and cons of the options

### Keep the dev server

- Bad, because it is not what ships: dev mode's double effects and unbundled module graph mean a capture could differ from the app users get.
- Bad, because it was slow: serving a built bundle took the same 75 tests from 37.5s to 29.8s.
