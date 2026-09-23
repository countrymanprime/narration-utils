# 0122. The Review page asks REAPER only on a click and only while it answers, and a refusal is an answer

**Status:** Proposed
**Date:** 2026-09-23

## Context

`docs/prds/review-dashboard-and-findings-adoption.prd.md` Phase 7 puts Go to, Loop and Stop on the Review page, on top
of the bridge commands and `bridge.Navigator` of [ADR 0121](0121-going-to-and-looping-a-finding-is-by-guid-and-source-time-makes-no-undo-point-and-stop-restores-what-the-loop-changed.md).
The PRD asks for "honest availability states" (standalone launch, REAPER not running, running, stale finding) and
sets a boundary: no bridge command is sent without an explicit narrator action. Four things had to be settled:

- **How the page knows REAPER is there.** Bootstrap's `dawReachable` is read once, at start and on a project attach, so
  it goes stale when REAPER closes. Asking REAPER (`ping`) on a timer would send a command the narrator did not ask for.
- **What happens to a command sent while REAPER is gone.** The bridge is files: a command written to the session folder
  waits there. Sending it anyway would cost the narrator the 3 s answer timeout, and leave a command a REAPER could act on
  later.
- **What the page sends.** The finding's GUIDs and source times are in the host's store; the UI has them too.
- **How a refusal reaches the page.** Most refusals (a stale finding, recording, an older script, no item GUID) are
  ordinary outcomes the narrator must be told about in words that say what to do, not failures of the call.

## Decision

1. **Availability is read from the heartbeat, never asked of REAPER.** `FindingsReaperStatus()` answers `connected`,
   `not_running` (the `PROJECT_STATUS` heartbeat, `daw.Reachability`, is older than its 5 s window) or `standalone` (no
   bridge client: the app was not opened from REAPER's action), with a plain-language `message` when not connected and
   the finding a loop of this app's is on. It sends nothing, so the page polls it every 3 s while it is open.
2. **A request is refused before anything is written** when the finding has no item GUID, when Loop has no source time,
   when there is no bridge, or when the heartbeat is stale. Only then does the host send the command. Go to and Loop are
   disabled in the page for the same reasons, with the reason under them.
3. **The page sends only the finding's id.** The host reads the item and take GUIDs and source times from the project's
   findings store (`navigationTarget`, `apps/desktop/bindings_navigation.go`), so the UI cannot name an item the store
   does not hold.
4. **A refusal is an answer, not an error.** The bindings answer a union: `navigated`, `looping`, `stopped` or `refused`
   with a `reason` (`no_item`, `no_source_time`, `standalone`, `not_running`, `stale`, `recording`, `script_outdated`,
   `failed`) and a `message` in the narrator's words, which the page shows as an alert. An error is left for what is not
   about REAPER: no project open, a finding the store no longer has. `bridge` gains `ErrRecording`, and REAPER's "no
   usable time" answer maps to `ErrNoSourceTime`, so the host tells these apart by type rather than the page by text.
5. **The host remembers the finding it looped** until a Stop succeeds, so Stop loop is offered on every finding while
   a loop is held, and a refused Loop or Stop leaves it as it was.

## Consequences

- The buttons turn off within about 3 s of REAPER closing and back on when it returns, with no command sent to find out.
- A command can still be written in the instant between the last heartbeat and REAPER closing; the next launch opens a
  new session folder, so nothing acts on it later ([threat model](../architecture/threat-model.md) row 5f).
- The refusal messages exist once in Go; the browser mock repeats them, and `findingsMock.test.ts` compares them with the
  golden payloads so the two cannot drift.
- A project switch builds a new navigator and forgets the looped finding; REAPER's script still holds that loop until its
  own Stop or its exit handler (ADR 0121).
- `hostAPIVersion` went from 37 to 38 for the four bindings.
