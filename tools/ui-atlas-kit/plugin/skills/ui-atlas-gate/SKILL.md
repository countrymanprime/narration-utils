---
name: ui-atlas-gate
description: Use before calling any UI change done, to run the required commands in order, look at the screenshots, and record gate evidence; this is the visual half of the repo's full verification gate.
---

# ui-atlas-gate

## Why this exists

UI changes break things a unit test cannot see: overflow at 390px, a state that stopped rendering what it claims,
a dark-theme contrast regression, a doc image that no longer matches. The capture suites only protect the UI if they
are run, read, and reported every time, not "when someone remembers" (ADR 0023). This skill defines "done" for a UI
change so the answer is the same for every agent and every repo. It succeeds the visual half of
`full-verification-gate`, which still owns the non-UI checks (Python, Go, Lua and the like).

## When to use this

Before reporting any change under the UI root as complete: components, pages, styles, theme tokens, stories,
drivers, the state catalog, or Playwright config. Re-run it after every fix made in response to its own findings.
The Stop hook of this plugin blocks ending a turn when UI files were edited and no fresh evidence exists.

## What to do

1. Run these from the UI root (for example `apps/ui`; use the repo's package manager). All must exit 0:
   ```bash
   pnpm test              # unit tests, every story via composeStories, atlas coverage and catalog integrity
   pnpm run lint:ci
   pnpm run format:check
   pnpm run build         # typecheck plus production build
   pnpm run screenshots   # app visual suite, one test per {page, state, viewport}
   pnpm run atlas         # builds Storybook, then story x theme x viewport with play() and axe
   ```
   Do not substitute a filtered subset unless the change is trivially scoped; if you scope down, say what you
   skipped and why. Run the atlas alone: never two atlas builds at once against the same `storybook-static`.
2. If a component, story or docs image changed, sync the docs with `ui-atlas-docs-sync` and confirm
   `node "${CLAUDE_PLUGIN_ROOT}/cli/ui-atlas.mjs" audit --dir <ui-root>` reports no stale generated docs.
3. Open the screenshots for every state you touched at every viewport (and both themes for the atlas) using
   `ui-visual-review`. For a fix to a reported visual bug, also do the affected `{page, state}` first with
   `npx playwright test tests/visual/app.spec.ts -g "<page> / <state>"`.
4. Debt and exemptions. If the change adds or edits `ATLAS_EXEMPT`, an `A11Y_DEBT` or `axeDebt` entry, a catalog `sameAs`, a `narrowControls`
   allowance, an `undriven` reason, or raises a ratchet constant (for example `MAX_DEBT_ENTRIES`), the PR description must name each
   one with: the rule or state, the reason it is not fixed now, and where the fix is tracked. These lists may only
   shrink, so a raised ratchet needs an explicit maintainer decision, not just a green run. An unexplained
   escape is a failed gate.
5. Write the evidence only after everything above is green and no UI file has been edited since. It goes in the
   project root (the directory the session started in, where the hook keeps `.ui-atlas/dirty`), which is not
   necessarily the UI root; `ls .ui-atlas/dirty` from there confirms it:
   ```bash
   mkdir -p .ui-atlas && printf 'date=%s\napp_visual=<passed>/<total>\natlas=<passed>/<total>\nscreenshots_viewed=<n>\n' "$(date -u +%FT%TZ)" > .ui-atlas/gate-evidence
   ```
   Fill the counts from the real Playwright summaries. The Stop hook compares this file's modification time to
   `.ui-atlas/dirty`; it checks freshness, not content, so the counts are your accountability, not the hook's.
   `.ui-atlas/` is local scratch state, self-ignored by a `.gitignore` the hook writes into it. Never commit it.
6. Report evidence in the final message: commands run with their exit results, test counts (passed/total for the
   app suite and the atlas), how many PNGs were opened and at which viewports, any debt or exemption changes with
   reasons, and anything not verified. Do not say "done" while a required command is red or a step is outstanding.
7. Order relative to other gates: implement with tests, then this gate, then the repo's other gates
   (`change-impact-scan` runs before implementation; `design-spec-guard` and `feature-cleanup` run after this gate
   passes). Any cleanup edit that touches UI files re-dirties the tree, so re-run this gate after cleanup.

## What this skill is not

It is not a substitute for the repo's full check (`pnpm check` or equivalent) for non-UI code. It does not update
pixel baselines, and it does not authorize skipping a red suite by adding a `sameAs`, `undriven` or debt entry to
silence it. Reviewing images is `ui-visual-review`, not this skill.
