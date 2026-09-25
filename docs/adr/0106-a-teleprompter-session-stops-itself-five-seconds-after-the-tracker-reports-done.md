# 0106. A teleprompter session stops itself five seconds after the tracker reports done

- **Status:** Proposed
- **Date:** 2026-09-23
- **Deciders:** the owner

## Context and problem

Reaching the end of a chapter sets the tracker's status to `done` (`script_tracker.py`, `_status`), the reader shows
"Done", and until now the session kept listening until the narrator pressed Stop.
`docs/prds/teleprompter-engines-and-input-devices.prd.md` Phase 9 asks for the session to end itself. The PRD's Open
Question "Auto-stop trigger and delay" offered three places for the trigger: (a) the UI calls Stop when it sees `done`,
(b) the Go service starts a timer on a `done` position and calls `Stop()` when it expires unless a later position
clears it, (c) the sidecar exits itself. The owner answered (b) on 2026-09-23, with the delay above the tracker's
1.5 s `WAIT_SECONDS`, no user setting at first, and a message in the UI. The delay value itself was left open.

Two facts shape the value. A narrator who reaches the last word and then re-reads the last sentence must not be cut
off: the tracker reports that re-read as a later position with a status other than `done` (a `restart` jump moves the
display back), but only after the recognizer has heard enough of it, which takes the live engine's lag on top of the
tracker's own 1.5 s. And the tracker only emits a position when something changes, so there is no steady stream of
`done` positions to count.

## Decision drivers

- The session should end itself at the end of the chapter (PRD Phase 9).
- The owner's answer: the Go service times it, with a delay above the tracker's 1.5 s `WAIT_SECONDS`, no user setting at first, and a message in the UI.
- A narrator who reaches the last word and then re-reads the last sentence must not be cut off, and the tracker reports that re-read only after the live engine's lag plus its own 1.5 s.
- The tracker emits a position only when something changes, so there is no steady stream of `done` positions to count.

## Considered options

1. The Go service arms a 5-second timer on the first `done` position
2. The UI calls Stop when it sees `done`
3. The sidecar exits itself

## Decision outcome

**Chosen option: the Go service arms a 5-second timer on the first `done` position**, because the owner answered option (b), the Go service's timer, on 2026-09-23.

1. `apps/desktop/internal/teleprompter` (`autostop.go`) reads `status` from each `position` event it relays. The
   first `done` position of a running session (a child is running and it is not already stopping) arms one timer of
   `autoStopDelay` = **5 seconds**. Later `done` positions do not restart it: the delay counts from the first one.
   Any later position whose status is not `done` cancels it.
2. When it fires, the service stops the session through the same path as Stop (the stop file, then the grace kill,
   ADR 0022). Stop, a crash, or the session ending any other way cancels a pending timer, and a stale callback (a
   timer that fired as it was cancelled, or one from an earlier session) does nothing.
3. The state `message` carries what the narrator needs: "Reached the end of the chapter. Stopping in 5 seconds unless
   you keep reading." while armed, "Listening…" again if it is cancelled, and "Stopped at the end of the chapter." as
   the final message. The `teleprompter:state` payload gains no field; the UI shows the host's message for the
   `stopped` phase and says "Done - stopping in a few seconds unless you read on" while the tracker is done.
4. No setting. A sidecar that exits non-zero is still an `error`, whether or not a timer was pending. The session's
   script and last position stay in the snapshot after the stop, so what the session produced (flags, in a later
   phase) can still be read from it.

### Consequences

- **Good:** The auto-stop works whichever view is open, or none, because it lives in the host.
- **Bad:** A narrator who pauses at the end for more than 5 seconds and then re-reads is stopped first; they press Start
  reading again. If real reads show 5 seconds is too short or too long, the constant changes (and this ADR is
  amended); a setting is added only if one value cannot fit everyone.
- **Neutral:** The timer is injectable (`Service.afterFunc`), so the tests drive it with a fake clock and never sleep through the
  delay.
- **Neutral:** The browser mock mirrors the host (same delay and messages), so a mock session that replays to the end stops itself
  too; `?mockTeleprompter=ended` boots one that already has, for the visual suite.

### Confirmation

The timer is injectable (`Service.afterFunc`), so the tests drive it with a fake clock and never sleep through the delay; the browser mock mirrors the host, and `?mockTeleprompter=ended` boots an ended session for the visual suite.
