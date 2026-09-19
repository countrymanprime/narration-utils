# 0026. Manuscript line identity is stored in REAPER item extension data and read back through the bridge

**Status:** Accepted
**Date:** 2026-09-19

## Context

Timeline-anchored live flags, pickup lists, and per-chapter render all need a durable link between a manuscript line and the REAPER item that records it. Two obvious homes were considered: a sidecar file beside the project, and REAPER's own per-item extension data (`P_EXT`). A sidecar drifts whenever the narrator moves, splits, or copies items in REAPER, because nothing keeps it in sync. Extension data travels with the item.

How item `P_EXT` is serialised in a saved `.rpp` is unverified (no project on the development machine uses it), so a design that has Go parse it out of the project file would rest on an assumption. The narrator also owns item notes and take names, which are used for their own purposes and for render filenames.

## Decision

`shared/reaper/narration_ui_bridge.lua` stores line identity as two namespaced item extension keys, `P_EXT:narration_utils_line_id` and `P_EXT:narration_utils_line_text`, keyed by item GUID. It never writes item notes or take names. The host reads identity back with the `read_line_ids` bridge command, which goes through the REAPER API, rather than by parsing the `.rpp`. Stale GUIDs are reported and never resolved to a neighbouring item; an existing different ID is a conflict unless the narrator explicitly overwrites. Details and the manual verification checklist are in [manuscript-line-identity.md](../architecture/manuscript-line-identity.md).

## Consequences

- Line identity survives moves, splits, and copies, and needs no sidecar to reconcile.
- Reading it requires a running REAPER with the bridge active. A static read from the `.rpp` (which would work in a standalone launch) is deferred until the serialisation is verified against a REAPER-saved project.
- Surfacing line text in item notes or take names, for render wildcards, is a separate opt-in step and would need its own decision.
- The commands are Lua and have no automated tests; correctness rests on the manual checklist until a Lua harness exists.
- Moving identity to a sidecar, or writing it to notes or names, would need a new ADR that supersedes this one.
