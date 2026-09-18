# Read-only-by-default Story Bible entry views

**Status: Planned — not implemented.**

## Problem

`GuideDetail.tsx` is always in "edit mode" — every field is a live `<input>`/`<textarea>` the moment an entry is selected, whether or not the user intended to change anything. This is broader than the locked-entry fix (ADR 0007), which only makes already-*locked* entries read-only; every other entry is fully editable by default, with no "are you sure you want to change this" friction and no way to just *look* at an entry without risking an accidental edit.

## Proposal

Make the general entry view read-only by default, with an explicit "Edit" affordance (a button, or a pencil icon) that switches the same panel into the current editable form. Concretely:

- `GuideDetail.tsx` gains a local `editing` state (default `false` for a persisted, unlocked entity; always `true` for `isNewDraft` per the existing new-entity flow, since there's nothing to "protect" there).
- The read-only rendering can reuse `EntitySummary.tsx` (`shared/ui/src/components/manuscript/EntitySummary.tsx`) — already documented as "a read-only mirror of the Story Bible's own detail panel" and already used for the Manuscript-page peek and (as of this session) the "Review entry" overlay. This would make `EntitySummary` the *primary* rendering for an unmodified `GuideDetail`, not just a secondary use elsewhere.
- Clicking "Edit" swaps in the current form (unchanged), and Save returns to the read-only view.

## Relationship to other recent work

- This is a superset of what locking already does (ADR 0007) — a locked entry would render read-only for a different reason (it can never be edited without unlocking) rather than the default "hasn't been put into edit mode yet" reason. The two states need distinct copy/affordances so a user can tell "read-only because locked" from "read-only because you haven't clicked Edit."
- Item 21's "Review entry" overlay already established the `EntitySummary`-in-an-overlay pattern this would build directly on, just for the *primary* pane instead of a slide-over.

## Open question

Should switching entries (clicking a different row) always reset back to read-only, or preserve "was mid-edit" state per entry? Given the new-draft work in this same session already established "switching away discards unsaved local state," resetting to read-only on switch is the consistent default — but worth confirming against real usage before building it.
