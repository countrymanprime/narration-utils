# 0060. The visual suite fails a collapsed control, and a row may declare one narrow on purpose

**Status:** Accepted
**Date:** 2026-09-21
**Supersedes:**
**Amends:** [ADR 0023](0023-visual-suite-capture-contract-and-storybook.md) (what a capture fails on)

## Context

At a 390 px window every Settings row with a select or a colour box rendered its control as a blank sliver: the model and chunk-length selects were 44.8 px wide and the hex boxes 26 px (defect 8 of the retired defects register). The row was a grid with no breakpoint, and a grid gives a fixed-range track (the label's `minmax(12rem,16rem)`) its full maximum before a flexible track gets any. The visual suite that exists to catch layout bugs did not see it: [ADR 0023](0023-visual-suite-capture-contract-and-storybook.md)'s checks are page errors, failed requests, sideways overflow, a blank image and undeclared duplicates, and a collapsed control does not overflow, it shrinks. Nothing measured a control. The same defect would have shipped again with the next Settings field.

The owner answered the settings mobile layout PRD's questions with their recommendations (implementation plan D22): the check belongs in the kit core (question 1a), at a flat 64 px with colour swatches and check boxes exempt by type (question 2), and a row may opt out with a reason.

## Decision

**A capture fails when a visible text-like control is narrower than 64 px.** `captureState` (`tests/visual/lib/capture.ts`) measures, after the driver has settled and the pointer is parked, every `input`, `select` and `textarea` that is in the layout (it has a box and is not `visibility: hidden`), except the `input` types a person does not type into (`NON_TEXT_INPUT_TYPES`: `color`, `checkbox`, `radio`, `range`, `file`, `hidden`, `button`, `submit`, `reset`, `image`). A colour swatch, a check box and the Base UI switch are small by design and are exempt by type, not by a list of names. A control in the layout with no width is collapsed, not missing. The failure names the control (its accessible name), its kind, its width and the viewport, and it is raised after the screenshot is taken and recorded, so the picture of the failure exists.

**The logic is pure and unit-tested.** `findCollapsedControls`, `checkControlWidths` and `findNarrowestControl` live in `lib/validators.ts` with the other run checks and are covered in `src/visualSuite.test.ts`; only the DOM measurement is in `capture.ts`. `CaptureRecord` gains `narrowestControlPx` and the teardown prints the narrowest control of the run, which is what the threshold was calibrated from and stays visible as the layout changes.

**64 px, flat.** The failure this exists for is a control squeezed to a sliver by a layout, not a control that is a little tight, and a fraction of the container would move with the layout it is meant to judge. Calibration, one full run on the fixed layout (235 captures): the narrowest text control was 119 px (a select in the expanded chapter table on Home), then 143.6 px on the Settings rows at tablet and 273.6 px at the reflow width ([ADR 0061](0061-settings-states-are-also-captured-at-a-390px-reflow-width.md)); the collapsed layout measured 44.8 px (selects) and 26 px (hex boxes). 64 px is 1.5 to 2.5 times above what collapsed and less than half of the smallest legitimate control.

**A row may declare a control narrow on purpose, with a reason, and the declaration is checked.** `StateEntry.narrowControls: { labels, reason, viewports? }` in `state-catalog.ts` names controls by accessible name; it needs a reason (the catalog integrity test requires one), and, like `sameAs`, it fails when it stops being true (the control is no longer narrower than the minimum, or is not on the page) so an allowance cannot outlive its cause. A declaration limited to some viewports is neither applied nor checked at the others. Nothing uses it today: every text control in the suite passes.

**It is a kit change.** The check is in the kit core (`tools/ui-atlas-kit/plugin/templates/core/tests/visual/lib/`), so every repo using the kit gets it: kit 0.3.3 (0.3.2 was S07's scaffold-only release), `apps/ui` stays the upstream and `refresh-core.mjs` copies the files, the drift test and the CHANGELOG (with the "adopt by hand" lines for the scaffold test) keep the release honest.

## Consequences

- The class of bug in defect 8 fails the gate at the state and viewport where it happens, naming the control. It was proved red on the pre-fix layout (`settings / global-proofing / reflow`: five controls named, 44.8 px and 26 px) and green on the fixed one.
- A new field, or a new page, with a squeezed control is caught by whoever adds it. The cost is one `page.evaluate` per capture and a check nobody has to remember.
- It only sees widths the suite captures. That is why the Settings rows are also captured at the reflow width (ADR 0061); a layout that collapses at some other width is invisible to it.
- A control that is legitimately narrow needs a `narrowControls` entry with a reason, which is deliberately more work than fixing a layout.
- The kit's adopters must copy the new tests into their `src/visualSuite.test.ts` and may find controls that were already collapsed.
- To change the minimum, the exempt types or the rule, write a new ADR that supersedes this one.
