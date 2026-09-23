# Retakes on fixed lanes: what is known, and the REAPER checks still pending

[Reaper automation follow-through PRD](../prds/reaper-automation-follow-through.prd.md) Phase 25, [ADR 0147](../adr/0147-retakes-on-fixed-lanes-are-chosen-by-lane-play-state-and-the-app-never-converts-takes-and-lanes.md). This note records where each fact the retake-lane pick relies on came from, and the REAPER checks that have not been run. No REAPER run was approved for this phase, so nothing here was observed in a running REAPER **by this phase**; the facts marked "S7" were observed in REAPER 7.80 by [spike S7](reaper-spike-s7-fixed-lanes.md).

## What the phase relies on

| Fact | Source | Status |
| --- | --- | --- |
| Track `C_LANEPLAYS:N=1` makes lane N the only one playing, moves, copies and deletes nothing, and is one undo step inside `Undo_BeginBlock2`/`Undo_EndBlock2` | S7, sections B and D of [the report](../../integrations/reaper/spikes/results/fixed-lanes-report.txt) | Seen in REAPER (read back, not listened to) |
| `I_FREEMODE` reads 2 on a track in fixed-lane mode; an item's `I_FIXEDLANE` is its lane | S7 | Seen in REAPER |
| The saved `.rpp` has `FREEMODE 2`, `ITEMLANES <n>`, `LANESOLO <bitmask words>` (absent while every lane plays) on the track and `YPOS <top> <height> 2` on the item; the lane is `round(top * ITEMLANES)` | S7 fixtures `fixed-lanes.rpp` and `fixed-lanes-resaved.rpp`, now read by `apps/desktop/internal/tracks` (`lanes.go`, `reaper_fixed_lanes_test.go`) | Seen in REAPER-written files |
| Every retake of a line on a lane track, and a comp copy, carries the same `narration_utils_line_id` | S7 (conversions and comp areas) | Seen in REAPER; the pick names a retake by line id plus item GUID |
| A retake recorded into lanes by the narrator (one lane per pass) carries a line id | Not observed: line ids are written by "Link chapters" (`stamp_item_lines`) onto existing items, and whether a recording pass into lanes gets one is not known | **Unknown**: an unstamped retake is not listed |

## What was verified without REAPER

- The static reader: lane, lane count and playing lanes for every track of the two S7 fixtures (`go test ./internal/tracks`), and the lines the dialog lists from them (`go test ./internal/retakelanes`).
- The bridge command `pick_retake_lane` against the fake `reaper` (`integrations/reaper/tests/retake_lanes_test.lua`, 12 tests; the fake's lane play semantics are pinned to S7 in `fake_fidelity_test.lua`), and seven mutation checks in `mutations.json`: it sets exactly `C_LANEPLAYS:<lane>=1` on the retake's own track in one undo block, changes no item, take, lane mode, lane count or other track, and refuses a track not in fixed-lane mode, a stale GUID and an item that no longer carries the line.
- The host and UI: `internal/retakelanes` service tests, the wire contracts (`retake-lanes-list.json`, `retake-lanes-idle.json`, `retake-lanes-picked.json`), `RetakeLanesDialog.test.tsx` and four visual states.

## Pending: scripted checks in REAPER (need the owner's approval)

Run under the D3 rules in [`integrations/reaper/spikes/README.md`](../../integrations/reaper/spikes/README.md): an isolated `-cfgfile`, a copy of `apps/desktop/internal/tracks/testdata/reaper/fixed-lanes.rpp` in a temp folder, no audio device. Record the REAPER version and each result here.

1. **Pending.** Load the real bridge, send `pick_retake_lane|t1|line-000004|<track B's lane 1 item GUID>` and confirm: the event is `RETAKE_LANE_PICKED|t1|line-000004|<guid>|1`; track B reads `C_LANEPLAYS:0..2 = 0,1,0`; `Undo_CanUndo2` names "Narration Utils: play retake lane 2"; the project state change count rose by one.
2. **Pending.** Undo once and confirm track B's play state is back to lane 2 alone (`LANESOLO 4` after a save); redo restores lane 1.
3. **Pending.** Save after the pick and diff the `.rpp` against the copy: only track B's `LANESOLO` line differs (the "nothing else changes" half of the success signal), and the static reader then reports lane 1 playing.
4. **Pending.** Send the command for an item on a track without lanes (E5 of the fixture) and confirm `ERROR|t1|The track "E5 - ..." is not in fixed item lane mode ...` and an unchanged change count.

## Pending: the owner (needs audio hardware and listening)

5. **Pending, needs the owner.** Record three passes of one line into a fixed-lane track in the owner's own REAPER setup, with the narrator's usual "new recording adds lanes" option, then run **Link chapters**, save, and open **Tracks > Retakes on lanes…**: confirm the line lists one retake per pass on its own lane. This also answers S7's open question (one lane per pass, which lane plays after it) and whether a recorded retake carries a line id.
6. **Pending, needs the owner.** Press **Play this lane** on a retake and **listen**: only that lane is heard, across the whole track. Then press Undo in REAPER once and listen that the previous lane is heard again.
