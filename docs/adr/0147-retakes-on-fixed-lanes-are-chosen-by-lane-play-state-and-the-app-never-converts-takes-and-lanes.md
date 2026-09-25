# 0147. Retakes on fixed lanes are chosen by lane play state, and the app never converts takes and lanes

- **Status:** Proposed
- **Date:** 2026-09-23

## Context and problem

Phase 25 of the [REAPER automation follow-through PRD](../prds/reaper-automation-follow-through.prd.md) is "retakes as fixed lanes: choose the good lane per line", scoped as "narrator-approved, undoable, never automatic" and gated on spike S7 and on the take-review decisions. Take review already decided how a candidate reading reaches the timeline: as a new take on the target item (`AddTakeToMediaItem`), provenance in take `P_EXT` ([ADR 0098](0098-take-provenance-in-take-extension-data-extends-adr-0026.md)), and the app never sets the active take.

[Spike S7](../research/reaper-spike-s7-fixed-lanes.md) ran the fixed-lane API in REAPER 7.80 and found:

- Choosing a lane is one value: `C_LANEPLAYS:N=1` on the track makes lane N the only one playing, in one undo step, and moves, copies or deletes nothing.
- Every other lane operation changes more than it seems to. Converting takes to lanes plays lane 0, not the take that was active. Turning lanes off through `I_FREEMODE=0` plays every retake at once. Turning them on through `I_FREEMODE=2` alone leaves a track that reopens with an extra empty lane. Converting and comping copy the item's line id (`narration_utils_line_id`, [ADR 0026](0026-manuscript-line-identity-in-item-extension-data.md)) onto new items with new GUIDs.
- A lane track can hold takes too, so takes and lanes are two independent ways retakes reach the timeline.
- The saved `.rpp` has no lane number on an item, only its `YPOS` fraction of the track, plus the track's `ITEMLANES` and `LANESOLO` bitmask. The static reader (`apps/desktop/internal/tracks`) reads none of these.

## Decision drivers

- The PRD's scope: narrator-approved, undoable, never automatic.
- Take review's decisions: a candidate reading reaches the timeline as a new take, and the app never sets the active take (ADR 0098).
- Spike S7: choosing a lane is one value in one undo step, and every other lane operation changes more than it seems to.
- The static reader reads none of the lane data in the saved `.rpp`.

## Considered options

1. Set the chosen lane's play state (`C_LANEPLAYS:<lane>=1`) and nothing else
2. Converting takes to lanes
3. Turning lanes off or on through `I_FREEMODE`
4. Comping
5. Setting the item-level `C_LANEPLAYS`

## Decision outcome

**Chosen option: set the chosen lane's play state (`C_LANEPLAYS:<lane>=1`) and nothing else**, because spike S7 found that choosing a lane is one value, in one undo step, that moves, copies or deletes nothing, while every other lane operation changes more than it seems to.

- **Picking a retake on a lane track sets that lane's play state, and nothing else.** The phase 25 command sets `C_LANEPLAYS:<lane>=1` on one track in one undo block, after the narrator has chosen it. It does not move, delete, copy, mute or re-take any item, and one undo restores the previous play state.
- **The app never changes a track's lane mode or its layout.** It does not set `I_FREEMODE` or `I_NUMFIXEDLANES`, does not run the convert, explode, implode or comp actions, and does not set the item-level `C_LANEPLAYS`, which the docs call read-only but which REAPER 7.80 accepted. A track that is not already in fixed-lane mode has no lanes to choose, and the app says so instead of converting it. Takes stay the take-review mechanism, unchanged.
- **A retake is named by line id plus item GUID, and "the retake that plays" is the item whose lane plays.** On a lane track several items share a line id by design, so nothing may assume a line id names one item there.
- **The static reader learns lanes before any UI lists retakes by lane.** It reads each item's lane from `YPOS` and `ITEMLANES`, and whether that lane plays from `LANESOLO`, tested against the S7 fixture (`testdata/reaper/fixed-lanes.rpp`) whose lane-blind reading is pinned today.

### Consequences

- **Good:** Phase 25 is one small, undoable command plus a parser change, and the narrator's own REAPER workflow (recording into lanes, comping, converting) stays theirs. The PRD's "never automatic" holds because the app only changes what plays, and only when asked.
- **Neutral:** A narrator who keeps retakes as takes gets take review; one who records into lanes gets lane choice. The app does not move retakes from one to the other.
- **Bad:** Recording into lanes was not run in S7, because it needs audio hardware. Whether a recording pass reliably makes one lane per retake, and which lane plays after it, is still open and must be checked with the owner before phase 25 relies on it.
- **Neutral:** Comp lanes are left alone. Picking the comp lane is allowed (it is a lane like any other), but the app never creates comp areas. A future "build a comp from the chosen retakes" would need its own ADR, since comp areas copy items and line ids.
- **Neutral:** Changing a track's lane mode, or converting between takes and lanes, from the app would need a new ADR that supersedes this one.

### Confirmation

The static reader's lane reading is tested against the S7 fixture (`testdata/reaper/fixed-lanes.rpp`).

## Pros and cons of the options

### Set the chosen lane's play state (`C_LANEPLAYS:<lane>=1`) and nothing else

- Good, because it is one value, in one undo step, and moves, copies or deletes nothing.

### Converting takes to lanes

- Bad, because it plays lane 0, not the take that was active.
- Bad, because it copies the item's line id onto new items with new GUIDs.

### Turning lanes off or on through `I_FREEMODE`

- Bad, because `I_FREEMODE=0` plays every retake at once, and `I_FREEMODE=2` alone leaves a track that reopens with an extra empty lane.

### Comping

- Bad, because it copies the item's line id onto new items with new GUIDs.

### Setting the item-level `C_LANEPLAYS`

- Bad, because the docs call it read-only, though REAPER 7.80 accepted it.
