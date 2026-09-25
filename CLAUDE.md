# Working in this repo

## Feature workflow: plan → impact scan → implement → verify → clean up

New features and bugfixes in this repo have a history of silently breaking unrelated things — this order exists to catch that before it ships, not after. For anything beyond a trivial single-file change:

1. **Plan** the change (`/plan` or the `planner` agent). Find or open the tracking issue first (`gh issue list`) and put `Closes #<n>` in the PR; see `docs/operations/github-workflow.md`.
2. **`change-impact-scan`** — before touching a file shared across tools (`libs/python/narration_common`, `integrations/reaper`, `apps/ui/src` components), find every consumer and its existing test coverage. `integrations/reaper` Lua is covered by the bridge harness (`integrations/reaper/tests`, Lua 5.4, [ADR 0066](docs/adr/0066-the-lua-bridge-is-tested-by-a-harness-under-lua-5-4-and-reaper-api-behaviour-is-checked-in-reaper.md)): find the harness tests for every command a Lua consumer touches, and treat a consumer with none as zero-coverage.
3. Implement with TDD (`tdd-guide` agent / `tdd-workflow` skill).
4. **`full-verification-gate`** — run `pnpm check` (the full gate, not `check:fast`) before calling anything done. Run the Playwright visual suite when `apps/ui` changed (see below). When `integrations/reaper` changed, `pnpm check` runs the harness (a fake `reaper` driven through the file protocol, plus mutation checks): add a harness test first for every new or changed command. Manual verification inside REAPER is still needed for what a fake cannot prove (REAPER's own API behaviour): run it scripted on a copy of a project with an isolated `-cfgfile` and record it, and mark anything needing the owner or audio hardware as pending.
5. **`design-spec-guard`** — if the change touches `apps/ui/src/components/primitives/` or `apps/ui/src/styles.css`, check it doesn't silently contradict a recorded ADR.
6. **`feature-cleanup`** — dead code, stale docs, scratch artifacts, ADR bookkeeping (`adr-author` if a real decision was made), a trust-boundary check (a download, the update, a sidecar's arguments, the REAPER bridge, a file the app opens, the release pipeline: re-read its row in `docs/architecture/threat-model.md` and update it and `SECURITY.md`; a moved file, binding or event named by a diagram in `docs/architecture/` updates that diagram), final `git status` review. Re-run `full-verification-gate` after any cleanup edits.

## Wire contracts

Anything that crosses into the UI (a Wails binding result, a live event) or that the host reads back from disk is checked where it crosses, and a new one brings its checks with it: a Zod schema in `apps/ui/src/api/schemas/`, a golden payload written by a Go or Python test (`tests/fixtures/contracts/`, regenerated with `UPDATE_CONTRACTS=1`, never edited by hand), a row in `apps/ui/src/api/wireContracts.test.ts` and a mock that passes the schema. A new REAPER event goes in the table in `apps/desktop/internal/bridge/wire.go`. No `as` cast or bare `JSON.parse` on a payload. See `docs/architecture/wire-contracts.md`.

## Visual bug fixes require screenshot verification

When fixing a visual/UI bug in `apps/ui`, do not consider it done from code review or a single manual screenshot alone. Before reporting a visual fix as complete:

1. Run the Playwright visual suite for the affected page/state across all viewports in `apps/ui/tests/visual/viewports.ts` (desktop, small-desktop, tablet; there is no phone viewport, ADR 0037, except that the Settings states are also captured at a 390 px `reflow` width, ADR 0061, so look at `reflow.png` for those):
   ```bash
   cd apps/ui
   npx playwright test tests/visual/app.spec.ts -g "<page>.*<state>"
   ```
2. Open and actually look at the generated PNGs under `apps/ui/screenshots/app/<page>/<state>/<viewport>.png` for every viewport — not just the one you eyeballed live in a browser pane. A fix that looks right at one width is not verified.
3. If the bug is about responsive/layout behavior specifically, check it at every viewport in that list, since "responsive" bugs routinely only reproduce below/above one specific breakpoint.

Primitives are also covered by the component atlas: every one has a `<Name>.stories.tsx`, and `pnpm --dir apps/ui atlas` builds Storybook and checks every story in light and dark at a wide and a narrow viewport (axe, `play()`, overflow, console errors). Run it too when a primitive or `styles.css` changes; `docs/ui/` is generated from it by `pnpm --dir apps/ui docs:atlas` (`apps/ui/scripts/atlas-docs.mjs`, ADR 0243).

The visual suite also runs axe on every state it captures: a violation fails the capture unless `apps/ui/tests/visual/axe-debt.ts` declares it with a reason and an issue, and a declared rule that stops being reported fails too, so fix the page and delete the entry rather than add one (`UI_AXE=1` measures without failing; ADR 0064). When a dialog, slide-over or the navigation changes, also run `pnpm --dir apps/ui run aria`: it pins their role trees (ADR 0065), and a changed tree is a changed screen-reader experience, so update a snapshot only when the change is intended and read the diff (`docs/operations/verification-tooling.md`).

`apps/ui/screenshots/` is gitignored — these are scratch verification artifacts, not committed output.

The suite is also a gate, not just a camera: each `{page, state}` is its own test (`<page> / <state>`), which loads and drives the state once and captures every viewport as its own step (a row with `reloadPerViewport` keeps a test per viewport, `<page> / <state> / <viewport>`, on a fresh page each), there are no retries, and a run fails on page errors, failed requests, sideways overflow at any viewport, a collapsed control (a text box or select under 64 px, [ADR 0060](docs/adr/0060-the-visual-suite-fails-a-collapsed-control-and-a-row-may-declare-one-narrow-on-purpose.md)), blank screenshots, and two states that render identically unless the catalog row declares `sameAs`. CI runs it in three `ui-visual (shard i/3)` jobs and judges the whole run (duplicates, `sameAs`, blanks, completeness) in the `ui-visual` job (ADR 0244). If it goes red, fix the UI or the driver — don't add a `sameAs`/`undriven`/`narrowControls` escape without a real reason. How to reach a state lives in `apps/ui/tests/visual/app.drivers.ts`; the row's metadata (`undriven`, `sameAs`, `narrowControls`, `extraViewports`, `pointer`, `mask`) lives in `state-catalog.ts`.
