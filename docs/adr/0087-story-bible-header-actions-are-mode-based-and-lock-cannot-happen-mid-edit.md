# 0087. Story Bible header actions are mode-based, and Lock cannot happen mid-edit

**Status:** Accepted
**Date:** 2026-09-21
**Supersedes:** the "read-only actions stay available regardless of mode" clause of [ADR 0018](0018-story-bible-entries-read-only-until-edit.md)

## Context

[ADR 0018](0018-story-bible-entries-read-only-until-edit.md) put Story Bible entries behind an explicit Edit action, but kept Lock/Unlock and Delete available in every mode. That mixed a safe toggle (Lock) and a destructive one (Delete) into the same row as Save, next to it in every mode: Delete sits beside Save where a mis-click is one pixel away, and Lock can be pressed while an edit is in progress. Pressing Lock mid-edit reloads the entity, and the effect that syncs the draft from the entity resets `editing` to its default alongside it — so Lock then Unlock silently discards the in-progress edit and returns to edit mode, contrary to the ADR's own "unlocking returns to read-only" intent (`story-bible-entries-and-actions.prd.md`, Evidence). The owner asked for entries to be locked from the read view only (B3, B5, B6 of that PRD; `implementation-plan.md` D22 adopts the PRD's recommendation).

## Decision

`GuideDetail.tsx`'s header actions are keyed to mode, not offered "regardless":

- **Read view** (not editing, not locked, not a new draft): Lock and Edit. No Delete.
- **Edit mode**: Save, Cancel, and a red Delete (`IconButton variant="danger"`), separated from Save/Cancel by a divider on the far side of the header so it cannot be mis-clicked beside them. No Lock — it is simply not rendered, so it cannot be pressed while editing, and the mid-edit reload hazard cannot occur.
- **Locked**: Unlock only, as before (ADR 0018, ADR 0007 still enforces the guard server-side).
- **New draft**: Discard only, unchanged; a new draft is created unlocked and can only be locked once it has been saved and is viewed read-only.
- Play preview, rescan and Go to line stay available regardless of mode; only Lock and Delete moved.

## Consequences

- Deleting an entry now costs an extra click (Edit, then Delete) where it previously took one from the read view; this is the intended trade against the mis-click risk (B5).
- Locking an entry mid-edit is no longer reachable through the UI at all, so the "Lock then Unlock snaps back into edit mode" hazard cannot occur; `edit`'s own lock guard (ADR 0007) is unaffected.
- Tests updated: `GuideDetail.test.tsx`, `GuideDetail.pending.test.tsx`, `App.test.tsx` now enter edit mode before finding Delete; drivers `delete-confirm` and `confirm-dialog` (`app.drivers.ts`) click Edit first; a new `GuideDetail.actions.test.tsx` pins the per-mode button set and the mid-edit lock hazard directly.
