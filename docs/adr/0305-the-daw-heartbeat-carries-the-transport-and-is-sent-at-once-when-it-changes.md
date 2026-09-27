# 0305. The DAW heartbeat carries the transport and is sent at once when it changes

**Status:** Proposed
**Date:** 2026-09-27
**Supersedes:** none. It extends the `PROJECT_STATUS` heartbeat of [ADR 0092](0092-reaper-executable-discovery-heartbeat-mechanism-and-script-plus-project-launch-are-resolved.md) and the `Heartbeat` role of [ADR 0300](0300-every-daw-is-reached-through-one-port-of-small-role-interfaces-and-callers-ask-a-resolver-what-it-supports.md), for Phase 9 of the [DAW port PRD](../prds/daw-port-and-capabilities.prd.md).

## Context

[Input commands and pedals](../prds/input-commands-and-pedals.prd.md) Phase 10 must keep the booth silent while REAPER records. Today the only way the host learns that is `ReadAloudReaperState` ([ADR 0249](0249-read-aloud-asks-reaper-once-whether-the-chapters-linked-track-is-the-one-track-armed.md)): a `chapter_track_state` request the UI makes on a click. That request is Experimental and switched off by default, it waits for an answer, and it goes stale the moment the narrator presses Record in REAPER.

The DAW port PRD's Phase 9 asks the `Heartbeat` role to report play and record state, so the answer is something the host already knows without asking. But the heartbeat REAPER sends (`PROJECT_STATUS`, every 1.5 s) carries only the project path, its unsaved flag and the edit counter. The PRD's "not building" list rules out new REAPER commands and Lua changes for the port refactor. This phase can't be done without changing what the heartbeat sends, so that rule is set aside here, for this one change and no new command.

## Decision

- `narration_ui_bridge.lua` appends two optional fields to `PROJECT_STATUS`: `playState` (`GetPlayState()`'s bit field: 1 playing, 2 paused, 4 recording) and `playPosition` (`GetPlayPosition()`, seconds). `wire.go` lists them as optional, so a heartbeat from an older script still passes and simply reports no transport.
- The script also sends a heartbeat **at once** when `playState` changes, without waiting out the 1.5 s interval. Otherwise a record start could be missed for up to 1.5 s, which is too long for a quiet booth. A moving play position alone does not break the throttle, so a playing project does not flood `events.log`.
- `daw.Reachability` parses them into a `Transport{Playing, Recording, Position}`, and the `Heartbeat` role gains `Transport() (Transport, ok bool)`. `ok` is false when the heartbeat is stale or did not carry the transport. A REAPER that stopped answering is never reported as still recording.
- `Recording` is the record bit, so a **paused recording counts as recording**, because its take is still open. `Playing` is the play bit alone, so it is also true while recording.
- The host emits `daw_transport_changed` (`{playing, recording, position?}`) from the same `transcriptLoop` tick that already emits `daw_capabilities_changed`, deduplicated on the marshalled payload. The transport is read only when the resolver says the `heartbeat` capability is available, so a narrator who turned it off, a standalone launch and an Audacity launch all report neither playing nor recording. `position` is sent only while playing or recording.
- The event is **pushed only**. There is no binding to read it, and no `hostAPIVersion` bump, because a new event is additive (`docs/architecture/wire-contracts.md`). The first tick after launch pushes the current value.

## Consequences

- A consumer can know REAPER is recording within one host tick (150 ms) of REAPER's next defer cycle, with no Experimental command turned on and no request.
- `position` moves on only with each heartbeat, so it is about 1.5 s coarse while playing. A consumer that needs the exact position still asks with `PlayPosition` (the `punch` role).
- A subscriber that joins after launch, such as a page mounted later or a webview reload, hears nothing until the next change. If Phase 10 needs the current value on mount, it adds a `DawTransport()` binding (a `hostAPIVersion` bump) that reads the same payload.
- `events.log` gains one line per play, record or stop. The session folder and its protection are unchanged (threat model row 5).
- Overriding this, for example to poll a command for the transport instead, needs a new ADR that supersedes this one.
