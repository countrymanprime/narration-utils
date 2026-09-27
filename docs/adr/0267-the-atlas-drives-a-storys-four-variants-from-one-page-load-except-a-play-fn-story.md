# 0267. The atlas drives a story's four variants from one page load, except a play-fn story

**Status:** Accepted
**Date:** 2026-09-27
**Supersedes:** none

## Context

`quality / ui-atlas` runs 988 tests (later 1360, as the component set grew) - every Storybook story x {light, dark} x {wide, narrow} - each its own `test()` in `apps/ui/tests/atlas/atlas.spec.ts`, each a fresh `page.goto('/iframe.html?...')`. The Storybook build itself is seconds; the job's 6 m 45 s is almost entirely the four navigations and re-renders per story (`docs/prds/ci-pipeline-speed.prd.md`, deleted once its phases were delivered - see [CI and releases](../operations/ci-and-releases.md#ci-performance) - Phase 4). [ADR 0105](0105-the-visual-suite-drives-each-state-once-and-resizes-through-the-viewports.md) made the same trade for `apps/ui/tests/visual/app.spec.ts` - one load per `{page, state}`, then a `test.step` per viewport - but that suite has no theme axis and no concept of a story's `play()` mutating what is on screen, so its mechanism does not carry over directly: the atlas needs a second axis (theme) switched without navigating, and a story-level signal for which stories are safe to reuse a page across variants.

Storybook tags a story with `play-fn` in its index automatically when the story exports a `play()` function (checked against every story with a `play:` property in a `.stories.tsx` file at the time of writing: 161 of 340, exactly matching the `play-fn` tag count). A story with `play()` mutates itself when it renders (a dialog opens, a form fills in) - reusing its page for a second variant would show the second variant a story already left in the first variant's end state, not the second variant's own starting point.

Storybook's own preview channel makes the theme switch possible: the `updateGlobals` event re-renders every current story render unconditionally, whether or not the global's value actually changed (read from `storybook`'s bundled preview runtime, `onUpdateGlobals`/`onForceReRender`), which re-applies `.storybook/preview.tsx`'s theme decorator and reruns addon-a11y's `afterEach` (axe) at the story's new size - the same checks a fresh load makes.

## Decision

`apps/ui/tests/atlas/atlas.spec.ts` makes **one test per story** (`<title> / <name>`), not one per variant. Its body drives all four `{theme, viewport}` variants as a `test.step` each:

1. **The first variant always loads fresh**, the same `page.goto('/iframe.html?id=...')` as before.
2. **A story with no `play()`** (no `play-fn` tag, and not listed in `RELOAD_DEBT`) drives its remaining three variants on the same page: `setViewportSize`, `emulateMedia`, then `channel.emit('updateGlobals', { globals: { theme } })` (awaiting the `storyFinished` event it triggers) to force the re-render and a fresh axe run at the new size, even when the emitted theme is unchanged from the previous variant (a resize-only step still needs a fresh render to recheck axe at the new width).
3. **A story tagged `play-fn`, or named in `RELOAD_DEBT`** (`apps/ui/tests/atlas/reload-debt.ts`), reloads fresh for every variant, unchanged from before this ADR.

Every variant is still captured (the same screenshot path, `<dir>/<name>--<theme>-<viewport>.png`) and checked (a11y via `finished.reporters`, `play()` exceptions, `errorDisplay`, overflow, broken images, console/page errors) the same way regardless of which path reached it. A check failing on one variant does not stop the remaining variants of that story from being captured and checked: failures are collected into one array per test and asserted once at the end (mirroring ADR 0105's per-viewport `failures` array), rather than thrown inline, so the loop over variants always completes. `global-setup.ts` (stale-screenshot pruning) and `a11y-debt.ts` are unchanged.

**Verified by diff, not by inspection alone (the PRD's Risks table).** The old (per-variant test) and new (grouped) `atlas.spec.ts` ran against the same Storybook build; their pass/fail results, the a11y violations each variant reported and the resulting PNGs were compared. `RELOAD_DEBT` exists for a story the diff finds rendering differently after a re-render than after a fresh load (leftover measured layout, a resize-sensitive measurement) - it starts empty and only grows when such a difference is actually found, the same spirit as `a11y-debt.ts`.

## Consequences

- 340 stories x 4 variants: 256 fewer navigations (a story with no `play()` pays for one `page.goto` instead of four), leaving 161 x 4 play-fn navigations plus 179 fresh loads (one per non-play story) instead of 1360 total.
- A story's four screenshots and axe runs are still all made; `RELOAD_DEBT` is the same kind of one-line, reasoned escape hatch as `a11y-debt.ts`, not a default, and starts empty.
- `-g` selects a story, not one variant of it: a variant is a step, and its timeout is the per-test timeout times four (mirroring ADR 0105).
- A new story with a `play()` needs no annotation: the `play-fn` tag is automatic. A story that turns out to depend on being freshly mounted for reasons other than `play()` (a leaked measurement, not caught by the tooling) needs a `RELOAD_DEBT` entry with a reason, found the same way ADR 0105 found its `reloadPerViewport` rows: run with and without the grouping and diff the PNGs.
- Undoing this means one test per variant again: remove the grouping loop and `RELOAD_DEBT`, or supersede this ADR.
