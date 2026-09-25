# 0096. The public demo builds under its own Vite mode, and the router carries a basename

- **Status:** Accepted
- **Date:** 2026-09-22

## Context and problem

`docs/prds/public-app-demo.prd.md` Phase 1 publishes the existing `build:mock` bundle to
`https://countrymanprime.github.io/narration-utils/demo/`, alongside the docs site and Storybook
that `pages.yml` already builds (`release-readiness-provisioning-and-docs-site.prd.md` Phases 9-13).
`apps/ui/vite.config.ts` hardcoded `base: '/'`, which only the site root (and the desktop app, which
also serves from `/`) needs; the demo needs its own subpath. The PRD's own Open Question D3 ("base
path mechanism") named two options without picking one: a Vite CLI `--base` flag per build
invocation, or a `demo` mode alongside the existing `mock` mode. A CLI flag on top of the existing
`mock` mode would also make the demo banner (a Phase 1 Must: "every page of the demo shows it is a
demo") show up in the Playwright visual suite, Storybook and the component atlas, all of which build
with `--mode mock` today and must not change.

Verifying the built demo locally (a static file server under `/narration-utils/demo/`, per the PRD's
own "verify locally the same way the Storybook step was proven") surfaced a second, unrelated defect
the PRD did not anticipate: `apps/ui/src/App.tsx`'s `<BrowserRouter>` carried no `basename`, so every
route (`/`, `/proofing`, `/story-bible`, ...) failed to match under the `/narration-utils/demo/`
prefix. The console read `No routes matched location "/narration-utils/demo/"` and every page
rendered only the app shell (banner, nav, header) with no page content - the demo's whole "navigate
the real UI" success state.

## Decision drivers

- The demo needs its own subpath (`/narration-utils/demo/`); only the site root and the desktop app serve from `/`.
- Every page of the demo must show it is a demo (a Phase 1 Must).
- The Playwright visual suite, Storybook and the component atlas build with `--mode mock` and must not change.
- Without a router `basename`, every route failed to match under the `/narration-utils/demo/` prefix.

## Considered options

1. A `demo` Vite mode that sets the base, with the router's `basename` taken from Vite's `BASE_URL`
2. A Vite CLI `--base` flag per build invocation, on top of the existing `mock` mode

## Decision outcome

**Chosen option: a `demo` Vite mode that sets the base, with the router's `basename` taken from Vite's `BASE_URL`**, because a CLI flag on top of the existing `mock` mode would also make the demo banner show up in the Playwright visual suite, Storybook and the component atlas, which must not change.

- `apps/ui/vite.config.ts` is a mode-keyed function (`defineConfig(({ mode }) => ({...}))`) rather
  than a static object. A new `demo` mode (`apps/ui/.env.demo`: `VITE_USE_MOCK_API=1`, `VITE_DEMO=1`)
  sets `base: '/narration-utils/demo/'`; every other mode (dev, `mock`, `test`, production) keeps
  `base: '/'`. `apps/ui/package.json` gets `build:demo` (`vite build --mode demo --outDir dist/demo`)
  alongside the existing `build:mock`.
- `apps/ui/src/components/layout/DemoBanner.tsx` self-gates on `import.meta.env.VITE_DEMO === '1'`,
  not `MODE === 'mock'`, so it renders only from the `demo` build and never from the `mock` build the
  visual suite, Storybook and the atlas already rely on for pixel-stable captures.
- `apps/ui/src/App.tsx`'s `<BrowserRouter>` takes `basename={import.meta.env.BASE_URL}` - Vite's own
  env var for the configured `base`, so it is `/` (a no-op) everywhere except the demo build, where it
  matches the `base` the assets themselves resolve under.

### Consequences

- **Good:** Any future build that needs a third base path (or the demo's own path ever changes) is one `mode ===
  '<name>'` branch in `vite.config.ts`, not a CLI invocation to keep in sync across `package.json`,
  `pages.yml` and local verification instructions.
- **Bad:** `import.meta.env.BASE_URL` must stay the single source of truth for the router's `basename`; a future
  change to how `base` is computed (for example, reading it from a URL param instead of a build mode)
  must keep this wired together, or routing breaks silently under a subpath the way it did before this
  fix - there is no automated check that the two stay in sync beyond the demo build itself resolving
  routes.
- **Neutral:** This ADR's language (build mode, banner gating, router basename) describes the shape of Phase 1 as
  delivered; when `public-app-demo.prd.md` reaches steady state and is deleted, the durable rule
  ("the demo mode's base and the router's basename come from the same Vite env var") belongs in
  whatever steady-state doc describes the docs site's build (`docs/operations/ci-and-releases.md` or
  a new `docs/architecture/` page), not only here.

### Confirmation

No automated check keeps the router's `basename` and Vite's `base` in sync beyond the demo build itself resolving routes; the built demo was verified locally with a static file server under `/narration-utils/demo/`.

## Pros and cons of the options

### A `demo` Vite mode

- Good, because a third base path is one `mode === '<name>'` branch in `vite.config.ts`.

### A Vite CLI `--base` flag on the `mock` mode

- Bad, because it would make the demo banner show up in the Playwright visual suite, Storybook and the component atlas.
- Bad, because it is a CLI invocation to keep in sync across `package.json`, `pages.yml` and local verification instructions.
