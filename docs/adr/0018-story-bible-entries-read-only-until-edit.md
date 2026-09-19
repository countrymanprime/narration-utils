# 0018. Story Bible entries are read-only until Edit is pressed

**Status:** Accepted
**Date:** 2026-09-18

## Context

Story Bible entries opened fully editable, with a Save button always visible; locking an entry only disabled the fields, leaving a greyed-out Save. The user asked for entries to be read-only to start, with an explicit action to edit, and no Save button once an entry is locked. Server-side enforcement of locks is separate and unchanged ([ADR-0007](0007-story-bible-locked-entry-enforcement.md)).

## Decision

`GuideDetail.tsx` has an explicit edit mode.

- An entry opens read-only: every field, the category picker, alias and relationship editing, and merge are disabled.
- **Edit** (pencil) enters edit mode, which shows **Save** and **Cancel editing**. Save leaves edit mode on success; Cancel restores the entry's stored values.
- A **locked** entry shows neither Edit nor Save. Unlocking returns it to the normal read-only state.
- Selecting a different entry always starts read-only; a reload of the same entry (after Save, an alias change) keeps its mode.
- A brand-new draft is unchanged: it is created by choosing its category, not through the edit form.
- Read-only actions stay available regardless of mode: play pronunciation preview, rescan occurrences, lock/unlock, delete (unlocked), and Go to line.

## Consequences

- The UI-level `disabled` controls remain a convenience; the Python `edit()` guard is still what enforces locks (ADR-0007).
- Editing an entry is now two clicks (Edit, then Save); this is the intended trade for not editing by accident.
- Tests: `GuideDetail.test.tsx` covers read-only start, Edit/Cancel, and the locked case; `App.test.tsx` covers the icon-only Edit and Save buttons.
