# 0087. Story Bible header actions are mode-based, and Lock cannot happen mid-edit

- **Status:** Accepted
- **Date:** 2026-09-21
- **Deciders:** the owner
- **Related:** Supersedes the "read-only actions stay available regardless of mode" clause of [ADR-0018](0018-story-bible-entries-read-only-until-edit.md)

## Context and problem

[ADR 0018](0018-story-bible-entries-read-only-until-edit.md) put Story Bible entries behind an explicit Edit action, but kept Lock/Unlock and Delete available in every mode. That mixed a safe toggle (Lock) and a destructive one (Delete) into the same row as Save, next to it in every mode: Delete sits beside Save where a mis-click is one pixel away, and Lock can be pressed while an edit is in progress. Pressing Lock mid-edit reloads the entity, and the effect that syncs the draft from the entity resets `editing` to its default alongside it — so Lock then Unlock silently discards the in-progress edit and returns to edit mode, contrary to the ADR's own "unlocking returns to read-only" intent (`story-bible-entries-and-actions.prd.md`, Evidence). The owner asked for entries to be locked from the read view only (B3, B5, B6 of that PRD; `implementation-plan.md` D22 adopts the PRD's recommendation).

## Decision drivers

- Delete sat beside Save in every mode, where a mis-click is one pixel away.
- Lock could be pressed while an edit was in progress, and Lock then Unlock silently discarded the in-progress edit, contrary to ADR-0018's "unlocking returns to read-only" intent.
- The owner asked for entries to be locked from the read view only (B3, B5, B6 of the PRD; D22 adopts the PRD's recommendation).

## Considered options

1. Header actions keyed to mode: Lock and Edit in the read view, Delete only in edit mode
2. Keep the status quo (ADR-0018): Lock/Unlock and Delete available in every mode

## Decision outcome

**Chosen option: header actions keyed to mode: Lock and Edit in the read view, Delete only in edit mode**, because Delete beside Save was one mis-click away, and Lock pressed mid-edit silently discarded the in-progress edit.

`GuideDetail.tsx`'s header actions are keyed to mode, not offered "regardless":

- **Read view** (not editing, not locked, not a new draft): Lock and Edit. No Delete.
- **Edit mode**: Save, Cancel, and a red Delete (`IconButton variant="danger"`), separated from Save/Cancel by a divider on the far side of the header so it cannot be mis-clicked beside them. No Lock — it is simply not rendered, so it cannot be pressed while editing, and the mid-edit reload hazard cannot occur.
- **Locked**: Unlock only, as before (ADR 0018, ADR 0007 still enforces the guard server-side).
- **New draft**: Discard only, unchanged; a new draft is created unlocked and can only be locked once it has been saved and is viewed read-only.
- Play preview, rescan and Go to line stay available regardless of mode; only Lock and Delete moved.

### Consequences

- **Neutral:** Deleting an entry now costs an extra click (Edit, then Delete) where it previously took one from the read view; this is the intended trade against the mis-click risk (B5).
- **Good:** Locking an entry mid-edit is no longer reachable through the UI at all, so the "Lock then Unlock snaps back into edit mode" hazard cannot occur; `edit`'s own lock guard (ADR 0007) is unaffected.
- **Neutral:** Tests updated: `GuideDetail.test.tsx`, `GuideDetail.pending.test.tsx`, `App.test.tsx` now enter edit mode before finding Delete; drivers `delete-confirm` and `confirm-dialog` (`app.drivers.ts`) click Edit first; a new `GuideDetail.actions.test.tsx` pins the per-mode button set and the mid-edit lock hazard directly.

### Confirmation

`GuideDetail.actions.test.tsx` pins the per-mode button set and the mid-edit lock hazard directly; `GuideDetail.test.tsx`, `GuideDetail.pending.test.tsx`, `App.test.tsx` and the `delete-confirm` and `confirm-dialog` drivers enter edit mode before finding Delete.

## Pros and cons of the options

### Keep the status quo: Lock and Delete in every mode

- Bad, because Delete sits beside Save where a mis-click is one pixel away.
- Bad, because pressing Lock mid-edit reloads the entity, so Lock then Unlock silently discards the in-progress edit and returns to edit mode.
