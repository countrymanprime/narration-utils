# 0050. The segmented meter is an image named by its segments, and Field wires its hint and error through Base UI

- **Status:** Accepted
- **Date:** 2026-09-20
- **Deciders:** the owner

## Context and problem

Two primitives had accessibility gaps that every page inherited. `MeterBar` (the recording-progress bar on Home) had no role or name, its segments were unnamed boxes with hover-only tooltips, and it animated its width even for users who ask for reduced motion. `Field` (the labelled text control in the Story Bible entry form) had no place for a hint or an error and wired nothing to the control beyond wrapping it in a `<label>`. The foundation PRD (owner decisions D1 and D22) puts `Field` on Base UI's Field and keeps `MeterBar` custom, because Base UI's Meter and Progress model a single value in a range and this bar is several segments of one whole.

## Decision drivers

- Base UI's Meter and Progress model a single value in a range, and the meter bar is several segments of one whole.
- A screen reader should hear at once what a sighted user learns by hovering.
- `Field` had no place for a hint or an error.

## Considered options

1. `MeterBar` as a custom `role="img"` named by its segments, and `Field` on Base UI Field
2. Base UI's Meter or Progress for `MeterBar`
3. `role="meter"` for `MeterBar`

## Decision outcome

**Chosen option: `MeterBar` as a custom `role="img"` named by its segments, and `Field` on Base UI Field**, because Base UI's Meter and Progress, like `role="meter"`, model a single value, while this bar is several segments of one whole.

- **`MeterBar`** (`apps/ui/src/components/primitives/MeterBar.tsx`) takes a required `label`. It is `role="img"` and its accessible name is the label followed by every segment's own tooltip text (`Recording progress: Finalized: 4 chapters · ~2h 10m finished audio; Proofing: 2 chapters · …`), so a screen reader hears at once what a sighted user learns by hovering. The segments stay pointer-only hints, not tab stops. The width transition is `motion-safe:` only, so it does not run under `prefers-reduced-motion`. The one call site (`AudiobookEstimatePanel.tsx`) passes "Recording progress". A `role="meter"` was rejected: it has one value.
- **`Field`** (`Field.tsx`) is built on Base UI Field (Root, Label, Control, Description, Error). Base UI connects the label (`for`), the hint (`Field.Description`) and the error (`Field.Error`) to the control, and marks it `aria-invalid` when there is an error (not while the field is disabled: the library leaves it off a disabled control, though the error text and the danger border still show), so none of that is written by hand. Two optional props are new: `hint` and `error`. The control stays controlled and keeps its classes (including the medium weight it used to inherit from its `<label>`); the textarea is the same control rendered as a `<textarea>`. An invalid control gets a danger border through the `data-invalid` attribute.
- **Tests.** `MeterBar.test.tsx` and `Field.test.tsx` (RTL) and stories for both: the composed name, a hint, an error, a textarea with both. Reduced motion is guarded by the unit test on the `motion-safe:` classes only: the Storybook preview switches every transition off globally, so a story cannot prove it.

### Consequences

- **Neutral:** The recording-progress bar is announced with its breakdown instead of being silent. The label is caller text, so it can go stale if a caller stops passing the segments' real numbers.
- **Neutral:** No form validates inline today, so `hint` and `error` have no caller yet; they exist so the first form that needs one does not have to hand-wire it.
- **Neutral:** `Heading` and `Panel` (levels and a named region, the rest of the component-accessibility PRD) are unchanged and stay in the dialog and accessibility stack that follows.
- **Neutral:** To change any of this, write a new ADR that supersedes this one.

### Confirmation

`MeterBar.test.tsx` and `Field.test.tsx` (RTL) and stories for both; reduced motion is guarded by the unit test on the `motion-safe:` classes only.

## Pros and cons of the options

### Base UI's Meter or Progress

- Bad, because they model a single value in a range, and this bar is several segments of one whole.

### `role="meter"`

- Bad, because it has one value.
