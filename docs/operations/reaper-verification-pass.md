# The REAPER verification pass

**Status: planned; not run yet.** Stack S37 of the [implementation plan](../prds/implementation-plan.md) (section 7) runs it with the owner. Until it has run, every command below stays behind the **Experimental REAPER actions** Settings switch (`DAW.experimental_reaper_actions`, off by default; owner decision D38): the host refuses to send them while the switch is off.

The harness ([ADR 0066](../adr/0066-the-lua-bridge-is-tested-by-a-harness-under-lua-5-4-and-reaper-api-behaviour-is-checked-in-reaper.md), `integrations/reaper/tests`) proves each command's logic, refusals and events against a fake REAPER. It cannot prove what REAPER itself does with a call. This pass checks that, command by command, in a real REAPER. The calls and what the reference leaves open are in [the ReaScript calls behind the planned commands](../research/reaper-api-for-planned-commands.md).

## Rules (owner decision D3)

- REAPER runs isolated: `integrations/reaper/spikes/run-reaper.ps1` starts it with `-cfgfile <temp>\reaper.ini`, so the owner's settings, scripts and projects are never read or written ([the spike rules](../../integrations/reaper/spikes/README.md)).
- Only a **copy** of a project is opened, in a temp folder, with its media copied beside it or replaced by synthetic tones (`make_media.py`). Never open, save into or delete anything under `C:\Users\Count\Documents\REAPER Media\Projects\Challenges\`. Record the original `.rpp`'s SHA-256 before and after, as spike S6 did.
- Part A runs unattended with the audio device closed (`reaper.Audio_Quit()`). Part B records, so it needs the owner present and their approval for the one test recording on a copy (D28), with a silent or virtual input.
- The script loads the real bridge from the working tree (`NARRATION_UTILS_REAPER_DIR`) and drives each command through a fresh registry, the way `navigation_check.lua` does, writing `PASS`/`FAIL` per step and every value it read back into the report. The report goes into `integrations/reaper/spikes/results/` with paths removed, and its findings into this page's record.
- Record REAPER's version and the OS. A finding that differs from the harness's fake changes the fake in the same PR, so the harness keeps modelling what REAPER does.

## Part A: unattended, no audio device

Build a scratch project with three tracks ("Chapter 1", "Chapter 2", "Pickups"), `make_media.py`'s tones as items on "Chapter 1" (one item with two takes, one item trimmed with a source offset, one at play rate 1.5), one region, and a chain file `Test EQ.RfxChain` (one ReaEQ) under `<cfg>\FXChains\Voice\`. Save it once.

| # | Command | Steps | Pass when |
| --- | --- | --- | --- |
| A1 | heartbeat `changeCount` | Read three heartbeats; move an item; add a marker; arm a track; save. | The fourth field is present and whole; it rises after the move, the marker and the save. Record whether the arm moves it. |
| A2 | `chapter_track_state` | Send it for "Chapter 1" with the transport stopped and the cursor at 2.5 s; then for an unknown GUID; then with no GUID. | `TRACK_STATE` has play state 0, edit cursor 2.500000, the saved path, unsaved 0, the change count A1 read, `thisArmed`/`armedCount` as armed, the track's `I_RECINPUT` and an empty input device (device closed); one `TRACK_ITEM` per item with the active take's offset, rate and file; `TRACK_STATE_END` counts them. The unknown GUID answers `TRACK_STALE` only; no GUID answers the transport with no items. No undo point, change count unchanged. |
| A3 | `chapter_track_state` while playing | Start playback from 1 s (with the device closed, REAPER's transport still runs); send it twice 0.5 s apart; stop. | Play state 1; play position moves between the two reads; edit cursor stays where playback started. Record whether `GetPlayPosition` moves while paused. |
| A4 | `arm_only` | Arm "Chapter 2" and "Pickups" by hand; send `arm_only` for "Chapter 1"; press Undo once; send it again. | Only "Chapter 1" is armed; `ARMED` reports 2 disarmed; **no** "Narration Utils" undo point; Undo does not change arms (record what it does undo); the second send changes nothing and keeps the arms remembered from the first. |
| A5 | `record_start` refusals | With two tracks armed; with "Chapter 2" armed only; while playing. | Each is refused with its `ERROR` message and REAPER does not record. |
| A6 | `set_active_take` | Make take 2 of the two-take item active; send it again; press Undo. | `ACTIVE_TAKE_SET` changed, then unchanged; one undo point "Narration Utils: use take"; Undo makes take 1 active again. A stale take GUID answers `ITEM_STALE` and changes nothing. |
| A7 | `list_fx_chains`, `list_fx` | Send `list_fx_chains`. Add a second chain in a nested folder and a file that is not a chain; send it again. Send `list_fx`. | `FX_CHAIN` lists `Voice/Test EQ.RfxChain` (forward slashes), then the new one; the other file is not listed; no path outside `FXChains` appears. `list_fx` lists ReaEQ and REAPER's other stock plug-ins by the names the FX browser shows, and neither the FX container nor the video processor. Record whether REAPER follows a junction inside `FXChains`. |
| A8 | `apply_fx_chain` | Apply `Voice/Test EQ.RfxChain` to "Chapter 1", then to the master track (`master`); press Undo twice; apply a name that is not listed and `../reaper.ini`. | One ReaEQ in each track's FX chain (not its input FX), each in one undo point "Narration Utils: apply FX chain Voice/Test EQ.RfxChain to …"; no item or take changed; each Undo removes one. The last two are refused before anything changes. |
| A8b | `add_take_fx` | Add ReaEQ (its `list_fx` name) to 1.0–2.0 s of source time on the trimmed item; add a second plug-in to the middle piece; read the item list back; press Undo twice; add to the whole item; send a chain name. | Two splits and one ReaEQ on the middle piece's active take, in one undo point "Narration Utils: add take FX …"; the second add splits nothing and makes the count 2; the left and right pieces have no FX; the item's line-id extension data is on all three pieces; Undo removes the second plug-in, then rejoins the item. The whole-item case splits nothing. The chain name is refused. Record REAPER's split crossfade and what happened to take markers. |
| A9 | `create_regions` | Send a chapters-and-credits payload; send it again; send it with one chapter's end moved and the update flag on. | The regions appear with their titles and colours in one undo point "Narration Utils: create regions"; the second send creates none; the third moves one region, keeping its number and colour. One Undo removes what one call did. |
| A9b | `play_position` | With the transport stopped and the cursor at 2.5 s; then while playing from 1 s, twice 0.5 s apart; then while recording (on the copy, D28). | `PLAY_POSITION` state 0 with both positions and the cursor at 2.500000; while playing, state 1 and both positions move, `processed` ahead of `heard` by about the output latency (record the gap); state 5 while recording. No undo point. |
| A9c | `punch_to` | Send 42.5 with pre-roll 3; then 1.25 with pre-roll 3; then 42 while recording; then a pre-roll of 11. | The edit cursor is at 39.5 and in view, playback not started; then at 0; the recording and the bad pre-roll are refused with their `ERROR` messages and the cursor does not move. No undo point. |
| A10 | Nothing else changed | Diff the project's state chunks before and after each write command, except the value it is meant to change. | No other track, item, marker or project setting changed. |

## Part B: with the owner and an audio device

Needs the owner present and approval for one test recording on a copy of a project (D28). Use a silent or virtual input (the owner chooses); open the device in the scratch `-cfgfile` REAPER.

| # | Command | Steps | Pass when |
| --- | --- | --- | --- |
| B1 | `chapter_track_state` device read | Open the input device; send it. | `inputDevice` names the device REAPER shows in Preferences > Audio (record the answer for ASIO and for WASAPI if both are available). |
| B2 | `record_start` | Arm "Chapter 2" and "Pickups" by hand; `arm_only` "Chapter 1"; `record_start` "Chapter 1" with the record mode set to normal, then repeat with "time selection auto-punch". | `RECORD_STARTED` after REAPER's record button lights; the cursor it reports is where recording began. Record whether `GetPlayState()` reported bit 4 in the same defer cycle, and whether auto-punch was honoured. |
| B3 | `record_stop` | After about five seconds, `record_stop`. | REAPER stops; its own "save recorded media" prompt (if on) is left for the owner; `RECORD_STOPPED` reports the arms restored ("Chapter 2" and "Pickups" armed again, "Chapter 1" not). |
| B4 | Stop in REAPER | `record_start` again; press Stop in REAPER itself. | The bridge reports `RECORD_ENDED` for the start's run and restores the arms; a later `record_stop` answers `RECORD_NOT_OURS`. |
| B5 | A recording the app did not start | Press Record in REAPER; send `record_stop`. | `RECORD_NOT_OURS`; REAPER keeps recording. Stop it by hand. |
| B6 | The narrator changes an arm mid-take | Arm "Chapter 2" by hand; `arm_only` "Chapter 1"; `record_start`; arm "Pickups" (not armed before) by hand during the take; `record_stop`. | "Pickups" stays armed as the narrator set it and is reported as kept; "Chapter 2" is armed again. |

## Switching a command on

A command passes when every row that names it passes and the report is recorded. Then, in one PR:

1. Record the run here (a "Verification record" section: date, REAPER version, OS, the report, every value that differed from the fake) and correct the fake to match.
2. Take the command off the host's experimental list (`experimentalCommands` in `apps/desktop/internal/bridge/actions.go`), so it no longer needs the switch. A command whose row failed stays on the list, and its PRD phase stays partial, with the finding on the phase.
3. Set the PRD phases the command completes to `complete`, and update the threat model rows that say "pending" for it.

When every command is off the list, the switch has nothing left to gate; the PR that empties the list removes the switch and its `config/defaults.json` default.

## Pending owner steps

Tracked on the [owner queue, #510](https://github.com/countrymanprime/narration-utils/issues/510): run Part A (unattended, can be scripted by Claude on the owner's machine); be present for Part B and approve its one test recording on a copy of a project.
