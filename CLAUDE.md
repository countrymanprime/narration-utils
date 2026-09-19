# Working in this repo

## Feature workflow: plan → impact scan → implement → verify → clean up

New features and bugfixes in this repo have a history of silently breaking unrelated things — this order exists to catch that before it ships, not after. For anything beyond a trivial single-file change:

1. **Plan** the change (`/plan` or the `planner` agent). Find or open the tracking issue first (`gh issue list`) and put `Closes #<n>` in the PR; see `docs/operations/github-workflow.md`.
2. **`change-impact-scan`** — before touching a file shared across tools (`shared/python/narration_common`, `shared/reaper`, `shared/ui/src` components), find every consumer and its existing test coverage. `shared/reaper` Lua has no automated tests — treat every Lua consumer as zero-coverage by default.
3. Implement with TDD (`tdd-guide` agent / `tdd-workflow` skill).
4. **`full-verification-gate`** — run `pnpm check` (the full gate, not `check:fast`) before calling anything done. Run the Playwright visual suite when `shared/ui` changed (see below). Require explicit manual verification inside Reaper when `shared/reaper` changed, since nothing automated proves Lua behavior.
5. **`design-spec-guard`** — if the change touches `shared/ui/src/components/primitives/` or `shared/ui/src/styles.css`, check it doesn't silently contradict a recorded ADR.
6. **`feature-cleanup`** — dead code, stale docs, scratch artifacts, ADR bookkeeping (`adr-author` if a real decision was made), final `git status` review. Re-run `full-verification-gate` after any cleanup edits.

## Visual bug fixes require screenshot verification

When fixing a visual/UI bug in `shared/ui`, do not consider it done from code review or a single manual screenshot alone. Before reporting a visual fix as complete:

1. Run the Playwright visual suite for the affected page/state across all viewports in `shared/ui/tests/visual/viewports.ts` (desktop, small-desktop, tablet, mobile):
   ```bash
   cd shared/ui
   npx playwright test tests/visual/app.spec.ts -g "<page>.*<state>"
   ```
2. Open and actually look at the generated PNGs under `shared/ui/screenshots/app/<page>/<state>/<viewport>.png` for every viewport — not just the one you eyeballed live in a browser pane. A fix that looks right at one width is not verified.
3. If the bug is about responsive/layout behavior specifically, check it at every viewport in that list, since "responsive" bugs routinely only reproduce below/above one specific breakpoint.

Primitives are also covered by the component atlas: every one has a `<Name>.stories.tsx`, and `pnpm --dir shared/ui atlas` builds Storybook and checks every story in light and dark at a wide and a narrow viewport (axe, `play()`, overflow, console errors). Run it too when a primitive or `styles.css` changes; `docs/ui/` is generated from it by `node tools/ui-atlas-kit/plugin/cli/ui-atlas.mjs docs --dir shared/ui` (the reusable version of all of this lives in `tools/ui-atlas-kit`).

`shared/ui/screenshots/` is gitignored — these are scratch verification artifacts, not committed output.

The suite is also a gate, not just a camera: each `{page, state, viewport}` is its own test (`<page> / <state> / <viewport>`), there are no retries, and a run fails on page errors, failed requests, sideways overflow at any viewport, blank screenshots, and two states that render identically unless the catalog row declares `sameAs`. CI runs it as the `ui-visual` job. If it goes red, fix the UI or the driver — don't add a `sameAs`/`undriven` escape without a real reason. How to reach a state lives in `shared/ui/tests/visual/app.drivers.ts`; the row's metadata (`undriven`, `sameAs`, `pointer`, `mask`) lives in `state-catalog.ts`.
