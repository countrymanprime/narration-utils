# 0363. Backspace on an empty tag input removes the last chip

**Status:** Proposed
**Date:** 2026-09-27
**Supersedes:** [0055](0055-the-tag-input-is-a-wrapped-text-field-and-chips-that-report-and-never-edit-the-list.md) (its Backspace clause only)

## Context

[ADR 0055](0055-the-tag-input-is-a-wrapped-text-field-and-chips-that-report-and-never-edit-the-list.md) decided that Backspace on an empty `TagInput` box does *not* remove the last chip, reasoning that "an accidental keypress would delete data that is saved for the project, and the cross is a clear control." It reserved changing that for a new ADR.

`proofing-vocabulary-hints.prd.md` Phase 2 (V5, an open question the PRD marks answered by its stated recommendation per D22) asks for exactly that: "Backspace on empty removes the last pill," alongside the rest of a conventional tag-input keyboard (comma also commits, paste splits on commas and newlines, a 64-character length limit). Phase 2 also removes the box's separate typing row entirely — the input moves inline into the chip box itself, `TagInput`'s only remaining commit surface besides Enter and blur. With the Add button gone, Backspace-to-remove is the only inline way to correct the most recent entry without reaching for the mouse; every other tag-input convention this box now follows (comma commit, paste split) already treats the box as a full keyboard-driven control, and Backspace-does-nothing is the one place that convention breaks.

The vocabulary hints list is not append-only "saved data" in the sense 0055's caution was written for: it is a short, reviewed staging list the narrator builds up immediately before a Proofing run (typically under ten terms, per the Success Metrics' "many pills wrapping" case), each entry still individually removable by its own cross, and the whole list is re-editable at any time — nothing about accepting this change makes a term harder to recover than clicking its cross already does.

## Decision

**Backspace on an empty draft removes the most recently added tag** (the last entry in `tags`, matching the order chips render in) and returns focus to the typing box, the same focus behavior `onRemove` already has via its cross button. Backspace with a non-empty draft edits the draft text as normal (unchanged, native behavior) and never touches the tag list.

This applies to every `TagInput` consumer, since the primitive has one behavior, not a per-caller flag: today that is only the Proofing vocabulary hints box.

## Consequences

- A narrator who mistypes and immediately presses Backspace-Backspace can undo the last accepted term without moving to the mouse, matching the keyboard-first shape the rest of Phase 2 gives the box (comma commit, paste split, inline typing).
- The accidental-deletion risk 0055 flagged is real but narrow: only an empty draft triggers it (typing anything first requires clearing it back to empty), and the removed term is visibly gone from the box immediately, the same feedback a manual cross-click gives — there is no silent loss.
- `TagInput.test.tsx` and `TagInput.stories.tsx` gain the removal case; nothing about `onRemove`'s existing contract (it reports, never edits, the caller's own list) changes — Backspace calls the same `onRemove(tag)` the cross button does.
- **Changing this again:** write a new ADR in lane U's block (0360–0379) that supersedes this one.
