# 0098. Take provenance is stored in take-level extension data, extending ADR 0026 to takes

- **Status:** Accepted
- **Date:** 2026-09-22
- **Related:** Extends [ADR-0026](0026-manuscript-line-identity-in-item-extension-data.md); ADR-0026 stays in force for item-level line identity

## Context and problem

`take-review-pickups-duplicates-take-intelligence.prd.md` phase 6 adds a confirmed, undoable REAPER action that attaches a narrator-approved candidate's source range as a new take on a target item. Every created take must be traceable back to the finding that produced it (finding id, source file, source range), or the "provenance" success metric in that PRD cannot be met. ADR 0026 already ruled out item notes and take names for identity of this kind — they belong to the narrator, and are used for their own purposes and for render filenames — and put manuscript line identity in namespaced *item* extension data (`P_EXT` via `GetSetMediaItemInfo_String`). Take provenance is a different piece of data (which finding created this specific take, not which manuscript line an item covers) and belongs at take granularity, since an item can carry many takes with different or no provenance each. Whether take-level `P_EXT` behaves the same way as item-level `P_EXT` was unverified before this ADR: the take-review PRD's Q5 named it a recommendation, not a decision, and required spike evidence (Open Question 5, `docs/prds/take-review-pickups-duplicates-take-intelligence.prd.md`).

The [phase 1 spike](../research/take-review-spike-p1-take-mechanics.md) ran `GetSetMediaItemTakeInfo_String(take, 'P_EXT:<key>', value, true)` against a real REAPER 7.80, in an isolated resource directory, on a from-scratch scratch project (never the owner's `Challenges_001.rpp` or any file in `Documents\REAPER Media`). It confirmed: the value is stored as an `<EXT` block inside the take's own chunk, distinct from the item's `<EXTI` block; it round-trips through `Undo_BeginBlock2`/`Undo_EndBlock2` as one undo unit together with the take-add itself, and survives an explicit undo/redo cycle; it survives a project save and reload when the take is re-resolved by GUID afterwards; and it does not collide with an item-level `narration_utils_line_id` key (ADR 0026) set on the same item — both keys read back independently before and after reload.

## Decision drivers

- Every created take must be traceable back to the finding that produced it (finding id, source file, source range), or the PRD's "provenance" success metric cannot be met.
- Item notes and take names belong to the narrator, and are used for their own purposes and for render filenames (ADR 0026).
- An item can carry many takes with different or no provenance each, so provenance belongs at take granularity.
- Take-level `P_EXT` needed spike evidence before it could be decided (the PRD's Open Question 5).

## Considered options

1. Namespaced take-level extension data (`P_EXT`)
2. Item-level extension data, as ADR 0026 uses for line identity
3. Take names or item notes
4. A sidecar file

## Decision outcome

**Chosen option: namespaced take-level extension data (`P_EXT`)**, because provenance belongs at take granularity, and the phase 1 spike proved that take-level `P_EXT` writes, reads back, undoes, survives save and reload, and does not collide with item-level keys.

`integrations/reaper/narration_ui_bridge.lua` (in a new take-review feature file, per the PRD's phase 6) stores take provenance as three namespaced take extension keys, written with `GetSetMediaItemTakeInfo_String(take, 'P_EXT:<key>', value, true)` at the moment a candidate is added as a new take, inside the same `Undo_BeginBlock2`/`Undo_EndBlock2` block as the take creation itself:

- `P_EXT:narration_utils_take_finding_id` - the id of the finding (`pickup` or `duplicate_read`) that produced this take.
- `P_EXT:narration_utils_take_source_file` - the candidate's source file.
- `P_EXT:narration_utils_take_source_range` - the matched source range within that file, `start|end` in seconds.

This extends ADR 0026's pattern (namespaced `narration_utils_*` keys, never item notes or take names, read back through the REAPER API rather than parsed from the `.rpp`) from item granularity to take granularity, for a different purpose (which finding created a take, not which manuscript line an item covers). ADR 0026 is not superseded: item-level line identity keeps its own keys and its own rules. A future command that needs to read provenance back does so through the bridge (a `read_take_provenance`-style command, or the create-take command's own confirmation event), never by parsing the `.rpp` directly, following ADR 0026's reasoning: reading requires a running REAPER with the bridge active, and a static `.rpp` read is deferred the same way ADR 0026 deferred it for line identity.

### Consequences

- **Neutral:** Take provenance survives moves, splits, and copies to the extent an item's own extension data does (ADR 0026's claim, itself proven for item-level keys by the phase 0 (S0) spike); this ADR's own spike proved the take-level mechanism (write, read, undo/redo, save/reload, no collision with item-level keys) but **did not** re-test what a split or a take-specific duplicate does to a take's own `<EXT` block. That is **open** and must be confirmed by phase 6's manual REAPER checklist (`docs/prds/take-review-pickups-duplicates-take-intelligence.prd.md` phase 6 success signal) before this is trusted across those edits; if the checklist finds different behaviour, this ADR is superseded, not silently reinterpreted.
- **Bad:** Reading provenance back requires a running REAPER with the bridge active, same limitation ADR 0026 already accepted for line identity.
- **Neutral:** The commands that write these keys are Lua and are covered by the harness (ADR 0066) for the fake-side behaviour; REAPER's own `P_EXT` semantics rest on this spike and the phase 6 manual checklist, not on the harness fake.
- **Neutral:** Moving take provenance to a sidecar, or to take names or item notes, would need a new ADR superseding this one, for the same reasons ADR 0026 gives for line identity: a sidecar drifts when takes move, split, or are duplicated, and names/notes belong to the narrator.

### Confirmation

The phase 1 spike proved the take-level mechanism in a real REAPER 7.80. The harness (ADR 0066) covers the fake-side behaviour of the commands that write these keys; REAPER's own `P_EXT` semantics, including what a split or a take-specific duplicate does, rest on the phase 6 manual REAPER checklist.

## Pros and cons of the options

### Item-level extension data

- Bad, because an item can carry many takes with different or no provenance each.

### Take names or item notes

- Bad, because they belong to the narrator, and are used for their own purposes and for render filenames.

### A sidecar file

- Bad, because a sidecar drifts when takes move, split, or are duplicated.
