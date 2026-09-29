# 0610. Inputs fill an unselected radio with `--surface-3`, and the focus ring is `focus-visible`, not `focus`

**Status:** Proposed (Phase 6 of the mock fidelity PRD, stream F-P6 on [#509](https://github.com/countrymanprime/narration-utils/issues/509); its radio-fill reading is for the owner to confirm on [#510](https://github.com/countrymanprime/narration-utils/issues/510) as a D91 reason if the pixel difference still matters after this fix)
**Date:** 2026-09-28
**Supersedes:** nothing

## Context

The mock fidelity PRD's Inputs spec (Phase 6) measures `TextField`, `Select`, `Field` and `RadioGroup` against the dark-set mocks (`credits-token-setup-and-front-matter-detection/01`, `delivery-platform-profiles/05` and `/06`, `edit-and-proof-workspace/01`). Two of its "App today" readings weren't a size or a missing feature, but an inconsistency between what a primitive draws and what its sibling primitives already draw:

- **The radio fill.** `RadioGroup`'s unselected `Radio.Root` filled with `bg-[var(--surface)]`, the same colour as the page behind it, so an unselected option had no visible fill of its own - only its `border-[var(--border)]` rim separated it from the page. The mocks draw a filled circle.
- **The focus ring.** `TextField`, `Select` and `Field` triggered their ring on `focus` (any focus, including a mouse click), while `RadioGroup`, `Switch` and `Checkbox` already used `focus-visible` (keyboard focus only) - three of six input primitives one way, three the other, with no record of which was intended.

Both are the kind of drift the PRD's Problem Statement names directly: "each worker ... kept the existing primitive's look because it was 'close enough'."

## Decision

- **`RadioGroup`'s `Radio.Root`** fills unselected with `bg-[var(--surface-3)]`, keeping its existing `border-[var(--border)]` rim. This is the PRD's own recommended fix (an existing token, not a new one).
- **`TextField`, `Select` and `Field`** move their focus ring from `focus:outline-2 focus:outline-offset-1 focus:outline-[var(--accent)]` to `focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent)]`, matching `RadioGroup`, `Switch` and `Checkbox`. Every input primitive now shows its ring on keyboard focus only, never on a mouse click.

Applies to `apps/ui/src/components/primitives/TextField.tsx`, `Select.tsx`, `Field.tsx` and `RadioGroup.tsx`.

## Consequences

- **A radio's state reads at a glance.** An unselected option is now a visibly filled circle, not an outline sitting on the page's own colour, matching the mocks and matching how `Switch`'s track and `Checkbox`'s box already read when off.
- **One focus convention across the Inputs primitives.** A future primitive follows `focus-visible`, not `focus`, unless it has a specific reason to react to a mouse click too (an ADR of its own would record that reason).
- **Clicking a text field or a select no longer shows a ring.** Only Tab reaching it does. This was already true for the radio, the switch and the checkbox; the change removes the one place a narrator could see two different behaviours depending on which control they clicked.
- **Changing this decision.** Write a new ADR that supersedes this one, and update `TextField.test.tsx`, `Select.test.tsx`, `Field.test.tsx` and `RadioGroup.test.tsx`'s className assertions with it.
