# The REAPER verification pass

**Status: Part A is scripted and its run on the owner's machine is pending; Part B has not run.** The owner runs it. Until it has run, every command below stays Experimental: the host refuses to send it unless the narrator turns its capability on, with its own `DAW.capability.<name>` setting or, for one left on `auto`, the **Experimental REAPER actions** switch (`DAW.experimental_reaper_actions`, off by default; owner decision D38, [resolver.go](../../apps/desktop/internal/dawport/resolver.go)).

The harness ([The DAW port](../architecture/daw-integration.md#the-daw-port), `integrations/reaper/tests`) proves each command's logic, refusals and events against a fake REAPER. It cannot prove what REAPER itself does with a call. This pass checks that, command by command, in a real REAPER. The calls and what the reference leaves open are in [the ReaScript calls behind the planned commands](../research/reaper-api-for-planned-commands.md).

## Rules

- REAPER runs isolated: `integrations/reaper/spikes/run-reaper.ps1` starts it with `-cfgfile <temp>\reaper.ini`, so the owner's settings, scripts and projects are never read or written ([the spike rules](../../integrations/reaper/spikes/README.md)).
- Only a **copy** of a project is opened, in a temp folder, with its media copied beside it or replaced by synthetic tones (`make_media.py`). Never open, save into or delete anything under `C:\Users\Count\Documents\REAPER Media\Projects\Challenges\`. Record the original `.rpp`'s SHA-256 before and after, as spike S6 did.
- Part A runs unattended with the audio device closed (`reaper.Audio_Quit()`). Part B records, so it needs the owner present and their approval for the one test recording on a copy, with a silent or virtual input.
- The script loads the real bridge from the working tree (`NARRATION_UTILS_REAPER_DIR`) and drives each command through a fresh registry, the way `navigation_check.lua` does, writing `PASS`/`FAIL` per step and every value it read back into the report. The report goes into `integrations/reaper/spikes/results/` with paths removed, and its findings into this page's record.
- Record REAPER's version and the OS. A finding that differs from the harness's fake changes the fake in the same PR, so the harness keeps modelling what REAPER does.

## Part A: unattended, no audio device

### Running it

One command, from the repository root on the owner's Windows machine with REAPER installed (`C:\Program Files\REAPER (x64)\reaper.exe`), Python and PowerShell 7:

```powershell
pwsh integrations/reaper/spikes/run-pass-part-a.ps1
```

It takes about two minutes and needs no input: it starts REAPER twice, each time isolated on its own scratch `-cfgfile` under a fresh `%TEMP%\narration-pass-a-<time>` folder, and closes each session after five minutes at most (`-TimeoutSec`). The first session runs `spike_ep0_workspace.lua` (rows A6 to A8); the second runs `pass_part_a.lua` (every other row) and merges the first one's report. The results land in `%TEMP%\narration-pass-a-<time>\main\pass-part-a-results.md` (the table to paste into [#510](https://github.com/countrymanprime/narration-utils/issues/510)) and `pass-part-a-log.txt` (every check and value), with paths removed, and both are copied to `integrations/reaper/spikes/results/`. The last line it prints is the pass count and the path.

What keeps it safe:

- It opens no project of the owner's. Each session builds its scratch project from `make_media.py`'s tones and saves it in the scratch folder; every file it writes goes through a guard that refuses anything outside the scratch `-Out` and `-Cfg` folders or under a `REAPER Media` folder, and the wrapper and `run-reaper.ps1` refuse a scratch folder outside `%TEMP%`.
- It stops before touching anything unless REAPER's resource path is the scratch `-Cfg` and the audio device is closed.
- It never records: `CSurf_OnRecord` is replaced by a counter before the bridge loads, so a `record_start` that should have been refused fails A5 instead of recording. The steps that need a recording are Part B's (B9). Playback (A3, A5, A9b) runs with the device closed, so nothing is heard or captured.
- It drives the real bridge from the working tree through the same file protocol the Go host uses, so a check reads what the app would see.

The driver's logic is proved against the harness's fake before it reaches REAPER: `tests/pass_part_a_test.lua` runs every row it scripts against the fake and requires each to pass (and a broken `select_track`, a changed witness track or a record request to fail), and `tests/pass_part_a_script_test.lua` runs `pass_part_a.lua` itself end to end on the fake with the REAPER-only calls stood in. A check the fake cannot model (undo, the arrange view) is reported as not run there, never as passed.

A row passes when every check under it passes. A step Part A cannot take (one that needs a recording) is listed as not run and moved to Part B; it does not fail the row. A value the page says to record (what Undo undid, the play-position gap, whether arming moves `changeCount`) is listed under "Recorded values".

### The rows

The scratch project has three tracks ("Chapter 1", "Chapter 2", "Pickups"), `make_media.py`'s tones as items on "Chapter 1" (one item with two takes at 0 s, one trimmed to start 0.5 s into its source at 4 s, one at play rate 1.5 at 8 s, and a 3 s item at 12 s), one item on "Chapter 2", and one region ("Fixture region", 20 to 25 s). It is saved once and reopened from the scratch folder, so its undo history starts empty. Rows A6 to A8 use their own scratch project and chain files (`Test EQ.RfxChain`, one ReaEQ, under `<cfg>\FXChains\Voice\`), built by `spike_ep0_workspace.lua`.

| # | Command | Steps | Pass when |
| --- | --- | --- | --- |
| A1 | heartbeat `changeCount` | Read three heartbeats; move an item; add a marker; arm a track; save. | The fourth field is present and whole; it rises after the move, the marker and the save. Record whether the arm moves it. |
| A2 | `chapter_track_state` | Send it for "Chapter 1" with the transport stopped and the cursor at 2.5 s; then for an unknown GUID; then with no GUID. | `TRACK_STATE` has play state 0, edit cursor 2.500000, the saved path, unsaved 0, the change count A1 read, `thisArmed`/`armedCount` as armed, the track's `I_RECINPUT` and an empty input device (device closed); one `TRACK_ITEM` per item with the active take's offset, rate and file; `TRACK_STATE_END` counts them. The unknown GUID answers `TRACK_STALE` only; no GUID answers the transport with no items. No undo point, change count unchanged. |
| A3 | `chapter_track_state` while playing | Start playback from 1 s (with the device closed, REAPER's transport still runs); send it twice 0.5 s apart; stop. | Play state 1; play position moves between the two reads; edit cursor stays where playback started. Record whether `GetPlayPosition` moves while paused. |
| A4 | `arm_only` | Arm "Chapter 2" and "Pickups" by hand; send `arm_only` for "Chapter 1"; press Undo once; send it again. | Only "Chapter 1" is armed; `ARMED` reports 2 disarmed; **no** "Narration Utils" undo point; Undo does not change arms (record what it does undo); the second send changes nothing and keeps the arms remembered from the first. |
| A5 | `record_start` refusals | With two tracks armed; with "Chapter 2" armed only; while playing. | Each is refused with its `ERROR` message and REAPER does not record. |
| A6 | `set_active_take` | Make take 2 of the two-take item active; send it again; press Undo. | `ACTIVE_TAKE_SET` changed, then unchanged; one undo point "Narration Utils: use take"; Undo makes take 1 active again. A stale take GUID answers `ITEM_STALE` and changes nothing. |
| A7 | `list_fx_chains` | Send `list_fx_chains`. Add a second chain in a nested folder and a file that is not a chain; send it again. | `FX_CHAIN` lists `Voice/Test EQ.RfxChain` (forward slashes), then the new one; the other file is not listed; no path outside `FXChains` appears. Record whether REAPER follows a junction inside `FXChains`. |
| A8 | `apply_fx_chain` | Apply `Voice/Test EQ.RfxChain` to "Chapter 1", then to the master track (`master`); press Undo twice; apply a name that is not listed and `../reaper.ini`. | One ReaEQ in each track's FX chain (not its input FX), each in one undo point "Narration Utils: apply FX chain Voice/Test EQ.RfxChain to …"; no item or take changed; each Undo removes one. The last two are refused before anything changes. |
| A9 | `create_regions` | Send a chapters-and-credits payload; send it again; send it with one chapter's end moved and the update flag on. | The regions appear with their titles and colours in one undo point "Narration Utils: create regions"; the second send creates none; the third moves one region, keeping its number and colour. One Undo removes what one call did. |
| A9b | `play_position` | With the transport stopped and the cursor at 2.5 s; then while playing from 1 s, twice 0.5 s apart; then while recording (Part B, B9). | `PLAY_POSITION` state 0 with both positions and the cursor at 2.500000; while playing, state 1 and both positions move, `processed` ahead of `heard` by about the output latency (record the gap); state 5 while recording. No undo point. |
| A9c | `punch_to` | Send 42.5 with pre-roll 3; then 1.25 with pre-roll 3; then 42 while recording (Part B, B9); then a pre-roll of 11. | The edit cursor is at 39.5 and in view, playback not started; then at 0; the recording and the bad pre-roll are refused with their `ERROR` messages and the cursor does not move. No undo point. |
| A10 | Nothing else changed | Diff the project's state chunks (every track and the master) and its markers and regions before and after each row, leaving out only what the row is meant to change: arms for A4 and A5, the selection for A11, the markers and regions for A9, "Chapter 1" for A14, and the markers for A4 (its Undo removes A1's marker). | No other track, item, marker or project setting changed. |
| A11 | `select_track` | Select "Chapter 2" and "Pickups" by hand; send `select_track` for "Chapter 1"; then for an unknown GUID; then with no GUID. | `TRACK_SELECTED` names "Chapter 1" and only "Chapter 1" is selected; no undo point. The unknown GUID and the empty one answer `TRACK_STALE` only, and "Chapter 1" stays the only selected track. |
| A14 | `apply_item_gain` | Send `-6` dB for the play-rate-1.5 item; then `+6` dB for it; press Undo; then `-3` dB for an unknown item. | `GAIN_ITEM` from 1.000000 to 0.501187 and `GAIN_APPLIED` 1; `D_VOL` reads back 0.501187; one undo point "Narration Utils: apply level-match gain"; no other item's volume changed. The `+6` multiplies back to about 1.0 (a narrator's own trim is kept, not overwritten); Undo puts back 0.501187. The unknown item answers `GAIN_STALE` `item` and `GAIN_APPLIED` 0 with no undo point. |

## Part B: with the owner and an audio device

Needs the owner present and approval for one test recording on a copy of a project. Use a silent or virtual input (the owner chooses); open the device in the scratch `-cfgfile` REAPER.

| # | Command | Steps | Pass when |
| --- | --- | --- | --- |
| B1 | `chapter_track_state` device read | Open the input device; send it. | `inputDevice` names the device REAPER shows in Preferences > Audio (record the answer for ASIO and for WASAPI if both are available). |
| B2 | `record_start` | Arm "Chapter 2" and "Pickups" by hand; `arm_only` "Chapter 1"; `record_start` "Chapter 1" with the record mode set to normal, then repeat with "time selection auto-punch". | `RECORD_STARTED` after REAPER's record button lights; the cursor it reports is where recording began. Record whether `GetPlayState()` reported bit 4 in the same defer cycle, and whether auto-punch was honoured. |
| B3 | `record_stop` | After about five seconds, `record_stop`. | REAPER stops; its own "save recorded media" prompt (if on) is left for the owner; `RECORD_STOPPED` reports the arms restored ("Chapter 2" and "Pickups" armed again, "Chapter 1" not). |
| B4 | Stop in REAPER | `record_start` again; press Stop in REAPER itself. | The bridge reports `RECORD_ENDED` for the start's run and restores the arms; a later `record_stop` answers `RECORD_NOT_OURS`. |
| B5 | A recording the app did not start | Press Record in REAPER; send `record_stop`. | `RECORD_NOT_OURS`; REAPER keeps recording. Stop it by hand. |
| B6 | The narrator changes an arm mid-take | Arm "Chapter 2" by hand; `arm_only` "Chapter 1"; `record_start`; arm "Pickups" (not armed before) by hand during the take; `record_stop`. | "Pickups" stays armed as the narrator set it and is reported as kept; "Chapter 2" is armed again. |
| B7 | Which microphone REAPER uses ([inputmatch.go](../../apps/desktop/internal/daw/inputmatch.go)) | With the device open in REAPER, open the app's microphone picker (`TeleprompterReaperInput`); repeat with ASIO and with WASAPI if both are available. | `matched` selects the microphone REAPER records from, or `uncertain` names that interface's inputs; never a different device. Record REAPER's `IDENT_IN` name and the teleprompter's device list for each driver type, and add any pair that does not match as a case in `internal/daw/inputmatch_test.go`. |
| B8 | The same microphone in REAPER and the app | With REAPER recording or monitoring the device, open the microphone popover's level meter (`TeleprompterMeterStart`, [Input level and the meter](../architecture/manuscript-teleprompter.md#input-level-and-the-meter)), then start a reading. | The meter moves with the owner's voice and the reading follows, or the open fails and `meter_stopped` or the session's error says why (REAPER holding the device exclusively). REAPER's own recording is never interrupted. Record which drivers share the device. |
| B9 | `play_position` and `punch_to` while recording (the recording steps of A9b and A9c, which Part A cannot take) | During B2's recording, send `play_position`; then `punch_to` 42 with pre-roll 3. | `PLAY_POSITION` state 5 with both positions moving; `punch_to` is refused with "REAPER is recording. Stop it before moving to a word." and the cursor does not move. |

## Part C: the Studio Next DAW commands (not scripted yet)

The commands added by [the DAW PRD](../prds/studio-next-daw-ports-and-capabilities.prd.md) (SN-D44 to SN-D72), and the file commands of SN-B98 (C10, C11). `run-pass-part-a.ps1` does not run them yet, and no row below has run in REAPER (2026-10-12); the owner deferred each to the QA pass, [#1495](https://github.com/countrymanprime/narration-utils/issues/1495), where the detail of what to confirm is listed. Each "Pass when" is the capability's result in [the capabilities reference](../reference/daw/capabilities.md); the harness test named proves the bridge's logic only. C2 records and C10 plays audio, so they need Part B's set-up and the owner present; the others run on Part A's scratch project with the device closed.

| # | Command | Steps | Pass when |
| --- | --- | --- | --- |
| C1 | `hide_takes` (`takes`; `takes_test.lua`) | Hide the other take of the two-take item, keeping take 2; send it again; press Undo; send it with a stale take GUID. | `TAKES_HIDDEN` mutes 1 other take (`D_VOL` 0, the old volume in the take's `P_EXT`) and makes take 2 active, in one undo point; the second send is unchanged with no undo point; one Undo gives back every take's volume and the active take; the stale GUID is refused `stale` and changes nothing. Nothing is deleted, moved or re-sourced |
| C2 | `roll` (`punch`; `roll_test.lua`) | During B2's recording, with "New recording that overlaps existing media items" set to "Splits existing items and creates new takes", send `roll` at 2 s before the play position; then with that option set otherwise; then for a recording the app did not start. | `ROLLED`: REAPER records again from the time and the earlier pass stays as a take; the command opens no undo block of its own (count the points REAPER adds). The other option is refused, naming the setting, which the app does not change; the narrator's own recording answers `RECORD_NOT_OURS` |
| C3 | `delete_range` (`cut_range`; `range_test.lua`) | Cut 1 to 2 s of the 12 s item in `close` mode; press Undo; cut it in `gap` mode; send a range that overlaps the next item. Then cut 1 to 2 s with a 100 ms pad; press Undo; mark 0.2 to 0.7 s as a region named Room tone and cut 4 to 5 s in `gap` mode with room tone; press Undo. | The item is split at both ends and the middle piece moves to the muted Cuts track, in one undo point; `close` moves the later items on that track up by 1 s, `gap` leaves silence; one Undo gives the item back whole; the overlap is refused and changes nothing. The padded cut runs 1.1 to 1.9 s; the room-tone cut lays two items playing 0.2 to 0.7 s of the file across 4 to 5 s, and one Undo takes them away with the cut. No item, take or source file is deleted |
| C4 | `apply_fx_range` (`fx_range`; `fx_range_test.lua`) | Put `Voice/Test EQ.RfxChain` on 1 to 2 s of the 12 s item; press Undo; send a chain name `list_fx_chains` does not list. | The item is split at both ends and the chain's FX load on the middle piece's active take with `TakeFX_AddByName`, in one undo point; the take's `P_EXT` records the chain and the FX it added; one Undo gives the item back whole; the unlisted name is refused and nothing is split |
| C5 | `remove_fx_range` (`fx_range`; `fx_range_test.lua`) | After C4 (applied again), take the chain off the piece; send it again. | Only the FX the apply recorded come off and the piece joins the pieces the apply split off, in one undo point, playing the same audio; the second send changes nothing |
| C6 | `stack_takes` (`stack_takes`; `stack_test.lua`) | With a first read and a later read of the same words on "Chapter 1", send a payload stacking the later read on the first; press Undo; send one with a stale GUID. | The later read becomes a take of the first read's item, its own item moves to the muted Cuts track and the audio after moves up by the shift, in one undo point; the first read stays active; one Undo gives every read back; the stale GUID refuses the whole request and changes nothing |
| C7 | `unstack_takes` (`stack_takes`; `stack_test.lua`) | After C6 (stacked again and saved), send the un-stack payload. | The stacked take is removed and the read goes back by the offset its take recorded, in one undo point; nothing is deleted |
| C8 | `reopen_pickup` (`pickups`; `pickups_test.lua`) | Import one pickup, `resolve_pickup` it, then `reopen_pickup` at its position; send it again. | `PICKUP_REOPENED`: the marker reads `PICKUP: <body>` again, in one undo point named "Narration Utils: reopen pickup"; the second send answers `ERROR` with no undo point |
| C9 | `list_pickup_markers` (`pickups`; `pickups_test.lua`) | With one open and one resolved pickup, send it with an output path in the session folder. | `PICKUP_MARKERS_LISTED` with 1 open and 1 done; the file holds `start\|state\|tag\|note` rows in position order; no undo point |
| C10 | `preview_file_range`, `stop_file_preview` (`file_preview`; `media_file_test.lua`) | With SWS installed, the audio device open and the owner listening: note the change count, then send `preview_file_range` for 2 s from 1 s of a WAV outside the project; then for 30 s and `stop_file_preview` after 2 s; `stop_file_preview` again; a start past the end of the file; and once on a REAPER without SWS. | `FILE_PREVIEW_STARTED` and 2 s of that file heard, ending on its own; the 30 s one stops at the stop (`FILE_PREVIEW_STOPPED` 1), the second stop answers 0; past the end is refused; without SWS the SWS sentence. Throughout: no item added, no undo point, the change count and the transport unchanged, and no crash when the source is freed |
| C11 | `reveal_file` (`file_reveal`; `media_file_test.lua`) | Send it for a WAV outside the project; then for a path on a network share. | The Media Explorer opens with the file selected; nothing plays, no item is added, the change count is unchanged; the share is refused and REAPER opens nothing |
| C12 | `split_take` (`takes`; `split_take_test.lua`) | Give a one-take item on "Chapter 1" two reads of the same line (10 to 20 s, the second from 15.5 s); send `split_take` at 15.5 s; play both takes; press Undo; send it with a stale take GUID. | `TAKE_SPLIT`: one item, ending at 15.5 s, with two takes: the first read, still active, and a new take playing the second read from the same file on the first read's spot; one undo point; one Undo gives the one take back at its full length; the stale GUID is refused `stale` and changes nothing. Nothing is deleted, moved or re-sourced |
| C13 | `reduce_range_gain` (`range_gain`; `reduce_range_gain_test.lua`) | On a one-take item on "Chapter 1" with no volume envelope, send `reduce_range_gain` lowering two stretches of the take's source by 9 dB; play across both edges; send the same request again; press Undo; then once on a take whose volume envelope already holds points elsewhere, and once with a stale take GUID. | `RANGE_GAIN_REDUCED`: the take gets a visible volume envelope; each stretch plays 9 dB quieter with no click at either edge and the rest at its level; the source file is unchanged; one undo point named "Narration Utils: lower stretches", and one Undo puts the take back as it was (envelope and item selection included); the repeat is refused and adds nothing; the narrator's points keep their level; the stale GUID is refused `stale`. Record whether the take envelope's point times are seconds from the item's start |
| C14 | `repair_click` (`click_repair`; `repair_click_test.lua`) | On a one-take item on "Chapter 1" with no volume envelope and an audible mouth click, send `repair_click` with that click's source seconds; play across it; send the same request again; press Undo; then once with a stale take GUID. | `CLICKS_REPAIRED`: the take gets a visible volume envelope; the click is no longer heard and the 30 dB dip with its 2 ms ramps is not heard either (else record the depth and ramp that work); the source file is unchanged; one undo point named "Narration Utils: repair clicks", and one Undo puts the click back (envelope and item selection included); the repeat is refused and adds nothing; the stale GUID is refused `stale`. |
| C15 | `fx_range_params`, `fx_range_set_param`, `fx_range_bypass` (`fx_range`; `fx_range_test.lua`) | After C4 (a chain on a piece), send `fx_range_params` with the piece and take GUIDs it answered; set one listed setting to another value inside its range; play the piece; press Undo; send `fx_range_bypass` with `1`, play, then with `0`; press Undo; then once each with a stale take GUID. | `RANGE_FX_PARAM` lines name the chain's own FX and settings with REAPER's bounds and shown values, then `RANGE_FX_PARAMS`; the setting is heard changed, its `RANGE_FX_PARAM_SET` value is the one REAPER shows, and one Undo ("Narration Utils: change effect setting") puts it back; bypass is heard off and on again, each one undo point that one Undo reverses; the stale GUID is refused `stale`. Record whether `TakeFX_GetParam`'s bounds are the plug-in's own units or 0 to 1 |
| C16 | `fx_range_compare`, `stop_fx_compare` (`fx_range`; `fx_range_test.lua`) | After C4, with the edit cursor elsewhere and the chain on, send `fx_range_compare` with the piece and take GUIDs; listen to both passes; look at Edit > Undo history; send it again and `stop_fx_compare` during the second pass; then once with the chain bypassed first, and once with a stale take GUID. | `RANGE_FX_COMPARE` at once with the piece's start and end; the piece is heard with the effect, then without it, with a short gap between, and playback stops after the second pass; the chain is on again and the edit cursor is back; the undo history has no new entry; the stop ends playback and puts the chain on; a chain bypassed before stays bypassed; the stale GUID is refused `stale`. Record whether a plug-in's tail carries into the bypassed pass, how long the gap between passes is, and what happens for a piece at the very end of the project (REAPER may stop by itself after the first pass) |
| C17 | `last_action`, `undo_last` (`undo_last`; `undo_test.lua`) | Note the project state change count; after C3's `close` cut (made again), send `last_action` with `cut_range`, then `undo_last` with `cut_range` and 1; make two cuts, move an item by hand, make one more cut, and send `undo_last` with 3; send `last_action` once more; then `undo_last` with nothing of the app's on top. | `LAST_ACTION\|…\|cut_range\|this` right after the cut, with `Undo_CanUndo2` naming "Narration Utils: delete words"; one `Undo_DoUndo2` gives the item back whole in one step, the Cuts-track move and the close-up included, and the change count rises; the run of three undoes the last cut only and answers `UNDONE_LAST\|…\|3\|1`, the hand move and the cuts under it left as they were; `last_action` then answers `other`; the last one undoes nothing and answers `0`. Record what `Undo_CanUndo2` answers with no undo history and whether the change count rises on an undo. Not run in REAPER (pending the QA pass, #1495) |
| C18 | `monitor_level` (`monitor_level`; `levels_test.lua`) | With a master track that has a hardware output (Master > Routing > Hardware Output), note the change count and the send's volume; send `monitor_level` with an empty level; then with 70, 100, 0 and 35; look at the send's fader in the Routing window and at Edit > Undo history after each; send 35 again; delete the hardware output and send once more. | `MONITOR_LEVEL\|…\|<level>` echoing the level set after each; the read before any set matches the send's volume (0 dB reads 70); 70 shows 0.00 dB, 100 +6.00 dB, 35 -30.0 dB and 0 -inf; the master fader never moves; no undo point is added and the change count is unchanged or only what a send edit does (record which); the repeat changes nothing; with no hardware output the answer is `ERROR` with the sentence. Record that `GetTrackNumSends(master, 1)` counts hardware outputs, what `SetTrackSendInfo_Value` answers, and whether the first hardware output is the one the narrator monitors on. Not run in REAPER (pending the QA pass, #1495) |

## Switching a command on

A command passes when every row that names it passes and the report is recorded. The rows each Experimental capability (`declares` in `apps/desktop/internal/dawport/reaper/reaper.go`) needs, besides A10 for every row that writes:

| Capability | Commands | Rows |
| --- | --- | --- |
| `track_state` | `chapter_track_state` | A1, A2, A3 |
| `track_select` | `select_track` | A11 |
| `record` | `arm_only`, `record_start`, `record_stop` | A4, A5, B1 to B6 |
| `punch` | `play_position`, `punch_to`, `roll` | A9b, A9c, B9, C2 |
| `regions` | `create_regions` | A9 |
| `takes` | `set_active_take`, `hide_takes`, `split_take` | A6, C1, C12 |
| `fx_chains` | `list_fx_chains`, `apply_fx_chain` | A7, A8 |
| `item_gain` | `apply_item_gain` | A14 |
| `cut_range` | `delete_range` | C3 |
| `fx_range` | `apply_fx_range`, `remove_fx_range` | C4, C5 |
| `stack_takes` | `stack_takes`, `unstack_takes` | C6, C7 |
| `file_preview` | `preview_file_range`, `stop_file_preview` | C10 |
| `file_reveal` | `reveal_file` | C11 |
| `undo_last` | `last_action`, `undo_last` | C3, C17 |
| `monitor_level` | `monitor_level` | C18 |

Then, in one PR:

1. Record the run here (a "Verification record" section: date, REAPER version, OS, the report, every value that differed from the fake) and correct the fake to match.
2. Take the command off the host's experimental list (`experimentalCommands` in `apps/desktop/internal/bridge/actions.go`) and move its capability's declaration in `apps/desktop/internal/dawport/reaper/reaper.go` to Supported, in the same PR, so it no longer needs to be turned on. A command whose row failed stays on the list,, with the finding recorded here.
3. Update the threat model rows that say "pending" for it.

`pickups` is Supported already, so C8 and C9 promote nothing: a failure there is a bug to fix. Which command is promoted when is in [the promotion plan](../research/studio-next-daw-promotion-plan.md).

When every command is off the list, the switch has nothing left to gate; the PR that empties the list removes the switch and its `config/defaults.json` default.

## Line identity in REAPER

The scripted run and the owner's steps for `stamp_item_lines`, `read_line_ids` and `create_regions` ([manuscript line identity](../architecture/manuscript-line-identity.md)). They are separate from Parts A and B.

### Line identity: verification record

The commands' logic is pinned by the bridge harness (`integrations/reaper/tests`, [the REAPER bridge](../architecture/reaper-bridge.md#the-harness)); REAPER's own behaviour was checked on 2026-09-21 in REAPER 7.80/x64 by `integrations/reaper/spikes/checklist.lua`, which loads the real bridge in an isolated REAPER (`-cfgfile` in a temp folder, a scratch project, no audio device) and drives it through the file protocol. 37 checks, 0 failures.

| Step | How verified | Result |
| --- | --- | --- |
| 1 Scratch project | Scripted | A saved scratch project with three audio items |
| 2 Stamp | Scripted | `LINES_STAMPED\|t1\|1\|0\|0\|0`; the undo entry is named as documented; Undo removes the stamp and Redo restores it |
| 3 Idempotent | Scripted | `...\|0\|1\|0\|0`, no new undo entry |
| 4 Conflict | Scripted | `LINES_CONFLICT` and the old ID kept; overwrite `1` changes it |
| 5 Stale | Scripted | `LINES_STALE`, no item changed |
| 6 Survives editing | Scripted, partly | Split: both halves keep the stamp (the right half has a new GUID); duplicate keeps it; a state-chunk copy keeps it. **A real paste of items was not exercised** (clipboard actions do nothing headless): owner |
| 7 Save and reload | Scripted | The same items and text after reopening; the `.rpp` holds an `<EXTI` block per stamped item |
| 8 Untouched fields | Scripted | Item notes and take names unchanged |
| 9 Regions | Scripted | One coloured region; again `...\|0\|1\|0`; a malformed row counted invalid |
| 10 Transcript Compare | Scripted for the bridge, **not in the app** | `prepare_compare`, `inspect_compare_results`, `export_compare_markers` (with its undo entry) and `jump_to_compare_marker` work against a hand-made results file. Starting a comparison from the app, with the launcher, is for the owner |

`reaper.EnumerateFiles` caches the commands folder listing, so the bridge clears it on every tick (see [the REAPER bridge](../architecture/reaper-bridge.md)).

### Line identity: owner checklist

Run steps 6 (the paste part) and 10 by hand, in REAPER with the app open; the rest is recorded above. The session folder is `<REAPER resource path>/NarrationStudio/sessions/hub_<id>/`; start it by running `NarrationStudio_Launcher.lua`. To drive a command by hand, save a one-line file such as `00000001.cmd` in that folder's `commands/` directory and read `events.log` beside it.

1. Use a scratch project with a few audio items. Note one item's GUID (right-click item, Copy item GUID, or read it from the `.rpp`).
2. **Stamp.** Payload `{GUID}|line-000001|First line.`, command `1|stamp_item_lines|t1|<payload path>|0`. Expect `LINES_STAMPED|t1|1|0|0|0`, an Edit menu entry "Narration Utils: stamp manuscript line IDs", and Undo removing it.
3. **Idempotent.** Send the same command again. Expect `...|0|1|0|0` and no new undo entry.
4. **Conflict.** Change the payload ID to `line-000002`, send with overwrite `0`. Expect a `LINES_CONFLICT` event and the old ID kept. Send with overwrite `1`: the ID changes.
5. **Stale.** Use a GUID that is not in the project. Expect `LINES_STALE`, and no item changed.
6. **Survives editing.** Move and split a stamped item, then `read_line_ids`. Confirm both halves still report the ID (split items copy extension data) or note which does not.
7. **Survives save and reload.** Save, close, reopen the project, run `read_line_ids`. The stamp must still be there. This also confirms extension data persists in the `.rpp`.
8. **Untouched fields.** Confirm the item's notes and take name are unchanged.
9. **Regions.** Payload `0|30|Chapter 1`, command `1|create_regions|t2|<payload path>|FF8800|0` (the checklist ran when the command was named `create_chapter_regions`). Expect one coloured region and `REGIONS_CREATED|t2|1|0|0|0|0|0`. Send again: `...|0|1|0|0|0|0`. Add a malformed line: it is counted as invalid.
10. Confirm Transcript Compare still starts (the bridge loads and existing commands are unaffected).

## Going to, looping and marking a finding in REAPER

The scripted run and the owner's steps for `navigate_item`, `loop_context`, `stop_loop`, `ping` and `add_finding_marker` ([going to and looping a finding](../architecture/reaper-navigation.md)). They are separate from Parts A and B.

### Going to a finding: verification record

The approved marker is pinned by `integrations/reaper/tests/finding_marker_test.lua` and mutation checks (the add outside an undo block, a doubled marker, a marker added while recording or at a spot the item no longer covers); the host side by `apps/desktop/bindings_marker_test.go`, `internal/bridge/marker_test.go` (a fake REAPER through the real file protocol) and the golden payloads `tests/fixtures/contracts/findings-add-marker*.json`. The navigation commands' logic is pinned by the harness (`integrations/reaper/tests/navigation_test.lua` and the mutation checks in `mutations.json`: a stale GUID resolving to another item, a missing take falling back to the active one, a spot outside the item, recording not refused, a second loop overwriting the memory, Stop overwriting a narrator's change, Stop not restoring repeat or restoring twice, Stop stopping playback it did not start, the script ending without restoring, and the compare GUIDs read late). The Go client is covered by `navigation_test.go` against a fake REAPER that answers through the real file protocol.

REAPER's own behaviour was checked on 2026-09-23 in REAPER 7.80/x64 by `integrations/reaper/spikes/navigation_check.lua` (run by `run-reaper.ps1`: an isolated `-cfgfile` in a temp folder, a scratch project built from synthetic tones in a temp folder, the audio device closed, and `OnPlayButton` replaced by a recorder so nothing played). It loads the real bridge registry and drives the real commands. 34 checks, 0 failures; the output is in `integrations/reaper/spikes/results/navigation-check-report.txt`.

| Step | How verified | Result |
| --- | --- | --- |
| Linked ranges | Scripted | Setting only the loop points moved the time selection and the reverse: linked by default |
| `ping` | Scripted | `PONG\|p1\|1\|0\|0`; after a loop, `looping` 1 |
| Loop | Scripted | Time selection and loop points read back as 10.5..12.5 s, repeat on, cursor at 10.5 s, Play requested once; no undo point, project not dirty |
| Second loop | Scripted | Re-targets to 11..12 s |
| Stop | Scripted | `LOOP_STOPPED\|s1\|3\|0`; time selection, loop points and repeat back to the narrator's; no undo point |
| Narrator changed the selection | Scripted | Their 20..21 s selection kept, `LOOP_STOPPED\|s2\|1\|2` |
| Stop with nothing held | Scripted | `0\|0`, nothing changed |
| Stale item, take, range | Scripted | `FINDING_STALE` with `item`, `take`, `range`; nothing selected, cursor not moved |
| Go to | Scripted | Only the finding's item selected, cursor at 11.5 s, no undo point; after moving the item to 30 s, 31.5 s |
| Compare GUIDs | Scripted | `COMPARE_MARKER` ends with the item, take and track GUIDs; `navigate_item` with them lands on the marker |
| Hearing the loop, REAPER's Stop button, ping after a restart, ending the script mid-loop | **Pending, owner** | Need audio hardware or the owner (below) |
| `add_finding_marker` in REAPER: the marker at the source time on the named take, one "Narration Utils: add approved marker" undo point that Undo removes, a second send answering `existing` with no new undo point, stale and recording refusals | **Pending, scripted run** | Not pre-approved, so not run. Run steps 10 and 11 below on a copy of a project with an isolated `-cfgfile`, as the Go to and Loop check was |
| The marker from the Review page, seen in REAPER, and Export markers on the Proofing page skipping it | **Pending, owner** | Step 11 below |

The first run of the check also saw `SelectAllMediaItems` leave an "Unselect all items" undo point; the second run's probe did not reproduce it, and `SetMediaItemSelected`, which the bridge now uses, left none in either.

### Going to a finding: owner checklist

For the owner, in REAPER with audio, on a copy of a real project. Start the session by running `NarrationStudio_Launcher.lua`; the session folder is `<REAPER resource path>/NarrationStudio/sessions/hub_<id>/`. To send a command by hand, save a one-line file such as `00000001.cmd` in its `commands/` folder (fields percent-encoded, `|`-separated, starting `1|<command>|<run id>`) and read `events.log` beside it. The same steps can be run from the Review page instead (open the app from the Narration Utils action, select a Proofing finding, and use Go to in REAPER, Loop in REAPER and Stop loop); step 9 is that run.

1. **Go to.** Copy an item's GUID (from the `.rpp`, `IGUID`). Send `1|navigate_item|n1|<GUID>||1.5`. The item alone is selected and the cursor sits 1.5 s into its audio; Edit > Undo history has no new entry.
2. **Stale.** Delete that item, send the same command. Expect `FINDING_STALE|n1|<GUID>|item` and nothing selected.
3. **Loop and hear it.** Make a time selection of your own and turn repeat off. Send `1|loop_context|l1|<GUID>||0.5|4.5`. You hear the 4 s window loop; REAPER shows it as the time selection with repeat on.
4. **Stop.** Send `1|stop_loop|s1`. Playback stops; your own time selection and repeat off are back; `LOOP_STOPPED|s1|3|0`.
5. **REAPER's own stop.** Loop again, press Space in REAPER, then send `1|ping|p1`: expect `looping` 1, `playing` 0. `stop_loop` still restores.
6. **Ending the script mid-loop.** Loop again, then terminate the launcher script (Actions > Running scripts, or quit REAPER without saving). The time selection and repeat are back.
7. **Ping after a restart.** Quit and reopen REAPER, run the launcher again, and send `ping` to the new session: `PONG`. The old session's folder gets no answer (the app would report `ErrNoAnswer`).
8. **Recording.** Start recording on a scratch track and send `navigate_item`: `ERROR ... REAPER is recording`, nothing moves. Stop recording.
9. **From the Review page.** Open the app from the Narration Utils action, run a Proofing comparison, open Review and select a transcript difference. Go to in REAPER selects its item and the page names the cursor time; Loop in REAPER plays it and Stop loop appears; Stop loop puts your selection and repeat back. Delete the item and press Go to: the page says the item is no longer in the project. Quit REAPER: within a few seconds Go to and Loop turn off with "REAPER is not answering". Open the app on its own (not from REAPER): they are off with the "open this app from the Narration Utils action" reason.
10. **Approved marker.** With the take GUID of an item's active take (`GUID` inside its `<SOURCE` block's take in the `.rpp`), send `1|add_finding_marker|m1|<item GUID>|<take GUID>|1.5|FF4040|MISREAD%3A%20test`. A red take marker "MISREAD: test" sits 1.5 s into the take's audio; Edit > Undo history has one new entry, "Narration Utils: add approved marker"; Undo removes the marker. Send it twice: the second answers `FINDING_MARKER|m1|existing|...` and adds no marker and no undo entry. Delete the item and send it again: `FINDING_STALE|m1|<GUID>|item`, nothing added. Start recording and send it: `ERROR ... REAPER is recording`, nothing added.
11. **Approved marker from the Review page.** In the run of step 9, accept a transcript difference, press Add marker in REAPER and confirm. The page names the marker; REAPER shows it on the take at the finding's spot. Press it again: the page says the take already has it. Back on the Proofing page, Export markers counts that row as skipped. Undo in REAPER removes the marker.

## Pending owner steps

Tracked on the [owner queue, #510](https://github.com/countrymanprime/narration-utils/issues/510): run Part A (`pwsh integrations/reaper/spikes/run-pass-part-a.ps1`, about two minutes, unattended) and paste `pass-part-a-results.md` into #510; be present for Part B and approve its one test recording on a copy of a project. The steps marked for the owner in the [line identity checklist](#line-identity-owner-checklist) (6 and 10) and the [going-to-a-finding checklist](#going-to-a-finding-owner-checklist) are pending with the owner too.
