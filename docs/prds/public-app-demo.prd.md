# Public App Demo on GitHub Pages

**Source:** conversation of 2026-09-22, following up on the GitHub Pages deploy failure fix (Pages was disabled; the owner enabled it under Settings > Pages > Source "GitHub Actions"). Citations are `file:line` on branch `claude/github-pages-deploy-failure-b2214b` at 2bc1195b. Nothing here is built yet. Related to, but a new phase beyond, [release-readiness-provisioning-and-docs-site.prd.md](release-readiness-provisioning-and-docs-site.prd.md) (Phases 9-13, all delivered: docs site and Storybook atlas on `pages.yml`).

## Problem Statement

`https://countrymanprime.github.io/narration-utils/` publishes the docs site and a Storybook component atlas, but nothing lets a visitor see the actual application flow (Home, Story Bible, Proofing, Teleprompter, Tracks) working end to end. Storybook shows isolated primitives, not the product.

## Evidence

- **A full mock backend already exists and is already used for exactly this purpose in CI.** `apps/ui/src/api/mockApi.ts` (1,117 lines) implements the entire `NarrationApi` contract with literal fixture data "so visual review never silently exercises placeholder content instead of the screen we are trying to match" (`mockApi.ts:1-3`). It backs the Vitest suite, the Playwright visual suite, and Storybook.
- **A browser-only build mode already exists.** `apps/ui/src/main.tsx:83`: `import.meta.env.VITE_USE_MOCK_API === '1' ? createMockApi(...) : wailsClient`. `apps/ui/.env.mock` sets `VITE_USE_MOCK_API=1`. `package.json` scripts `dev:mock` (`vite --mode mock`) and `build:mock` (`vite build --mode mock --outDir node_modules/.cache/mock-build`) already build this bundle; today its output is only used locally/in CI, never published.
- **The mock's default project is already a fully-seeded demo, not an empty state.** `mockApi.ts:49-50`: `DEFAULT_PROJECT_FOLDER = 'C:/Projects/Alice-in-Wonderland'`, `DEFAULT_PROJECT_NAME = "Alice's Adventures in Wonderland"`, populated via `loadAliceManuscript(aliceChapterSeeds)` (`:281`) with entities, chapters, transcript and reader state. A cold `build:mock` load with no URL params boots straight into this project.
- **~15 URL params already drive specific states for review**, e.g. `?mockNoProject=1`, `?mockTeleprompter=listening|waiting|done`, `?mockAssets=missing|downloading|...`, `?mockUpdate=available|...`, `?mockInvalidPayload=bootstrap|manuscript|storybible` (`main.tsx:26-82`). These were built for Playwright/manual review, not for public use, but the plumbing is already there.
- **Native-only host calls are already faked, not left dangling.** `selectManuscript`/`selectProjectFolder` in `wailsClient.ts:133,221` call real Wails bindings (`ManuscriptSelectFile`, `ProjectSelectFolder`), which do not exist in a browser. The mock never calls `wailsClient`: `mockApi.ts:557` (`selectManuscript: async () => startImport()`) and `:1008` (`selectProjectFolder: async () => ({ selected: true, path: 'C:/Projects/Mock-Project' })`) fake both with canned results already. A pass is still needed to confirm no component reaches into `window.go`/Wails runtime directly instead of through the `NarrationApi` port (unverified by reading alone).
- **State is in-memory only, so a reload is a clean session for free.** No `localStorage`/`IndexedDB` persistence was found in `mockApi.ts`; each page load starts from the same seed. A narrower, page-scoped reset already exists as a mock-only affordance (`Transcript.tsx:418-422`, gated on `import.meta.env.MODE === 'mock'`, resets only the Proofing transcript comparison) — this is not a whole-app reset and should not be described as one.
- **`pages.yml` already builds and deploys a static site from this exact toolchain** (build job: read-only token, no secrets; deploy job alone holds `pages: write`/`id-token: write`, main-only, `github-pages` environment) with a link/asset check (`tools/docs-site/check_site.py --require storybook/index.html --require index.html`, `pages.yml:1-8`). `check_site.py:123` takes `--require` as a repeatable flag, so a new required path is a one-line addition.
- **Vite's base path is hardcoded**, not parameterized: `apps/ui/vite.config.ts:7`, `base: '/'`. Storybook and the demo would each need their own base (`/narration-utils/storybook/`, `/narration-utils/demo/`), set via the Vite CLI `--base` flag or a mode-specific config, not the current single hardcoded value.
- **The release-readiness PRD explicitly scoped this out once already**, for a different reason (third-party hosting/secrets): "Moving the Storybook or docs to a third-party host with secrets in this PRD" is listed as not-building (`release-readiness-provisioning-and-docs-site.prd.md:76`). A demo on the same `pages.yml` job, same GitHub Pages host, no secrets, is not that — it does not reopen that decision.

## Proposed Solution

Publish the existing `build:mock` bundle to `https://countrymanprime.github.io/narration-utils/demo/`, as a third artifact alongside the docs site and Storybook in the same `pages.yml` job, with:

1. A parameterized base path so the demo (and Storybook) resolve their own assets under a subpath.
2. A curated default landing state (the existing Alice seed, reviewed for anything that reads as a real narrator's private project).
3. A visible "demo — nothing you do here is saved" banner, since a stranger with no context must not mistake this for a real account.
4. A short audit for any UI path that assumes a native host and is not already covered by the mock (file-system reveal, native updater, OS-level dialogs) — hide or replace what's found, per the pattern already used at `Transcript.tsx:418`.
5. A links/landing page listing a few curated `?mock...=` states (teleprompter mid-session, asset-download-in-progress, error/degraded states) so a visitor can see more than the default happy path, reusing params that already exist rather than inventing new ones.

## Key Hypothesis

We believe a public, no-signup demo of the real UI (not just isolated components) will let people evaluate the product without installing the desktop app, at near-zero build cost because the mock and build mode already exist. We'll know we're right when the demo deploys from `pages.yml` with no new secrets or hosts, a cold visitor lands in a populated project with working navigation across Home/Story Bible/Proofing/Teleprompter/Tracks, and no action in the demo silently fails against a Wails call that doesn't exist in a browser.

## What We're NOT Building

- A backend, database, or any server-side component — the demo is 100% static, mock-data-only, same as today's mock build.
- Real user accounts, saved projects, or any persistence across reloads.
- New `?mock...=` states beyond what already exists for Playwright/manual review, except where Phase 3 finds a real gap.
- Moving Storybook or the docs off GitHub Pages, or introducing any third-party host or secret (unchanged from `release-readiness-provisioning-and-docs-site.prd.md:76`).
- A general-purpose "sandbox" where visitors can import their own files — the demo is a fixed guided tour of the Alice seed data, not a tool.
- Rewriting or expanding `mockApi.ts`'s fixture data beyond what curating the default landing state requires.

## Success Metrics

| Metric | Target | How Measured |
| --- | --- | --- |
| Demo builds and deploys | `pages.yml` build job produces `demo/index.html` under the right base; deploy succeeds on push to `main` | CI run green; `check_site.py --require demo/index.html` |
| No broken native call | Every host-only affordance in the demo either works via the mock or is hidden | Manual click-through of Home, Story Bible, Proofing, Teleprompter, Tracks in the deployed demo; no console error, no dead button |
| Assets resolve | No 404s for JS/CSS/fonts under `/narration-utils/demo/` | `check_site.py` link check plus a live load with `read_network_requests` |
| Clear demo framing | Every page of the demo shows it is a demo | Manual review of each top-level page |
| No regression to existing Pages content | Docs site and Storybook still build and deploy unchanged | Existing `check_site.py --require storybook/index.html --require index.html` still passes |

## Open Questions

- [ ] **D1. Fixed tour vs. free exploration.** Ship one curated default state, or also surface the `?mock...=` params as clickable links from a small demo landing page? Recommendation: both — default state for the cold link, a landing page with 4-6 curated links for people who want to see edge states, since the params already exist at no extra cost.
- [ ] **D2. Which `?mock...=` states to surface publicly.** Not every internal state (e.g. `?mockInvalidPayload=...`, built to see an error screen) is worth putting in front of a stranger. Needs a short curated list.
- [x] **D3. Base path mechanism.** Resolved by [ADR 0096](../adr/0096-the-public-demo-builds-under-its-own-vite-mode-and-the-router-carries-a-basename.md): a `demo` Vite mode (`apps/ui/.env.demo`), not a CLI flag, so `VITE_DEMO` can gate the banner without leaking into the `mock` build the visual suite, Storybook and the atlas already rely on. `import.meta.env.BASE_URL` also had to be wired into `<BrowserRouter basename>` — the router, not just assets, assumed `base: '/'`.
- [ ] **D4. Banner placement and wording.** A persistent top bar (risks colliding with existing page chrome) vs. a dismissible one-time overlay on first load. Needs a look at `apps/ui/src/components/layout/` for what already exists to reuse.
- [x] **D5. Does anything in the Alice seed read as sensitive or too "real"?** No — `aliceManuscript.ts` fetches the public-domain Project Gutenberg/GITenberg text at runtime and carries no private notes, real names, or internal-only content; no trimming needed.
- [ ] **D6. Should the demo be linked from the docs site nav / README**, and where? Affects Phase 2 scope only (a link, not new infrastructure).

## Users & Context

**Primary User**: someone evaluating the product before installing the desktop app — a prospective narrator, collaborator, or reviewer of this repository — with no project of their own and no desire to install anything.
**Current behavior**: the only public artifacts are the docs site (prose) and Storybook (isolated components); there is no way to see the actual application flow without cloning the repo and running `pnpm dev:mock` locally.
**Trigger**: landing on the repository or the published Pages site and wanting to see the product, not just read about it.
**Success state**: the visitor clicks a link, lands in a populated project, and can navigate the real UI (Home, Story Bible, Proofing, Teleprompter, Tracks) with realistic data, understanding nothing they do is saved.
**Job to Be Done**: When I'm deciding whether this tool is worth installing, I want to try the real interface with realistic data, so I can judge it without a local setup.
**Non-Users**: existing users of the desktop app (they already have the real thing); anyone wanting to import their own files (explicitly out of scope).

## Solution Detail

| Priority | Capability | Step |
| --- | --- | --- |
| Must | `build:mock` output published under `/narration-utils/demo/` from `pages.yml`, base path resolves assets correctly | 1 |
| Must | `check_site.py` requires `demo/index.html`; existing docs/Storybook requirements unchanged | 1 |
| Must | Demo banner on every page stating it's a demo and nothing is saved | 1 |
| Must | Native-only affordance audit: every button in the demo either does something via the mock or is hidden/disabled with a reason | 1 |
| Should | Curated demo landing page linking a handful of `?mock...=` states (D1, D2) | 2 |
| Should | README and docs-site link to the demo | 2 |
| Could | Alice seed reviewed and, if needed, trimmed for anything that reads as too "real" for a public audience (D5) | 1 |
| Won't | Backend, persistence, accounts, free-form import (see What We're NOT Building) | - |

**User flow**: visitor opens `countrymanprime.github.io/narration-utils/demo/`, sees a banner ("Demo — sample project, nothing is saved") and the Alice project already loaded on Home; navigates to Story Bible, Proofing, Teleprompter and Tracks via the normal app nav, all backed by fixture data; optionally follows a link from a small "try these" list to see the teleprompter mid-session or an asset-download state.

## Technical Approach

**Feasibility**: HIGH. No new runtime, no new dependency, no backend. The mock API, the build mode, and the seed data all exist today; the work is packaging (base path, CI step) plus a content/UX pass (banner, native-affordance audit, landing page).

**Architecture notes**
- Build: add a `demo` build invocation to `pages.yml`'s existing `build` job, after the current Storybook and docs-site steps. As built (D3 resolved: a mode-specific `vite.config.ts` block, not a CLI flag - [ADR 0096](../adr/0096-the-public-demo-builds-under-its-own-vite-mode-and-the-router-carries-a-basename.md)): `pnpm --dir apps/ui run build:demo` (`vite build --mode demo --outDir dist/demo`, base `/narration-utils/demo/` from `apps/ui/vite.config.ts`), then `cp -r apps/ui/dist/demo tools/docs-site/build/site/demo` (mirrors the existing `cp -r apps/ui/storybook-static tools/docs-site/build/site/storybook` at `pages.yml`'s "Add Storybook beside the docs" step).
- `check_site.py` call gains `--require demo/index.html` (`pages.yml`, same line that already lists `--require storybook/index.html --require index.html`).
- Banner: a small component gated the same way as the existing mock-only reset button (`import.meta.env.MODE === 'mock'`, `Transcript.tsx:418`), but at the app-shell level so it shows on every page, not per-feature.
- Native-affordance audit: grep every `window.go`/Wails-runtime reference outside `wailsClient.ts` (none expected, since the `NarrationApi` port abstracts this, but must be confirmed, not assumed) plus every host-only OS affordance (native "reveal in explorer", native update installer) for a mock-mode fallback or hide.
- Landing/curated-states page: a small new route or a static list on the existing Home page in mock mode, linking to a handful of the params already defined in `main.tsx:26-82`.

**Technical Risks**

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| Hardcoded `base: '/'` breaks demo or Storybook asset paths when both share one Pages deployment | Medium | Resolve D3 first; verify both builds with a served-locally check before wiring into CI, same pattern the existing Storybook step already proves (`pages.yml` build job description) |
| A UI path exists that calls a native affordance the mock doesn't fake | Medium | Explicit audit phase (Phase 1) before publishing, not discovered after |
| Alice seed data reads as a real person's private manuscript to a public audience | Low | D5 read-through before Phase 1 ships |
| Demo build inflates `pages.yml` build time or artifact size meaningfully | Low | Build job already has a 20-minute timeout and builds Storybook + docs; measure after adding the demo step |
| Visitors mistake the demo for a real, persisted product | Medium | Banner is a Phase 1 Must, not deferred to Phase 2 |

## Implementation Phases

| # | Phase | Description | Status | Parallel | Depends | PRP Plan |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Publish the demo | Base-path fix, `pages.yml` build+deploy step, `check_site.py` requirement, demo banner, native-affordance audit, Alice seed read-through | complete | - | D3, D5 | - |
| 2 | Curated states and links | Demo landing/links page for select `?mock...=` states, README and docs-site links | pending | - | 1, D1, D2 | - |

**Phase 1.** Goal: a real, safe, linkable demo exists at `/narration-utils/demo/`. Success: deployed site loads with no console errors or 404s, every page's controls either work via the mock or are visibly disabled, banner is present everywhere.
**Phase 2.** Goal: visitors can see more than the default happy path. Success: landing page links resolve to the intended mock states; README/docs link to the demo.

**Parallelism Notes**: sequential; Phase 2 depends on Phase 1's banner/shell and base-path work being settled.

**Parallel-session compatibility**

| Phase | Files and areas touched | Collision risk |
| --- | --- | --- |
| 1 | `apps/ui/vite.config.ts`, `.github/workflows/pages.yml`, `tools/docs-site/check_site.py` call site, a new app-shell banner component, `apps/ui/src/api/aliceManuscript.ts` (read-only review, edits only if D5 finds an issue) | `release-readiness-provisioning-and-docs-site.prd.md` Phase 13 (CI docs hygiene, same workflow file) |
| 2 | A new route or Home-page addition, `README.md`, `tools/docs-site` nav/include list | Phase 12 of the release-readiness PRD (README/docs accuracy pass) if still open |

Cross-cutting: no `hostAPIVersion` bump (no binding change; the demo consumes the existing mock port). Each phase follows `CLAUDE.md`: plan, TDD where logic changes, `full-verification-gate`, `feature-cleanup`. Phase 1's CI change should be verified with a local `pnpm exec vite build --mode mock --base ...` plus a static file server before trusting the `pages.yml` run, the same way the existing Storybook step was proven per `release-readiness-provisioning-and-docs-site.prd.md:231`.

## Decisions Log

| Decision | Choice | Alternatives | Rationale |
| --- | --- | --- | --- |
| Hosting | Same `pages.yml` job, same GitHub Pages site, `/demo/` subpath | New Pages environment, third-party static host (Netlify, Cloudflare Pages) | No new secrets or accounts; reuses the exact build already proven for Storybook |
| Backend | None — fixture data only, same `mockApi.ts` used elsewhere | A lightweight demo backend with seeded state | Zero server cost/maintenance; consistent with the rest of this repo's browser-mock pattern |
| Default landing state | The existing Alice seed project, unmodified unless D5 finds an issue | A purpose-built smaller "public demo" seed | Reuses proven fixture data instead of maintaining a second dataset |
| Scope vs. `release-readiness-provisioning-and-docs-site.prd.md:76` | Does not reopen that exclusion — that line ruled out a *third-party* host with secrets; this stays on GitHub Pages, no secrets | Treat this PRD's demo as covered by the existing exclusion and decline it | The exclusion's stated reason (third-party host, secrets) does not apply here |
| Base path mechanism (D3) | A `demo` Vite mode, not a `--base` CLI flag ([ADR 0096](../adr/0096-the-public-demo-builds-under-its-own-vite-mode-and-the-router-carries-a-basename.md)) | CLI flag on the existing `mock` mode | Keeps the demo banner's gate (`VITE_DEMO`) out of the `mock` build the visual suite, Storybook and the atlas already depend on for stable captures |
| AGPL source availability (`implementation-plan.md` D17) | The demo banner links to the repository (`https://github.com/countrymanprime/narration-utils`) on every page | No link; rely on a visitor finding the repo another way | Not addressed in this PRD's own text; AGPL-3.0-or-later §13 (ADR 0039) asks a modified copy interacted with over a network to offer its source — the demo is unmodified code, but the link keeps that offer visible rather than assumed |
| D7 (Windows-only unsigned first stable) | No conflict — the demo is a static site build, not a release asset or an installer | — | Out of scope for D7, which governs signing of the desktop app's Windows binary |

## Research Summary

**Technical Context**: verified in code on this branch: the mock API's completeness and existing build mode (`main.tsx`, `mockApi.ts`, `package.json`, `.env.mock`), the default seed project, the URL-param state matrix, the native-call fakes for file/folder selection, the absence of client-side persistence, the existing mock-only UI-gating pattern, and the current `pages.yml`/`check_site.py` shape.
**Not verified**: whether any component reaches a Wails/`window.go` call outside `wailsClient.ts` (assumed no, per the `NarrationApi` port, but not grepped exhaustively in this session); build time/artifact size impact of adding a third build to `pages.yml`; whether the Alice seed data needs any trimming for public display (D5).

---

*Generated: 2026-09-22*
*Status: IN DELIVERY - Phase 1 complete (D3, D5 answered above); Phase 2 pending (D1, D2, D4, D6 still open, adopt each PRD-stated recommendation per D22 when Phase 2 starts)*
