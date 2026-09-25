# The ReaScript calls behind the planned REAPER bridge commands

**Status: desk research, 2026-09-24. Nothing here has been run in a real REAPER.** Owner decision D38 ([implementation plan](../prds/implementation-plan.md), section 6) asks that every new bridge command of stack S28 have its ReaScript calls written down from the API reference before it is built, and that the commands ship behind the "Experimental REAPER actions" Settings switch until the owner and Claude run the [verification pass](../operations/reaper-verification-pass.md) on a copy of a test project. This page is that record: for each planned command, the calls it makes, what the reference says each one does, and what only a running REAPER can settle.

**Source.** The ReaScript reference REAPER generates (`reascripthelp.html`, Help > ReaScript documentation), read through the Ultraschall project's rendered copy for REAPER 7.38 ([`Reaper_Api_Documentation.html`](https://github.com/Ultraschall/ultraschall-lua-api-for-reaper/blob/master/ultraschall_api/Documentation/Reaper_Api_Documentation.html)), because `reaper.fm` was not reachable from the build environment. The owner's REAPER is 7.80 ([spike S6](reaper-spike-s6-daw-reachability.md)); every call below exists in 7.38, and the verification pass records what 7.80 does. Quotations are the reference's own words. Where the reference says nothing about a behaviour the command depends on, the row says so and the verification pass has a step for it.

**Conventions every command keeps** ([the REAPER bridge](../architecture/reaper-bridge.md)): one handler per command name in a `narration_<feature>.lua` file; the run ID is the first argument and the first field of every event; a command that changes the project does it in one `Undo_BeginBlock2(0)`/`Undo_EndBlock2(0, label, -1)` pair and changes nothing when there is nothing to change; an item, take or track is found by its GUID and a GUID that does not resolve is reported, never replaced by a neighbour; nothing is changed while REAPER is recording unless the command is about recording. Files use only Lua 5.1-compatible syntax (no bitwise operators), as the existing feature files do.

## Calls shared by several commands

| Call (Lua) | What the reference says | Used by |
| --- | --- | --- |
| `integer playstate = reaper.GetPlayState()` | "Either bitwise: &1=playing, &2=pause, &4=is recording, or 0, stop; 1, play; 2, paused play; 5, recording". Read with arithmetic (`math.floor(state / 4) % 2`), as `narration_navigation.lua` already does. | all |
| `integer count = reaper.CountTracks(ReaProject proj)` and `MediaTrack tr = reaper.GetTrack(ReaProject proj, integer trackidx)` | Counts "the tracks in the project, excluding the master-track"; `GetTrack` is zero-based, `proj` 0 is the active project. | `chapter_track_state`, `arm_only`, `record_start` |
| `string GUID = reaper.GetTrackGUID(MediaTrack tr)` | "Get the guid of a MediaTrack". Compared after the same brace-and-case normalisation the item GUIDs get. | `chapter_track_state`, `arm_only`, `record_start` |
| `number retval = reaper.GetMediaTrackInfo_Value(MediaTrack tr, string parmname)` / `boolean retval = reaper.SetMediaTrackInfo_Value(MediaTrack tr, string parmname, number newvalue)` | `I_RECARM : int * : record armed, 0=not record armed, 1=record armed`; `I_RECINPUT : int * : record input` (the rendered copy truncates this entry; REAPER's own help describes a negative value as no input and packs the MIDI flag, stereo or multichannel flags and the start channel into the integer, so the bridge reports the integer as it is and the host decodes nothing yet). | `chapter_track_state`, `arm_only`, `record_start` |
| `boolean retval, string guid = reaper.GetSetMediaItemInfo_String(item, 'GUID', '', false)` and `GetSetMediaItemTakeInfo_String(take, 'GUID', '', false)` | Already used by every GUID-based command. | `set_active_take`, `apply_fx_chain` |
| `reaper.Undo_BeginBlock2(ReaProject proj)` / `reaper.Undo_EndBlock2(ReaProject proj, string descchange, integer extraflags)` | "Code after that and before Undo_EndBlock can be undone"; `extraflags` -1 "include all undo states". | every command that changes the project |

## `chapter_track_state` (read-only)

Serves [Read Aloud Resume from the DAW](../prds/read-aloud-resume-from-daw.prd.md) Phase 4, [Read Aloud Control Bar](../prds/read-aloud-control-bar.prd.md) Phase 6 and the command half of [Teleprompter Manuscript Integration](../prds/teleprompter-manuscript-integration.prd.md) Phase 11 (TMI-11). One read of the transport and of one track.

| Call | Reference | What the command reports |
| --- | --- | --- |
| `GetPlayState()` | above | `playState`, the raw bit field |
| `number position = reaper.GetCursorPosition()` | "edit cursor position", in seconds | `editCursor` |
| `number playposition = reaper.GetPlayPosition()` | "returns latency-compensated actual-what-you-hear position" (`GetPlayPosition2` is "position of next audio block being processed") | `playPosition`; the what-you-hear call is chosen because the consumers compare it with what the narrator heard. Spike S4 of the follow-through PRD still decides between the two for the workspace's Follow mode. |
| `ReaProject, string projfn = reaper.EnumProjects(-1, '')` | Already proven by spike S6: the active tab's `.rpp`, the empty string when unsaved | `rpp`, `unsaved` |
| `integer count = reaper.GetProjectStateChangeCount(ReaProject proj)` | "returns an integer that changes when the project state changes, e.g. undoable-actions have been made"; "the number of changes, since (re-)opening of the project" | `changeCount` |
| `I_RECARM` over every track | above | `thisArmed` (the named track) and `armedCount` (all tracks) |
| `I_RECINPUT` of the named track | above | `recInput`, the integer |
| `boolean retval, string desc = reaper.GetAudioDeviceInfo(string attribute)` with `IDENT_IN` | "get information about the currently open audio device. Attribute can be MODE, IDENT_IN, IDENT_OUT, BSIZE, SRATE, BPS. returns false if unknown attribute or device not open" | `inputDevice`, empty when the device is closed (TMI-11's device read) |
| `CountTrackMediaItems(track)`, `GetTrackMediaItem(track, i)`, `GetMediaItemInfo_Value(item, 'D_POSITION' / 'D_LENGTH')`, `GetActiveTake(item)`, `GetMediaItemTakeInfo_Value(take, 'D_STARTOFFS' / 'D_PLAYRATE')`, `GetMediaItemTake_Source(take)`, `GetMediaSourceFileName(source, '')` | Already used by `prepare_compare` and `create_take` | one `TRACK_ITEM` per item on the named track: item and active-take GUIDs, position, length, source offset, play rate and source file |

Only a running REAPER can say: whether `GetPlayPosition` moves while paused, what `GetCursorPosition` answers during recording, whether a take that is still being recorded is listed as an item before Stop, whether `GetProjectStateChangeCount` moves on a change that is not undoable (a track arm), and what `GetAudioDeviceInfo('IDENT_IN')` answers for an ASIO device and for WASAPI. The verification pass reads each.

## `changeCount` on the `PROJECT_STATUS` heartbeat

Serves [DAW Chapter-Track Auto-Sync](../prds/daw-chapter-track-auto-sync.prd.md) Phase 4 (and, through it, RF-13 and EL-8). The heartbeat's tick appends `GetProjectStateChangeCount(0)` as a fourth, optional field (`PROJECT_STATUS||<rpp>|<unsaved>|<changeCount>`), once every 1.5 s as today. The reference's description is the only thing it depends on; the verification pass checks the counter moves on an item move, a marker add and a Save, and whether it moves on a track arm.

## `arm_only`, `record_start`, `record_stop` (write; D28)

Serve Read Aloud Control Bar Phase 7. Owner decision D28: arming the chapter's track disarms every other track and remembers which tracks were armed, and restores them when a recording the app started stops; the app only stops recordings it started.

| Step | Call | Reference and what is still open |
| --- | --- | --- |
| Arm one, disarm the rest | `SetMediaTrackInfo_Value(tr, 'I_RECARM', 1 or 0)` over every track | The reference documents the values only. The PRD's evidence says a track arm is **not** in REAPER's undo history, so `arm_only` opens no undo block (an empty undo point would sit between the narrator and their last edit) and remembers the previous arms itself. The pass checks both (no undo point; Undo does not change arms). |
| Refuse while recording | `GetPlayState()` bit 4 | above |
| Start recording | `reaper.CSurf_OnRecord()` | "Toggles recording on and off. Starts recording from edit-cursor-position." It is a toggle, so `record_start` calls it only after it has seen REAPER stopped. The PRD names `Main_OnCommand(1013, 0)` (Transport: Record) as the alternative; `CSurf_OnRecord` is used because it keeps `Main_OnCommand` inside the allow-listed cleanup launcher (threat row 5h). The pass checks it honours the project's record mode and whether `GetPlayState()` reports bit 4 in the same defer cycle; if it does not, `record_start` answers from the next cycle instead. |
| Watch the recording | `reaper.defer(fn)` polling `GetPlayState()` | The bridge already runs a `defer` loop; the transport file adds its own short watch while a recording it started runs, so the previous arms come back when the narrator stops that recording in REAPER too. |
| Stop recording | `reaper.OnStopButton()` | "Stops playing/recording." It follows REAPER's own "prompt to save recorded media" preference; the app never answers that prompt. The pass records what the prompt does to the bridge's defer loop while it is open. |

## `set_active_take` (write)

Serves [Edit and Proof Workspace](../prds/edit-and-proof-workspace.prd.md) Phase 6 (EP7 A, "Use this take").

| Call | Reference |
| --- | --- |
| `reaper.SetActiveTake(MediaItem_Take take)` | "set this take active in this media item" |
| `GetActiveTake(item)`, `CountTakes(item)`, `GetTake(item, i)` | Already used by `create_take` and the navigation file |

One undo block ("Narration Utils: use take"); a take that is already active changes nothing. The pass checks one Undo in REAPER restores the previous active take and that `SetActiveTake` makes no second undo point of its own.

## `list_fx_chains` and `apply_fx_chain` (read, then write)

Serve Edit and Proof Workspace Phases 8 and 9 (EP8 B, EP9 A).

| Call | Reference and what is still open |
| --- | --- |
| `string resource_path = reaper.GetResourcePath()` | "returns path where ini files are stored, other things are in subdirectories". REAPER keeps FX chains in `<resource path>/FXChains`. |
| `string name = reaper.EnumerateFiles(string path, integer fileindex)` and `reaper.EnumerateSubdirectories(string path, integer subdirindex)` | "Use fileindex = -1 to force re-read of directory (invalidate cache). Returns NULL/nil when all files have been listed." The bridge already clears the cache first because REAPER 7.80 caches listings (`narration_bridge_core.lua`); the chain listing does the same for every folder it reads. The reference says the listing is "Ordered by first letter in ascending order"; the bridge sorts anyway. Nothing in the reference says whether a symbolic link or junction is followed. |
| `MediaItem right = reaper.SplitMediaItem(MediaItem item, number position)` | "The original item becomes the left-hand split, the function returns the right-hand split (or NULL if the split failed)". `apply_fx_chain` splits at the passage's end first and then at its start, so the piece in the middle is the second call's return value (or the original item when the passage starts at the item's start). |
| `integer index = reaper.TakeFX_AddByName(MediaItem_Take take, string fxname, integer instantiate)` | "Adds or queries the position of a named FX in a take. See TrackFX_AddByName() for information on fxname and instantiate. This allows also adding .FXChain-files. Just provide the full path+filename to the parameter fxname." `TrackFX_AddByName`: "Specify a negative value for instantiate to always create a new effect … Returns -1 on failure or the new position in chain on success." REAPER saves chains as `.RfxChain`. Whether a chain file with several plug-ins answers the first new index, and whether a missing plug-in inside the chain is reported, is only known from a run (spike SF of the workspace PRD). |
| `integer count = reaper.TakeFX_GetCount(MediaItem_Take take)` | The FX count before and after, so the command reports how many FX the chain added. |

One undo block ("Narration Utils: apply FX chain <name>") holds both splits and the FX add. The chain is resolved by name inside `FXChains` on the Lua side (never a path from the command), and must be one `list_fx_chains` would list. The pass checks one Undo in REAPER rejoins the item and removes the FX, what a split does to the item's take markers and extension data (spike S0 says line ids survive a split), and whether REAPER's default split crossfade changes the passage's edges.

## `create_regions` (write)

Serves the chapter regions of the [REAPER automation follow-through](../prds/reaper-automation-follow-through.prd.md) Phase 7 (RF-7) and [Credits in the Chapter Table](../prds/credits-in-chapter-table.prd.md) Phase 4. It replaces the existing `create_chapter_regions` (`narration_line_identity.lua`, which no host code calls yet) rather than adding a second region command.

| Call | Reference |
| --- | --- |
| `integer index = reaper.AddProjectMarker2(ReaProject proj, boolean isrgn, number pos, number rgnend, string name, integer wantidx, integer color)` | "Returns the shown-number of the created marker/region, or -1 on failure … color should be 0 (default color), or ColorToNative(r,g,b)\|0x1000000". The Ultraschall notes add that it does not create a marker when one with the exact name already sits at that position. |
| `integer retval, boolean isrgn, number pos, number rgnend, string name, integer markrgnindexnumber, integer color = reaper.EnumProjectMarkers3(proj, idx)` | Already used (it answers index plus one) |
| `boolean retval = reaper.SetProjectMarker4(ReaProject proj, integer markrgnindexnumber, boolean isrgn, number pos, number rgnend, string name, integer color, integer flags)` | "Sets/alters an existing project-marker"; "color should be 0 to not change". Used only when the host asks to move a region the app made whose chapter's bounds changed. |

The pass checks one Undo removes every region one call made, and that a region moved by `SetProjectMarker4` keeps its number and colour.

## Cross-check against the REAPER MCP servers

At the owner's suggestion (a comment on PR #513), the five REAPER MCP servers listed in [the automation survey](reaper-automation-surface.md) were read on 2026-09-25 **for approach only**, at these commits: [TwelveTake-Studios/reaper-mcp](https://github.com/TwelveTake-Studios/reaper-mcp) `3e1ec10` (MIT), [shiehn/total-reaper-mcp](https://github.com/shiehn/total-reaper-mcp) `5e87d52` (MIT), [danishaft/reaper-mcp](https://github.com/danishaft/reaper-mcp) `b4c0487` (MIT; now a file-polling Lua bridge like ours, no longer reapy), [yeeking/reaper-mcp-server](https://github.com/yeeking/reaper-mcp-server) `0403762` (MIT, reapy) and [danielkinahan/ReaMCP](https://github.com/danielkinahan/ReaMCP) `670dda4` (GPL-3.0). No code was copied; our architecture (the registry, one Lua file per feature, the harness, the file protocol, the experimental switch) is unchanged.

| Job | What they do | What this stack takes from it |
| --- | --- | --- |
| Start and stop recording | TwelveTake and ReaMCP call `OnRecordButton`/`OnStopButton`; total-reaper calls `CSurf_OnRecord`/`CSurf_OnStop`; danishaft calls `Main_OnCommand(1013, 0)` and refuses unless a track is armed. None waits for `GetPlayState` to report recording, and none uses `GetPlayPosition2`. | `record_start` refuses unless exactly the named track is armed, presses `CSurf_OnRecord` once, and waits up to 30 defer cycles for the record bit instead of reading it once, so a REAPER that reports it a cycle late is not misread as a failure. |
| Arming | Every one sets `I_RECARM` with `SetMediaTrackInfo_Value`; TwelveTake and danishaft wrap it in an undo block, the others do not. | `arm_only` opens no undo block (the PRD's evidence: an arm is not in REAPER's undo history). Recorded as a Proposed decision (ADR 0232, added with the command); the verification pass (row A4) settles it. |
| Active take | Every one calls `SetActiveTake`; danishaft follows it with `UpdateItemInProject(item)` and `UpdateArrange()`. | `set_active_take` does the same. |
| FX | None loads an `.RfxChain` or lists the `FXChains` folder; they add plug-ins by name with `TakeFX_AddByName(take, name, -1)` and danishaft refuses a negative return. | `apply_fx_chain` refuses a negative return and checks `TakeFX_GetCount` grew. Loading a chain by path has no outside precedent, so the verification pass (row A8) is its only evidence. |
| Splitting | danishaft splits the end first, then the start, skips a split within an epsilon of the item's edges, and refuses when `SplitMediaItem` returns nil; TwelveTake reports a nil split. | `apply_fx_chain` does the same, inside its one undo block. |
| Regions | `AddProjectMarker2(0, true, …, -1, color)`; danishaft refuses a negative return and re-reads the region by `EnumProjectMarkers3`. None deduplicates. | `create_regions` refuses a negative return; its deduplication is ours. |
| Edit counter | danishaft reports `GetProjectStateChangeCount` and rejects a plan built at an older count. | The heartbeat and `chapter_track_state` carry the count, so the host can use it the same way before a write. |
| Undo and errors | TwelveTake and danishaft close their undo block on the error path too (`pcall` around the handler). | Every command here validates before `Undo_BeginBlock2` and makes no call that can raise inside the block, and the harness fails a test that leaves a block open. |
| Dialogs | TwelveTake refuses anything that could open REAPER's modal overwrite prompt, because a modal dialog blocks the defer loop. | No S28 command opens a dialog; `record_stop`'s `OnStopButton` can open REAPER's own "save recorded media" prompt, and the verification pass (row B3) records what the bridge's loop does while it is open. |
| Directory listings | TwelveTake clears `EnumerateFiles` with `-1` before each scan and warns that cost grows with the entries. | `list_fx_chains` clears each folder and caps its depth and count. |

## What this page does not cover

Punch-in (`punch_to`, teleprompter PRD Phase 12), the live track list (auto-sync Phase 5, `list_tracks`) and the workspace's play-position feed (Phase 7) are later stacks. Their calls are added here when they are planned.
