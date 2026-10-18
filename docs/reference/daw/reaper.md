# REAPER: what the app relies on

Engine facts the REAPER adapter depends on, as of 2026-10-12. The last version a scripted run was made on is REAPER 7.80 ([spike S6](../../research/reaper-spike-s6-daw-reachability.md)). Each fact names where it was found. A fact with no run behind it says so.

## How the app reaches REAPER

- **A file protocol, not a server.** The Lua bridge polls a `commands/` folder from a `reaper.defer` loop and appends results to `events.log`. There is no loopback port ([the bridge](../../architecture/reaper-bridge.md#the-file-protocol), [The DAW port](../../architecture/daw-integration.md#the-daw-port)).
- **One action starts everything.** The narrator imports `NarrationStudio_Launcher.lua` into REAPER's action list. It starts the app with the session folder, project and `--daw REAPER` ([DAW integration](../../architecture/daw-integration.md#reaper-rules)). `NarrationUtils_Launcher.lua` stays as a three-line shim that runs the new file, so an action a narrator loaded before the rename keeps working; both write sessions under `<REAPER resource path>/NarrationStudio/sessions`, and a session folder left under `NarrationUtils/sessions` is unused. The shim, its entries in the release and smoke lists, and the legacy projects-folder fallback (`project.LegacyDefaultDirName`) go when the `NarrationUtils` name is retired (#1816).
- **The Lua can be older or newer than the app.** The narrator imports it, so a request the older script cannot serve comes back to the narrator as the host's `script_outdated` refusal, and `ping` reports whether the script knows the navigation commands ([going to and looping a finding](../../architecture/reaper-navigation.md)).
- **The saved project needs no running REAPER.** The Go `tracks` package parses the `.rpp` directly ([Tracks](../../utilities/tracks.md)).
- **The app can find and start REAPER.** It reads the Windows Uninstall registry key and falls back to the `.rpp` file association. REAPER 6.80 and later run a script given as a startup argument with the project already open, confirmed on REAPER 7.80 ([locate.go](../../../apps/desktop/internal/daw/locate.go)).

## Behaviour that a fake cannot prove

The harness runs the bridge against a fake `reaper` table under Lua 5.4 ([The DAW port](../../architecture/daw-integration.md#the-daw-port)). These facts come from runs in REAPER:

| Fact | Where it was found |
| --- | --- |
| Item extension data written under a namespaced key survives save and reload; what it does on split and copy is recorded there | [Spike S0](../../research/reaper-spike-s0-item-extension-data.md) |
| Render settings keys, the predicted render targets, and what a render needs to run | [Spike S5](../../research/reaper-spike-s5-render-details.md) |
| Which launch paths reach a running REAPER, and the heartbeat mechanism | [Spike S6](../../research/reaper-spike-s6-daw-reachability.md) |
| Fixed-lane semantics: which lane plays, and the exclusive, with-others and silent modes | [Spike S7](../../research/reaper-spike-s7-fixed-lanes.md) |

## What REAPER was seen to do

Every row was observed in REAPER 7.80/x64 on Windows, scripted, in an isolated resource directory; another version may differ. The source note holds the method and the fixture. The harness's fake must agree with these rows: `integrations/reaper/tests/fake_fidelity_test.lua` pins them, and a run that shows the fake is wrong corrects that test first.

| Area | What REAPER does | Source |
| --- | --- | --- |
| Item identity | `GetSetMediaItemInfo_String(item, 'GUID', '', false)` returns the item's GUID, upper case in braces. In a saved `.rpp` the item's own GUID is `IGUID`; each take has a `GUID`. | [S0](../../research/reaper-spike-s0-item-extension-data.md) |
| Stale pointers | Undo and redo replace REAPER's item objects, so an item is looked up by GUID again afterwards. A `MediaItem` held across an undo is stale, and an item found by position or time may be a different one. | S0 |
| `P_EXT` | A missing key reads `false, ''`. A set returns `true, value`. It is stored in the `.rpp` (`<EXTI` on an item, `<EXT` on a take, key without the `P_EXT:` prefix) and survives save and reload. Split: both halves keep it (the right half gets a new GUID). Duplicate and a state-chunk copy keep it. Undo removes a stamp exactly and redo restores it. | S0 |
| Not exercised | REAPER's clipboard actions (copy and paste items) do nothing when driven headless, so a real paste is a manual check, pending with the owner. | S0 |
| Undo | A change wrapped in `Undo_BeginBlock2(0)` / `Undo_EndBlock2(0, label, -1)` is one undo step. A read makes none. A command that finds nothing to change opens no block. | [S7](../../research/reaper-spike-s7-fixed-lanes.md), [planned commands](../../research/reaper-api-for-planned-commands.md) |
| Markers and regions | Numbered separately. `EnumProjectMarkers3` is enumerated by time and returns index plus one as its first value. A region is two `MARKER` lines in the file. | S0, `fake_fidelity_test.lua` |
| Fixed lanes | `I_FREEMODE=2` turns lanes on, but the API alone leaves the track half set up; a new item lands in lane 0; `I_FIXEDLANE=N` grows the track to N+1 lanes and it never shrinks. `C_LANEPLAYS:N` is 0 silent, 1 plays exclusively, 2 plays with others. `I_FREEMODE=0` puts every retake in one lane and plays them all at once. | S7 |
| Lanes and line ids | Converting takes to lanes and adding comp areas copy the item's `P_EXT` onto new items, so a line id no longer names one item on a lane track. The app never sets `I_FREEMODE` or converts takes and lanes ([Tracks](../../utilities/tracks.md)). | S7 |
| Render | `$region` in `RENDER_PATTERN` with "all regions" bounds names one file per region, and `RENDER_TARGETS` read before rendering predicts the same paths. `Render_Execute` and `Render_EnumerateOutputMode` do not exist (`APIExists` is false). The `RENDER_STATS` getter is not safe to poke with an arbitrary action ID. Fifteen cited action IDs resolved (1013, 1016, 40044, 42230, 42437 and others; the table is in S5). | [S5](../../research/reaper-spike-s5-render-details.md) |
| Transport | `GetPlayState()` is a bit field: 1 playing, 2 paused, 4 recording, read with arithmetic (`math.floor(state / 4) % 2`) since the Lua subset has no bit operators. `GetPlayPosition()` moves while recording and answers 0 just after Stop. A `defer` loop ticks about 30 times a second. Desk research, not a REAPER run. | [transport timing](../../research/reaper-transport-timing.md) |
| Active project | `EnumProjects(-1, '')` returns the active tab's `.rpp`, and the exact empty string for an unsaved project. | [S6](../../research/reaper-spike-s6-daw-reachability.md) |
| Startup | `reaper.exe -cfgfile <cfg> "<project.rpp>" "<script.lua>"` runs the script at startup with the project already open. | S6 |

## Documentation and research, not run in REAPER

| Subject | Page |
| --- | --- |
| How far the play position the narrator hears trails the position REAPER processes: what the scripting community knows, to be measured by row A9b of the verification pass | [Transport timing](../../research/reaper-transport-timing.md) |
| The ReaScript calls behind each planned command, from the documentation and cross-checked against five third-party REAPER MCP servers read for approach only | [ReaScript calls](../../research/reaper-api-for-planned-commands.md) |
| A survey of the wider automation surface | [Automation surface](../../research/reaper-automation-surface.md) |

## Media sources and recording

From REAPER's API documentation, changelog and Cockos developers' forum answers, read on 2026-10-12; not run in REAPER. The one-step checks that would confirm each are in [#1476](https://github.com/countrymanprime/narration-utils/issues/1476).

| Subject | What REAPER does | Source |
| --- | --- | --- |
| A take being recorded | Newly recorded items are added to the project only when recording stops; while recording they do not exist to the API. A track-state read lists the track's earlier items only. | [Cockos forum, developer answer, 2015](https://forum.cockos.com/showthread.php?t=169173) |
| Recording path | A recording is written to the project's primary (and optionally secondary) recording path, relative or absolute. An unsaved project uses the default path from Preferences > Paths. | [Recording paths guide](https://www.reaper.fm/guides/reaper_recpath_guide.pdf) |
| Section and reverse sources | `PCM_Source_GetSectionInfo(src)` returns `ok, offset, length, reverse` for a section or reverse source (REAPER 4.40 and later). | [ReaScript API](https://www.reaper.fm/sdk/reascript/reascripthelp.html) |
| Their file name | `GetMediaSourceFileName` returns an empty string for a section or reversed source up to REAPER 7.55; 7.56 fixed it. What it returns from 7.56 on has not been run. | [bug report](https://forum.cockos.com/showthread.php?t=305264), [7.56 changelog](https://forum.cockos.com/showthread.php?t=305390) |

What the bridge does with these: `narration_track_state.lua` reads `GetMediaSourceFileName` on the take's source and reports no section, reverse or stretch-marker data, so Go takes them from the saved `.rpp` (`liveEndAt` in `apps/desktop/resumelive.go`). A take recorded or sectioned since the last save is therefore read as a plain source, and neither path handles a reversed take; tracked in [#1476](https://github.com/countrymanprime/narration-utils/issues/1476).

## Takes

- **A take carries its provenance in `P_EXT`.** `narration_utils_take_finding_id`, `narration_utils_take_source_file` and `narration_utils_take_source_range` record which finding produced the take, the candidate's source file and the matched range in it; never item notes or take names.
- **Hide is a volume of 0, not a mute.** ReaScript has no per-take mute, so `hide_takes` saves a take's `D_VOL` in its `P_EXT` (`narration_utils_take_hidden_volume`) and sets `D_VOL` to 0; keeping that take later gives the volume back. Nothing is deleted ([the bridge](../../architecture/reaper-bridge.md#commands)).
- **Undo.** The hide is one undo block, labelled "Narration Utils: hide other takes"; nothing to hide opens none. That one REAPER Undo brings every hidden take back is what the harness models, not a run.
- **Checked:** not checked; expected result is row C1 of [the verification pass](../../operations/reaper-verification-pass.md#part-c-the-studio-next-daw-commands-not-scripted-yet). The owner's run confirms that a take at `D_VOL` 0 is silent with "play all takes" on and off, that the `P_EXT` key is saved with the project, that clearing it with an empty value leaves no stale key that reads as hidden, and that one Undo restores every take's volume and the active take.

## Roll

- **What it does.** `roll` stops the recording the app started, moves the edit cursor to the roll time and records again with `CSurf_OnRecord`, so the new pass overlaps the earlier one ([DAW capabilities: what each one is and what it returns](capabilities.md) point 1). A recording is not an item until it stops ("Media sources and recording" above), so the earlier pass can only become a take once it is stopped.
- **The setting it reads.** REAPER's Options > "New recording that overlaps existing media items" is bits 4 and 8 of the `autoxfade` config variable: both clear "Splits existing items and creates new takes" (the default), 4 "Trims existing items behind new recording (tape mode)", 8 "Creates new media items in separate lanes" ([Ultraschall's list of REAPER config variables](https://raw.githubusercontent.com/Ultraschall/ultraschall-lua-api-for-reaper/Ultraschall-API-4.5/ultraschall_api/Documentation/Reaper_Config_Variables.html), REAPER 6.56; desk research, not run). The command reads it with `get_config_var_string('autoxfade')` and refuses in the other two settings, naming them; it never writes it. It refuses a fixed-lane track, where a new pass lands in a lane rather than a take (spike S7, the Fixed lanes row above) and the app never changes lanes ([Tracks](../../utilities/tracks.md)).
- **Undo.** The command opens no undo block and reports 0; the points REAPER adds for the recorded media are REAPER's.
- **Checked:** not checked; expected result is row C2 of [the verification pass](../../operations/reaper-verification-pass.md#part-c-the-studio-next-daw-commands-not-scripted-yet). The QA pass ([#1495](https://github.com/countrymanprime/narration-utils/issues/1495)) confirms that `get_config_var_string` returns `autoxfade` as its decimal value and that the bits mean the same in REAPER 7; that `GetPlayState` reads stopped right after `OnStopButton`, so the record press restarts rather than stops; that the earlier pass becomes a take of an item the new pass overlaps, with nothing deleted; how many undo points a roll leaves; and that a roll at the current record position behaves.

## Range cut

- **What it does.** `delete_range` splits the named item at the range's end and then its start with `SplitMediaItem`, which leaves the left part as the original item and returns the right, and moves the middle piece with `MoveMediaItemToTrack` to the Cuts track ([DAW capabilities: what each one is and what it returns](capabilities.md) point 2). Mode `close` moves the later items on that track up by the cut's length with `D_POSITION`; `gap` moves nothing and leaves silence. The fade goes on the new seams (`D_FADEOUTLEN` of the left piece, `D_FADEINLEN` of the right). Nothing is deleted.
- **Pad and room tone.** A pad moves both ends of the range inward before the split. Room tone (`gap` only) is read with `EnumProjectMarkers3`: the first region named "Room tone" (any case) lying inside an item on the cut item's track and clear of the cut. Before the undo block, a source per piece is opened from that item's file with `PCM_Source_CreateFromFile` (a path read from the project, never sent by the host); inside it, each piece is a new item (`AddMediaItemToTrack`, `D_POSITION`, `D_LENGTH`), a take (`AddTakeToMediaItem`, `SetMediaItemTake_Source`) playing from the region's offset (`D_STARTOFFS`, and `D_PLAYRATE` when the marked take's is not 1), the seam fade at both edges and `P_EXT:narration_utils_room_tone` set. At most 64 pieces; a shorter stretch is refused.
- **The Cuts track.** Found by the track key `P_EXT:narration_utils_cuts` (`GetSetMediaTrackInfo_String`), else by the name Cuts, else added after the last track with `InsertTrackAtIndex` and named with `P_NAME`. `B_MUTE` is set to 1 whenever it reads otherwise. The calls are the ReaScript reference's ([Ultraschall's copy](https://github.com/Ultraschall/ultraschall-lua-api-for-reaper/blob/master/ultraschall_api/Documentation/Reaper_Api_Documentation.html); not run).
- **Undo.** One block, "Narration Utils: delete words", around the splits, the track, the move and the close-up; the answer reports 1.
- **Checked:** not checked; expected result is row C3 of [the verification pass](../../operations/reaper-verification-pass.md#part-c-the-studio-next-daw-commands-not-scripted-yet). The QA pass ([#1495](https://github.com/countrymanprime/narration-utils/issues/1495)) confirms that the splits, the move to another track and the close-up in one block are one undo step and that one Undo gives the item back whole; that a track's `P_EXT` survives save and reload (if not, the name finds the track); what fades REAPER gives the pieces at a split, and that the seam fades set afterwards replace them; and that the piece on the muted Cuts track is silent and keeps its take and source. For a pad and room tone (SN-E97): that a pad cuts less at each end, that each room-tone item plays the marked stretch from its offset, and that the room tone is in the cut's one undo step.

## Chain on a range

- **What it does.** `apply_fx_range` splits the named item at both ends of the range as `delete_range` does and adds a saved chain to the middle piece's active take with `TakeFX_AddByName(take, path, -1)` ([DAW capabilities: what each one is and what it returns](capabilities.md) point 3). The path is built from `GetResourcePath()` and the chain's name as `list_fx_chains` lists it, after `EnumerateSubdirectories` and `EnumerateFiles` (each cleared with index -1 first) list every part of it; the GUIDs of the FX it added (`TakeFX_GetFXGUID`) and the chain's name go in the take's `P_EXT`. The fade goes on the new seams (`D_FADEOUTLEN` and `D_FADEINLEN`).
- **Removing it.** `remove_fx_range` deletes the recorded FX with `TakeFX_Delete`, highest index first, clears the take's `P_EXT`, and joins the piece to each piece the apply split off (their GUIDs are in the take's `P_EXT`) that still carries on its audio, compared by source, rate, offset, item and take volume, mute, active take and FX names (`TakeFX_GetFXName`): the first piece's `D_LENGTH` is set over the others, its `D_FADEOUTLEN` to the last piece's, and the folded pieces are removed with `DeleteTrackMediaItem`. The calls are the ReaScript reference's ([Ultraschall's copy](https://github.com/Ultraschall/ultraschall-lua-api-for-reaper/blob/master/ultraschall_api/Documentation/Reaper_Api_Documentation.html); not run).
- **Undo.** One block each, "Narration Utils: add chain to range" and "Narration Utils: remove chain from range"; the answer reports 1, and a removal that finds nothing opens no block and reports 0.
- **Checked:** not checked; expected result is rows C4 and C5 of [the verification pass](../../operations/reaper-verification-pass.md#part-c-the-studio-next-daw-commands-not-scripted-yet). The QA pass ([#1495](https://github.com/countrymanprime/narration-utils/issues/1495)) confirms that `TakeFX_AddByName` loads a `.RfxChain` onto a take by its full path, appends its FX at the end and how many; that the splits and the load are one undo step and one Undo gives the item back whole; that a split copies a take's FX, whether the copies get new FX GUIDs, and whether it copies its `P_EXT`; that the join plays the same audio with no click at the old seams; and that the removal and the join are one undo step.

## Stacking takes

- **What it does.** `stack_takes` adds a take to the first read's item with `AddTakeToMediaItem` for each later read, gives it a source from the read's file (`PCM_Source_CreateFromFile`, `SetMediaItemTake_Source`) and the read's `D_STARTOFFS`, records the read's item, take and track GUIDs, start and offset in the take's `P_EXT`, moves the read's item to the Cuts track with `MoveMediaItemToTrack`, and moves the later items on the track with `D_POSITION` ([DAW capabilities: what each one is and what it returns](capabilities.md) point 4). It never calls `SetActiveTake`: the take-mechanics spike saw `AddTakeToMediaItem` leave the active take and `D_LENGTH` as they were, so a read longer than the first read is refused.
- **Un-stacking.** `unstack_takes` reads the item's state with `GetItemStateChunk`, drops the `TAKE` section (from its `TAKE` line to the next one or the item's closing `>`) of each take whose `GUID` line names a stacked take, writes it back with `SetItemStateChunk`, makes the kept take active again by GUID, and moves the reads back with `MoveMediaItemToTrack` and `D_POSITION`. A stack goes back whole: an un-stack that leaves a stacked take on the item is refused, and so is a stack onto an item that already carries stacked takes. REAPER's own "Take: Delete active take from items" asks the narrator to confirm ([the REAPER accessibility wiki's list of editing actions](https://reaperaccessibility.com/wiki/Translations:Basic_editing/21/en)), so a script cannot use it.
- **Undo.** One block each, "Narration Utils: stack takes" and "Narration Utils: unstack takes"; the answer reports 1. A request that is refused opens no block.
- **Checked:** not checked; expected result is rows C6 and C7 of [the verification pass](../../operations/reaper-verification-pass.md#part-c-the-studio-next-daw-commands-not-scripted-yet). The QA pass ([#1495](https://github.com/countrymanprime/narration-utils/issues/1495)) confirms that a stack with moves to another track is one undo step and one Undo gives every read back; that the new take plays the read's audio from the first read's start; that a take's `P_EXT` and source survive save and reload; that `SetItemStateChunk` without a take's `TAKE` section removes only that take and keeps the active take and the item's GUID; and that an un-stack is one undo step.

## Playing and showing a file on disk

From the reference text, read on GitHub on 2026-10-12 because `reaper.fm` and `sws-extension.org` are not reachable from a cloud session; not run in REAPER.

| Subject | What the reference says | Source |
| --- | --- | --- |
| `CF_CreatePreview(source)` (SWS) | Creates a preview object that does not take ownership of the source. It is destroyed at the end of a defer cycle once playback finished, playback was never started with `CF_Preview_Play`, or its output track is gone. | [SWS `ReaScript.cpp`](https://github.com/reaper-oss/sws/blob/master/ReaScript.cpp) |
| `CF_Preview_SetValue`, `CF_Preview_GetValue` (SWS) | Attributes include `B_LOOP` (seek to the start at the end of the source), `D_POSITION` (the current playback position), `D_LENGTH` (read only: the source's length times the rate) and `I_OUTCHAN` (the first hardware output channel). | the same |
| `CF_Preview_Play`, `CF_Preview_Stop` (SWS) | Play starts the configured preview; Stop "stops and destroys" it. | the same |
| `OpenMediaExplorer(mediafn, play)` | Opens the file in the Media Explorer; `play` true plays it (or toggles playback), false "will just select it". | [REAPER SDK `reaper_plugin_functions.h`](https://github.com/justinfrankel/reaper-sdk/blob/main/sdk/reaper_plugin_functions.h) |
| `PCM_Source_Destroy(src)` | Deletes a source; remove any project reference to it first. | the same |

What the bridge does with these: `narration_media_file.lua` ([capabilities](capabilities.md#file_preview)). What a run must confirm is rows C10 and C11 of [the verification pass](../../operations/reaper-verification-pass.md#part-c-the-studio-next-daw-commands-not-scripted-yet).

## Not yet available

`backups` is in the catalogue but not yet available with REAPER: the bridge has no command for it ([capabilities](capabilities.md#backups)).

## Version rules

- **Lua 5.4 subset.** No `goto`, no integer division, no bit operators: the code must run in REAPER 7's Lua and in the harness ([reaper-command-add](../../../.claude/skills/reaper-command-add/SKILL.md)).
- **An older REAPER may lack a function.** The narrator imports the Lua, so it can run on an older REAPER than the app expects. A command that needs a call newer than REAPER 6 checks `reaper.APIExists('Name')` first and answers with an error event rather than a nil call; the fake can remove a function (`remove_api`) to model it.
- **Versions tested.** Only REAPER 7.x has been run. Whether the bridge works on another major version has not been checked.

## Checking a capability in REAPER

[The REAPER verification pass](../../operations/reaper-verification-pass.md) is the procedure: Part A runs unattended on a copy of a project with an isolated `-cfgfile`, Part B needs the owner and an audio device. A command moves from Experimental to Supported only after the owner's pass ([The REAPER verification pass](../../operations/reaper-verification-pass.md)). The expected result of each row is in [capabilities](capabilities.md) and in the pass's own table.
