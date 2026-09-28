# The REAPER verification pass

**Status: Part A is scripted (booth actions enablement PRD Phase 6) and its run on the owner's machine is pending; Part B has not run.** Stack S37 of the [implementation plan](../prds/implementation-plan.md) (section 7) runs it with the owner. Until it has run, every command below stays Experimental: the host refuses to send it unless the narrator turns its capability on, with its own `DAW.capability.<name>` setting or, for one left on `auto`, the **Experimental REAPER actions** switch (`DAW.experimental_reaper_actions`, off by default; owner decision D38, [ADR 0304](../adr/0304-bridge-actions-asks-a-per-command-gate-and-the-daw-ports-resolver-answers-it-from-the-per-capability-settings.md)).

The harness ([ADR 0066](../adr/0066-the-lua-bridge-is-tested-by-a-harness-under-lua-5-4-and-reaper-api-behaviour-is-checked-in-reaper.md), `integrations/reaper/tests`) proves each command's logic, refusals and events against a fake REAPER. It cannot prove what REAPER itself does with a call. This pass checks that, command by command, in a real REAPER. The calls and what the reference leaves open are in [the ReaScript calls behind the planned commands](../research/reaper-api-for-planned-commands.md).

## Rules (owner decision D3)

- REAPER runs isolated: `integrations/reaper/spikes/run-reaper.ps1` starts it with `-cfgfile <temp>\reaper.ini`, so the owner's settings, scripts and projects are never read or written ([the spike rules](../../integrations/reaper/spikes/README.md)).
- Only a **copy** of a project is opened, in a temp folder, with its media copied beside it or replaced by synthetic tones (`make_media.py`). Never open, save into or delete anything under `C:\Users\Count\Documents\REAPER Media\Projects\Challenges\`. Record the original `.rpp`'s SHA-256 before and after, as spike S6 did.
- Part A runs unattended with the audio device closed (`reaper.Audio_Quit()`). Part B records, so it needs the owner present and their approval for the one test recording on a copy (D28), with a silent or virtual input.
- The script loads the real bridge from the working tree (`NARRATION_UTILS_REAPER_DIR`) and drives each command through a fresh registry, the way `navigation_check.lua` does, writing `PASS`/`FAIL` per step and every value it read back into the report. The report goes into `integrations/reaper/spikes/results/` with paths removed, and its findings into this page's record.
- Record REAPER's version and the OS. A finding that differs from the harness's fake changes the fake in the same PR, so the harness keeps modelling what REAPER does.

## Part A: unattended, no audio device

### Running it

One command, from the repository root on the owner's Windows machine with REAPER installed (`C:\Program Files\REAPER (x64)\reaper.exe`), Python and PowerShell 7:

```powershell
pwsh integrations/reaper/spikes/run-pass-part-a.ps1
```

It takes about two minutes and needs no input: it starts REAPER twice, each time isolated on its own scratch `-cfgfile` under a fresh `%TEMP%\narration-pass-a-<time>` folder, and closes each session after five minutes at most (`-TimeoutSec`). The first session runs `spike_ep0_workspace.lua` (rows A6 to A8b); the second runs `pass_part_a.lua` (every other row) and merges the first one's report. The results land in `%TEMP%\narration-pass-a-<time>\main\pass-part-a-results.md` (the table to paste into [#510](https://github.com/countrymanprime/narration-utils/issues/510)) and `pass-part-a-log.txt` (every check and value), with paths removed, and both are copied to `integrations/reaper/spikes/results/`. The last line it prints is the pass count and the path.

What keeps it safe:

- It opens no project of the owner's. Each session builds its scratch project from `make_media.py`'s tones and saves it in the scratch folder; every file it writes goes through a guard that refuses anything outside the scratch `-Out` and `-Cfg` folders or under a `REAPER Media` folder, and the wrapper and `run-reaper.ps1` refuse a scratch folder outside `%TEMP%`.
- It stops before touching anything unless REAPER's resource path is the scratch `-Cfg` and the audio device is closed.
- It never records: `CSurf_OnRecord` is replaced by a counter before the bridge loads, so a `record_start` that should have been refused fails A5 instead of recording. The steps that need a recording are Part B's (B9). Playback (A3, A5, A9b) runs with the device closed, so nothing is heard or captured.
- It drives the real bridge from the working tree through the same file protocol the Go host uses, so a check reads what the app would see.

The driver's logic is proved against the harness's fake before it reaches REAPER: `tests/pass_part_a_test.lua` runs every row it scripts against the fake and requires each to pass (and a broken `select_track`, a changed witness track or a record request to fail), and `tests/pass_part_a_script_test.lua` runs `pass_part_a.lua` itself end to end on the fake with the REAPER-only calls stood in. A check the fake cannot model (undo, the arrange view) is reported as not run there, never as passed.

A row passes when every check under it passes. A step Part A cannot take (one that needs a recording) is listed as not run and moved to Part B; it does not fail the row. A value the page says to record (what Undo undid, the play-position gap, whether arming moves `changeCount`) is listed under "Recorded values".

### The rows

The scratch project has three tracks ("Chapter 1", "Chapter 2", "Pickups"), `make_media.py`'s tones as items on "Chapter 1" (one item with two takes at 0 s, one trimmed to start 0.5 s into its source at 4 s, one at play rate 1.5 at 8 s, and a 3 s item at 12 s for the cleanup rows), one item on "Chapter 2", and one region ("Fixture region", 20 to 25 s). It is saved once and reopened from the scratch folder, so its undo history starts empty. Rows A6 to A8b use their own scratch project and chain files (`Test EQ.RfxChain`, one ReaEQ, under `<cfg>\FXChains\Voice\`), built by `spike_ep0_workspace.lua`.

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
| A9b | `play_position` | With the transport stopped and the cursor at 2.5 s; then while playing from 1 s, twice 0.5 s apart; then while recording (Part B, B9). | `PLAY_POSITION` state 0 with both positions and the cursor at 2.500000; while playing, state 1 and both positions move, `processed` ahead of `heard` by about the output latency (record the gap); state 5 while recording. No undo point. |
| A9c | `punch_to` | Send 42.5 with pre-roll 3; then 1.25 with pre-roll 3; then 42 while recording (Part B, B9); then a pre-roll of 11. | The edit cursor is at 39.5 and in view, playback not started; then at 0; the recording and the bad pre-roll are refused with their `ERROR` messages and the cursor does not move. No undo point. |
| A10 | Nothing else changed | Diff the project's state chunks (every track and the master) and its markers and regions before and after each row, leaving out only what the row is meant to change: arms for A4 and A5, the selection for A11, the markers and regions for A9, "Chapter 1" for A12 to A14, and the markers for A4 (its Undo removes A1's marker). | No other track, item, marker or project setting changed. |
| A11 | `select_track` | Select "Chapter 2" and "Pickups" by hand; send `select_track` for "Chapter 1"; then for an unknown GUID; then with no GUID. | `TRACK_SELECTED` names "Chapter 1" and only "Chapter 1" is selected; no undo point. The unknown GUID and the empty one answer `TRACK_STALE` only, and "Chapter 1" stays the only selected track. |
| A12 | `preview_cleanup_markers` | Write a candidate list: a silence from 1.0 to 1.5 s of source time on the 12 s item (its take named), a row for an unknown item, and a row from 2.8 to 3.6 s (past the item's end). Send it; send it again; press Undo. | `CLEANUP_PREVIEWED` 2 added, 0 existing; `CLEANUP_STALE` `item` for the unknown row and `range` for the one past the end; take markers `CLEANUP_SILENCE_START: f1` at 1.0 and `CLEANUP_SILENCE_END: f1` at 1.5 s of source time; one undo point "Narration Utils: preview cleanup markers"; the item's position, length and the track's item count unchanged. The second send adds none (0 added, 2 existing) and makes no undo point (`changeCount` unchanged). Undo removes both markers. |
| A13 | `apply_cleanup_trims` (silence trim) | Send the 1.0 to 1.5 s row alone; then a list whose only row names an unknown item; press Undo. | `CLEANUP_APPLIED` 1; the track has one item more: the 12 s item keeps its GUID and is 1.0 s long, and a new piece starts at 13.5 s, 1.5 s into the source, 1.5 s long (no ripple, so the gap stays); one undo point "Narration Utils: apply cleanup trim"; the source file's size on disk is unchanged. The unknown item answers `CLEANUP_STALE` `item` and `CLEANUP_APPLIED` 0 with no undo point. Undo rejoins the item (3 s, the item count back). |
| A14 | `apply_item_gain` | Send `-6` dB for the play-rate-1.5 item; then `+6` dB for it; press Undo; then `-3` dB for an unknown item. | `GAIN_ITEM` from 1.000000 to 0.501187 and `GAIN_APPLIED` 1; `D_VOL` reads back 0.501187; one undo point "Narration Utils: apply level-match gain"; no other item's volume changed. The `+6` multiplies back to about 1.0 (a narrator's own trim is kept, not overwritten); Undo puts back 0.501187. The unknown item answers `GAIN_STALE` `item` and `GAIN_APPLIED` 0 with no undo point. |

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
| B7 | Which microphone REAPER uses (teleprompter PRD Phase 11, [ADR 0250](../adr/0250-the-teleprompter-preselects-reapers-microphone-only-on-a-sure-match-of-its-device-name.md)) | With the device open in REAPER, open the app's microphone picker (`TeleprompterReaperInput`); repeat with ASIO and with WASAPI if both are available. | `matched` selects the microphone REAPER records from, or `uncertain` names that interface's inputs; never a different device. Record REAPER's `IDENT_IN` name and the teleprompter's device list for each driver type, and add any pair that does not match as a case in `internal/daw/inputmatch_test.go`. |
| B8 | The same microphone in REAPER and the app | With REAPER recording or monitoring the device, open the microphone popover's level meter (`TeleprompterMeterStart`, [ADR 0247](../adr/0247-the-input-level-comes-from-the-sidecars-own-capture-and-a-model-free-meter-child-runs-before-start.md)), then start a reading. | The meter moves with the owner's voice and the reading follows, or the open fails and `meter_stopped` or the session's error says why (REAPER holding the device exclusively). REAPER's own recording is never interrupted. Record which drivers share the device. |
| B9 | `play_position` and `punch_to` while recording (the recording steps of A9b and A9c, which Part A cannot take) | During B2's recording, send `play_position`; then `punch_to` 42 with pre-roll 3. | `PLAY_POSITION` state 5 with both positions moving; `punch_to` is refused with "REAPER is recording. Stop it before moving to a word." and the cursor does not move. |

## Switching a command on

A command passes when every row that names it passes and the report is recorded. The rows each Experimental capability (`declares` in `apps/desktop/internal/dawport/reaper/reaper.go`) needs, besides A10 for every row that writes:

| Capability | Commands | Rows |
| --- | --- | --- |
| `track_state` | `chapter_track_state` | A1, A2, A3 |
| `track_select` | `select_track` | A11 |
| `record` | `arm_only`, `record_start`, `record_stop` | A4, A5, B1 to B6 |
| `punch` | `play_position`, `punch_to` | A9b, A9c, B9 |
| `regions` | `create_regions` | A9 |
| `takes` | `set_active_take` | A6 |
| `fx_chains` | `list_fx_chains`, `list_fx`, `apply_fx_chain`, `add_take_fx` | A7, A8, A8b |
| `silence_trim` | `preview_cleanup_markers`, `apply_cleanup_trims` | A12, A13 |
| `item_gain` | `apply_item_gain` | A14 |

Then, in one PR:

1. Record the run here (a "Verification record" section: date, REAPER version, OS, the report, every value that differed from the fake) and correct the fake to match.
2. Take the command off the host's experimental list (`experimentalCommands` in `apps/desktop/internal/bridge/actions.go`) and move its capability's declaration in `apps/desktop/internal/dawport/reaper/reaper.go` to Supported, in the same PR ([ADR 0400](../adr/0400-promoting-a-reaper-command-from-experimental-to-supported-is-a-one-line-daw-port-declaration-change.md)), so it no longer needs to be turned on. A command whose row failed stays on the list, and its PRD phase stays partial, with the finding on the phase.
3. Set the PRD phases the command completes to `complete`, and update the threat model rows that say "pending" for it.

When every command is off the list, the switch has nothing left to gate; the PR that empties the list removes the switch and its `config/defaults.json` default.

## Pending owner steps

Tracked on the [owner queue, #510](https://github.com/countrymanprime/narration-utils/issues/510): run Part A (`pwsh integrations/reaper/spikes/run-pass-part-a.ps1`, about two minutes, unattended) and paste `pass-part-a-results.md` into #510; be present for Part B and approve its one test recording on a copy of a project.
