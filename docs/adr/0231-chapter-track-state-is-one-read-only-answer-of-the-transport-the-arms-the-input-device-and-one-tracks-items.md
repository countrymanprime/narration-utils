# 0231. chapter_track_state is one read-only answer of the transport, the arms, the input device and one track's items

- **Status:** Proposed
- **Date:** 2026-09-24

## Context and problem

Three PRDs asked for a live read of REAPER over the bridge: [Read Aloud Resume from the DAW](../prds/read-aloud-resume-from-daw.prd.md) Phase 4 (the edit cursor and the chapter track's items, to find where the narrator stopped), [Read Aloud Control Bar](../prds/read-aloud-control-bar.prd.md) Phase 6 (which tracks are armed and whether REAPER records), and [Teleprompter Manuscript Integration](../prds/teleprompter-manuscript-integration.prd.md) Phase 11 (the input REAPER records from). Each PRD's risk table asked for one command, not three, and the resume PRD specified its shape. [DAW Chapter-Track Auto-Sync](../prds/daw-chapter-track-auto-sync.prd.md) Phase 4 asked for REAPER's edit counter on the heartbeat. None of this has been checked in a real REAPER ([the calls and what is open](../research/reaper-api-for-planned-commands.md)).

## Decision drivers

- Three PRDs asked for a live read of REAPER over the bridge.
- Each PRD's risk table asked for one command, not three, and the resume PRD specified its shape.
- The auto-sync PRD asked for REAPER's edit counter on the heartbeat.
- None of this has been checked in a real REAPER.

## Considered options

1. One read-only `chapter_track_state` command
2. A separate command for each PRD

## Decision outcome

**Chosen option: one read-only `chapter_track_state` command**, because each PRD's risk table asked for one command, not three.

1. One read-only command, `chapter_track_state(run, trackGuid)`, in `integrations/reaper/narration_track_state.lua`. It answers `TRACK_STATE|run|guid|playState|editCursor|playPosition|rpp|unsaved|changeCount|thisArmed|armedCount|recInput|inputDevice`, then one `TRACK_ITEM|run|itemGuid|takeGuid|position|length|sourceOffset|playrate|sourceFile` per item on the track (the active take; at most 1000), then `TRACK_STATE_END|run|listed|total`. It opens no undo block and sets nothing.
2. A track is named by GUID. A GUID that does not resolve answers `TRACK_STALE|run|guid` and nothing else; no other track is ever answered in its place, and the Go client (`bridge.Actions.ChapterTrackState`) refuses an answer whose GUID is not the one it asked for. An empty GUID answers the transport and the arms with no items.
3. The play position is `GetPlayPosition` (what the narrator hears), the device read is `GetAudioDeviceInfo('IDENT_IN')` (empty when no device is open), and `recInput` is the track's `I_RECINPUT` as REAPER stores it; the host decodes none of them yet.
4. `PROJECT_STATUS` gains REAPER's edit counter as an optional fourth field; `daw.Reachability.ChangeCount()` answers it while the heartbeat is fresh.
5. The command is experimental ([ADR 0230](0230-reaper-commands-built-before-the-verification-pass-are-refused-by-the-host-while-the-experimental-switch-is-off.md)) until the verification pass (rows A1 to A3 and B1) confirms it.

### Consequences

- **Good:** The three consumers read one answer; later fields are appended, never reordered, and `wire.go` keeps the tail optional.
- **Neutral:** Proposed, for the owner: whether the what-you-hear position (`GetPlayPosition`) or the next-block position (`GetPlayPosition2`) is the right one is spike S4's question; whether a take still being recorded appears as an item before Stop is the verification pass's. Either answer changes only which value fills an existing field.
- **Neutral:** An answer carries the track's source file paths through `events.log`, like `prepare_compare`'s manifest already does; threat row 5j records it.

### Confirmation

The verification pass, rows A1 to A3 and B1, confirms the command before it leaves the experimental list ([ADR-0230](0230-reaper-commands-built-before-the-verification-pass-are-refused-by-the-host-while-the-experimental-switch-is-off.md)).
