# 0021. The visual suite is a validated capture contract, and Storybook is the component layer

- Status: accepted
- Date: 2026-09-19

## Context

The Playwright visual suite (ADR 0011) only ran when someone remembered to, and when it did run it was
inconsistent: no CI job, a single test per state looping four viewports with `retries: 1`, `waitForTimeout`
sleeps, catalog rows silently skipped for lack of a driver, and output nobody checked except by eye.
Measured on identical code, 9 of 244 screenshots differed between two runs, and pairs of states rendered
identically without anyone noticing (ADR 0011 recorded three by accident). Nothing exercised the
`components/primitives/` library in isolation.

## Decision

1. **The suite becomes a gate on what it can prove.** Each `{page, state, viewport}` is its own test with no
   retries. A capture fails on an uncaught page error, a failed request, sideways overflow, a blank image, or
   two states that render byte-identically unless the catalog row declares `sameAs` (which is itself checked and
   fails when the pair stops matching). A catalog row with no driver must say why via `undriven`, and the count
   of such rows cannot grow. Waits are conditions, never sleeps; a driver freezes the page clock only where a
   real timer would race the screenshot (the toast). CI runs it as the `ui-visual` job. It is still not a
   pixel-diff gate: it cannot say a layout looks right.
2. **Storybook 10 (`@storybook/react-vite`, `@storybook/addon-a11y`) is the component layer**, one story per
   variant/state next to each primitive, so the story is the catalog entry and its driver. A spike confirmed it
   works with this repo's Vite 6, Tailwind 3 and CSS-variable theming; stories run as jsdom unit tests through
   `composeStories`, and an external Playwright runner iterates `index.json`. `@storybook/addon-vitest` is not
   used because it needs Vitest 3+ (this repo is on 2).
3. **The reusable parts move to a shared kit** (Claude plugin plus a versioned harness package) applied to every
   React UI repo; this repo is its first consumer.

## Consequences

Turning the checks on immediately found real defects: `ProjectPicker`'s card overflowed a 390px viewport by
63px, `manuscript/sticky-header-scrolled` and `settings/reset-override` never showed what they claimed, and two
catalog rows were never driven at all. Byte identity is used to find duplicates because a fuzzy match cannot tell a
Play-to-Pause glyph from anti-aliasing noise; a coarse signature is used only to forgive jitter on already
declared `sameAs` pairs. Some captures still differ by sub-pixel anti-aliasing between runs on Windows, so
pixel baselines are not adopted here; if they are added later they must come from a pinned Linux container, not a
developer machine.

The primitives atlas (`pnpm --dir shared/ui atlas`: every story x light/dark x 1024/390px, with `play()`, axe and overflow checks) found three more things immediately. The active `Pill` label (and two copy-pasted equivalents in `Transcript` and `Manuscript`) rendered muted grey on the accent fill because two text colours sat on one element; fixed by choosing one per state. `Dialog` and `WorkDialog` scroll regions were not keyboard reachable; fixed with `tabIndex={0}`. Palette tokens `--text-faint` (and `--text-muted` on `--surface-2`/`--surface-3`) miss WCAG AA 4.5:1; fixing that collapses the faint/muted hierarchy, so it is recorded as explicit, reasoned, ratcheted debt in `shared/ui/tests/atlas/a11y-debt.ts` (WorkDialog, MeterBar) rather than hidden or silently re-coloured. Components also lack some accessibility semantics (no Escape or focus trap in dialogs, no `role=progressbar` on the meters); those are noted in the story files' comments, not fixed here.

Running both suites against `main` after its React 19 / Tailwind 4 / router 7 upgrade found more: the Manuscript deep-link effect looped ("Maximum update depth exceeded") because it re-fired for a `#p...` hash the router had not yet cleared, fixed by consuming each hash once; the capture driver's mobile-drawer helper opened the nav drawer over a page that was merely still rendering; and the selection-popup and add-note states had silently stopped selecting anything after a markup change, which the duplicate-screenshot check caught. The active nav item (accent text on an accent tint, 4.03:1) and `Highlight` (category colours on their own tint, 3.2-3.8:1) join the recorded contrast debt. A page-wide fake clock is not used: it stops React 19 transitions, so only the toast state freezes timers.
