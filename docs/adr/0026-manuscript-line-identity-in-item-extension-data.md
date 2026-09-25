# 0026. Manuscript line identity is stored in REAPER item extension data and read back through the bridge

- **Status:** Accepted
- **Date:** 2026-09-19

## Context and problem

Timeline-anchored live flags, pickup lists, and per-chapter render all need a durable link between a manuscript line and the REAPER item that records it. Two obvious homes were considered: a sidecar file beside the project, and REAPER's own per-item extension data (`P_EXT`). A sidecar drifts whenever the narrator moves, splits, or copies items in REAPER, because nothing keeps it in sync. Extension data travels with the item.

How item `P_EXT` is serialised in a saved `.rpp` is unverified (no project on the development machine uses it), so a design that has Go parse it out of the project file would rest on an assumption. The narrator also owns item notes and take names, which are used for their own purposes and for render filenames.

## Decision drivers

- A durable link between a manuscript line and the REAPER item that records it.
- The link must survive the narrator moving, splitting, or copying items in REAPER.
- How `P_EXT` is serialised in a saved `.rpp` is unverified.
- The narrator owns item notes and take names, for their own purposes and for render filenames.

## Considered options

1. REAPER item extension data (`P_EXT`), read back through the bridge
2. A sidecar file beside the project
3. Go parses `P_EXT` out of the saved `.rpp`
4. Item notes or take names

## Decision outcome

**Chosen option: REAPER item extension data (`P_EXT`), read back through the bridge**, because extension data travels with the item, while a sidecar drifts and parsing the `.rpp` would rest on an unverified assumption.

`shared/reaper/narration_ui_bridge.lua` stores line identity as two namespaced item extension keys, `P_EXT:narration_utils_line_id` and `P_EXT:narration_utils_line_text`, keyed by item GUID. It never writes item notes or take names. The host reads identity back with the `read_line_ids` bridge command, which goes through the REAPER API, rather than by parsing the `.rpp`. Stale GUIDs are reported and never resolved to a neighbouring item; an existing different ID is a conflict unless the narrator explicitly overwrites. Details and the manual verification checklist are in [manuscript-line-identity.md](../architecture/manuscript-line-identity.md).

### Consequences

- **Good:** Line identity survives moves, splits, and copies, and needs no sidecar to reconcile.
- **Bad:** Reading it requires a running REAPER with the bridge active. A static read from the `.rpp` (which would work in a standalone launch) is deferred until the serialisation is verified against a REAPER-saved project.
- **Neutral:** Surfacing line text in item notes or take names, for render wildcards, is a separate opt-in step and would need its own decision.
- **Bad:** The commands are Lua and have no automated tests; correctness rests on the manual checklist until a Lua harness exists.
- **Neutral:** Moving identity to a sidecar, or writing it to notes or names, would need a new ADR that supersedes this one.

### Confirmation

The manual verification checklist in [manuscript-line-identity.md](../architecture/manuscript-line-identity.md), run in REAPER; the commands have no automated tests.

## Pros and cons of the options

### A sidecar file beside the project

- Bad, because it drifts whenever the narrator moves, splits, or copies items in REAPER, since nothing keeps it in sync.

### Go parses `P_EXT` out of the saved `.rpp`

- Good, because a static read would work in a standalone launch.
- Bad, because how `P_EXT` is serialised is unverified, so the design would rest on an assumption.

### Item notes or take names

- Bad, because the narrator owns them for their own purposes and for render filenames.
