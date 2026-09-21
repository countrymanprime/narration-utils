# 0061. Settings states are also captured at a 390 px reflow width

**Status:** Proposed
**Date:** 2026-09-21
**Supersedes:**
**Amends:** [ADR 0037](0037-visual-suite-captures-no-phone-viewport.md) (which widths the suite captures)

## Context

[ADR 0037](0037-visual-suite-captures-no-phone-viewport.md) dropped the 390 px viewport: nobody runs the app on a phone, the desktop shell's `MinWidth` is 960 px, and mobile was a third of the `ui-visual` job's time. It noted that a layout regression below 768 px would no longer be caught, and named the Settings layout at 390 px as the known example.

That example is the reason to revisit it. The Settings row collapsed only below `md` (768 px), and the collapsed-control check ([ADR 0060](0060-the-visual-suite-fails-a-collapsed-control-and-a-row-may-declare-one-narrow-on-purpose.md)) passes at all three captured widths on the pre-fix layout: at 768 px the control was 127 px. So the check could not have caught the bug it was written for. The layout is still reachable: the shell's minimum is 960 CSS px, but browser zoom divides that (400% zoom of a 1280 px window is 320 CSS px, the width WCAG 1.4.10 Reflow asks content to survive), and the responsive layout, the stacked rows and the navigation drawer are shipped code.

This decision reverses part of an owner decision, so it is `Proposed`: the work follows the recommended path and the owner can reject it. The settings mobile layout PRD's own recommendation (its metrics ask for control widths "at 390px") points the same way, and the implementation plan's instruction for this stack was to run the check "at the viewports the suite captures plus any the PRD needs".

## Decision

**The default matrix stays desktop, small-desktop and tablet (ADR 0037 stands).** One more viewport exists, `REFLOW_VIEWPORT` (`reflow`, 390 x 844) in `apps/ui/tests/visual/viewports.ts`, and it is opt-in per catalog row: `StateEntry.extraViewports` (a kit 0.3.3 field, see ADR 0060) lists it, and `app.spec.ts` captures `[...VIEWPORTS, ...extraViewports]`. Only the 13 Settings states opt in (`...REFLOW` in `state-catalog.ts`); a unit test requires every Settings state to.

**`clickNav` opens the drawer** when the layout shows the "Open navigation" button instead of the item: it clicks the button, picks the item in the `Navigation` dialog and waits for the dialog to close. This is what ADR 0037 asked for ("teach this helper to open the drawer; do not guess with a timeout"), it only runs at the reflow width, and no state that opens the drawer itself is restored (`global/nav-drawer-open` stays removed; the drawer's record is still its atlas stories).

## Consequences

- The collapsed-control check runs on the Settings rows at 390 px, and the PNGs at `screenshots/app/settings/<state>/reflow.png` are reviewed with the others. It was proved red on the pre-fix layout at `reflow` (five controls named) and green at the other three widths, which is the whole argument for the width.
- The suite runs 235 tests instead of 222: 13 more at about 1.5 s each, in parallel, about 5 s of `ui-visual` time, far from the third that a full mobile viewport cost.
- Rows opt in one at a time, so another page whose layout changes below `md` can do the same with a line in its catalog rows; nothing else pays.
- If the owner rejects this: delete `...REFLOW` from the Settings rows and the extra-viewport test; the check keeps running at three widths and can no longer see this class of bug at 390 px.
- To capture a phone width for every state again, add it to `VIEWPORTS` and write a new ADR that supersedes 0037.
