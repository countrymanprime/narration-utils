# 0123. The approved marker is one take marker for an accepted finding, named like Transcript Compare's, in one undo point

**Status:** Proposed
**Date:** 2026-09-23

## Context

`docs/prds/review-dashboard-and-findings-adoption.prd.md` Phase 8 (the owner's answer to Q8) puts a per-finding "add
approved marker" action in milestone 1, to meet the adapter criterion in `docs/architecture/daw-integration.md` ("a
REAPER adapter can navigate, loop, and add an approved marker from a valid finding"). The batch **Export markers**
action stays on the Proofing page. Unlike Go to and Loop ([ADR 0121](0121-going-to-and-looping-a-finding-is-by-guid-and-source-time-makes-no-undo-point-and-stop-restores-what-the-loop-changed.md),
[ADR 0122](0122-the-review-page-asks-reaper-only-on-a-click-and-only-while-it-answers-and-a-refusal-is-an-answer.md)),
this action changes the project, so several things had to be settled:

- **Which findings may get one.** The findings contract says a finding suggests and the narrator confirms.
- **What kind of marker, and where.** A project marker sits at a project time, which goes wrong when the item moves.
  Transcript Compare's export adds take markers at a source time, named `KIND: 'script' as 'heard'`.
- **How it avoids doubling a marker.** The export already skips a marker of the same kind within 0.15 s on the take.
  Without the same rule, a finding marked from the Review page and then exported from Proofing would be marked twice.
- **How it is undone.** A project change from the bridge must be one undo point (`daw-integration.md`).
- **The "generic execute suggested action" path the PRD sketches for TR-5.** TR-5's take creation had already landed
  with its own executor (`apps/desktop/internal/takereview/createtake.go`) before this phase.

## Decision

1. **Only an accepted finding gets a marker, and only after a confirm.** `FindingsAddMarker(id)` refuses a finding
   whose review status is not `accepted` (`not_accepted`). The Review page keeps **Add marker in REAPER** off until the
   narrator accepts, and asks in a confirm dialog before sending. Like Go to, the page sends only the id; the host reads
   the GUIDs and source time from the store, and refuses before writing anything when the finding has no item GUID or
   source time, or REAPER is not listening (ADR 0122).
2. **It is a take marker at the finding's source time, on its take.** The Lua command `add_finding_marker` finds the
   item and take by GUID and refuses a stale item, take or spot with `FINDING_STALE`, never falling back to a
   neighbouring item (ADR 0121). It refuses while REAPER is recording. The marker follows the item when the item moves.
3. **It is named and coloured like the marker the export adds for the same row.** The prefix is the finding's evidence
   `kind`, or its category for an analyzer that records none. Then come the script and recorded text, eight words at
   most each (`approvedMarker`, `apps/desktop/bindings_marker.go`). The colour is the Transcript Compare colour setting
   for that kind.
4. **The duplicate rule is shared.** `existing_take_marker` (the same prefix within 0.15 s) moved from
   `narration_compare.lua` into `narration_bridge_core.lua`. The export and `add_finding_marker` both call it. A marker
   already there is answered `existing` and nothing changes, so sending the command twice adds one marker.
5. **One undo block.** The add is wrapped in `Undo_BeginBlock2`/`Undo_EndBlock2` ("Narration Utils: add approved
   marker"). A skipped marker makes no undo point.
6. **It goes through the navigator, not a new executor.** `bridge.Navigator.AddMarker` is one more command with one
   awaited answer (`FINDING_MARKER|run|added or existing|take_guid|source_time|name`) on the same plumbing as Go to
   and Loop. This phase does not move TR-5's `CreateTake` onto it.

## Consequences

- `daw-integration.md`'s acceptance criterion is met in code. Whether REAPER's own undo takes the marker away in one
  step, and whether the marker shows where expected, still needs a check in REAPER (the owner's checklist in
  `docs/architecture/reaper-navigation.md`, steps 10 and 11).
- Accepting a finding does not add a marker by itself; the marker is a second, confirmed click.
- The Proofing page's rows still say `pending` for a row marked from the Review page. Its export rechecks each take
  before adding and counts that row as skipped.
- The mock repeats the host's marker name and words, and `findingsMock.test.ts` checks them against the golden payloads.
- `hostAPIVersion` went from 38 to 39.
