# 0064. The visual suite runs axe on every app state, and a violation fails unless it is declared debt

**Status:** Accepted
**Date:** 2026-09-21
**Supersedes:**
**Amends:** [ADR 0023](0023-visual-suite-capture-contract-and-storybook.md) (what the capture gate fails on)

## Context

Axe ran on Storybook stories only (`tests/atlas/atlas.spec.ts`), so page-level accessibility, the labels, landmarks and dialog roles of the pages a person actually sees, was checked only by looking at the PNGs. The test flakiness PRD queued "axe on app states" behind the dialog and palette work, so the first baseline would not be dominated by defects that work was about to fix (owner decision D22, question 6: measure a report-only baseline first, then gate with a debt ratchet). Both are delivered, and the palette stack left every app state at 0 `color-contrast` violations in both themes.

## Decision

**The visual suite runs axe on every `{page, state, viewport}` it captures**, after the screenshot is taken so the picture is unchanged (kit 0.3.4, `tests/visual/lib/capture.ts`). It uses axe's default rules, the same as the atlas, groups the violations by rule and records them with the capture.

- **Three modes** (`resolveAxeMode`): the **gate** when the project's `app.drivers.ts` exports `axeDebt`; **report only** with `UI_AXE=1` (nothing fails; the teardown prints the run's total and the count per rule, and one line per state); off with `UI_AXE=0`. `UI_AXE=gate` forces the gate for a project with no list, and a mistyped value throws so a typo cannot quietly turn a gate off. A repo that never declares `axeDebt` needs no `axe-core`.
- **The debt list is `apps/ui/tests/visual/axe-debt.ts`**: entries of `{ page, state, rules, reason, viewports? }` for violations that are a design decision, not a quick fix. It is the app-state counterpart of the atlas's `A11Y_DEBT`, and it is an allowlist that is checked, not trusted: a violation the list does not declare fails the capture (with the rule, node count, selectors and axe's advice), and a declared rule that is no longer reported fails too, so an entry cannot outlive its violation. `MAX_AXE_DEBT_RULES` in `src/visualSuite.test.ts` caps the (state, rule) pairs and may only fall; every entry must name a catalog row, a rule, a reason and the issue that tracks the fix.
- **Measured baseline (report only, 235 captures, 3 viewports, light theme):** 533 elements over 50 captures, with the two toast states not measurable (see below). Two defects were fixed on the way because they were one line each: the chapter bookmark toggle in the reader had no accessible name (396 elements, `button-name`), and the project picker had no `main` landmark or level-1 heading (`landmark-one-main`, `page-has-heading-one`, and `region` on its content). After them: **122 elements over 44 captures, in five rules**, and no `color-contrast`: `nested-interactive` (overlapping highlights are nested `role=button` marks, 90), `region` (portalled popups outside the landmarks, 14), `aria-hidden-focus` (Base UI's focus guards, 12), `aria-required-attr` and `aria-required-children` (the bespoke alias typeahead, 3 each). All of it is declared as 19 (state, rule) pairs, tracked in #155, #156 and #157.
- **A frozen page clock stops axe.** The two toast states freeze the clock so the toast cannot fade before the shot, and axe waits on timers, so the run hung until the test timed out. Axe runs after the shot, so the capture resumes the clock first, and only when a driver installed one (`page.clock.resume()` on a page with none installs a fake clock itself, with `Date` at 1970, which a review caught). The toast's own timer then runs again in real time; a toast that fades before axe finishes is not checked, which can only miss a violation, and neither frozen state declares debt.
- **The gate cannot be switched off on CI.** `UI_AXE=0` and `UI_AXE=1` are for a developer's shell: on CI a project that declares `axeDebt` fails the run when either is set (`checkAxeModeForCi`), the teardown prints the mode of every run, and a mistyped value fails at the start of the run, not after every capture.

Axe still cannot judge gradients or low-contrast text over semi-transparent overlays, and it says nothing about focus order or what a screen reader announces. It does not replace looking at the PNGs or a screen-reader pass.

## Consequences

- A new page or state that ships an unlabelled control, a page with no landmark, or an unnamed dialog fails the suite where it is introduced, at every viewport, with the selector.
- The suite's cost is one axe run per capture: the full run of 235 captures took 1.9 to 2.2 minutes with axe (two runs) and 1.6 minutes with `UI_AXE=0` on the development machine (four parallel workers), about 0.3 to 0.6 minutes more. `UI_AXE=0` skips it for a quick local loop.
- The debt list starts at 19 pairs for five real defects. An entry must be on a driven row and is checked at each viewport it names, so a responsive change that stops one rendering at one width fails as "no longer holds" there and the entry gets a `viewports` list. Fixing one deletes its entries and lowers `MAX_AXE_DEBT_RULES`; raising the cap needs a maintainer's decision, like a raised `MAX_UNDRIVEN`.
- The suite runs the light theme by default. `UI_THEME=dark UI_AXE=1` measures the dark theme by hand; the dark palette's contrast is also guarded by `paletteContrast.test.ts`.
- Adopting repositories add `axe-core`, measure with `UI_AXE=1`, and declare `axeDebt` (kit CHANGELOG 0.3.4, "Adopt by hand").
- To change any of this (gate on a stricter rule set, run axe in dark by default, drop the gate), write a new ADR that supersedes this one.
