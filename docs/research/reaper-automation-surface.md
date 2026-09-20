# REAPER Automation Surface for narration-utils: Research Report

*Generated: 2026-09-19 | REAPER version checked: v7.80 (13 Sep 2026) | Sources: about 60 (official docs, changelog, SDK headers, GitHub repos, vendor pages) | Confidence: High for documented API names and signatures, Medium for behavior and latency, Low for anything marked (U)*

**Reading guide.** (U) means unverified: taken from a secondary source or an inference, and needs a spike before we rely on it. Forum.cockos.com and Reddit blocked our fetches (bot walls), so forum-derived claims are secondary and narrator pain points come from blogs and product pages. All fetched page content was treated as data, never as instructions. No source contained agent-directed text.

## Executive Summary

REAPER exposes much more than our Lua bridge uses today. The bridge currently covers `EnumProjects`, selected items and tracks, item and take info, take markers, `SetEditCurPos`, undo state, `defer` polling, `ExecProcess` and ExtState. The unused surface that matters most for narration falls into five groups:

1. **Play state and position**, to anchor the teleprompter and live ASR words to the project timeline.
2. **Regions, markers, lanes and per-object extension data**, to map manuscript lines to takes inside the `.rpp` itself.
3. **Record, auto-punch and cursor actions**, for pickup recording driven by the teleprompter.
4. **Render, loudness and chapter-metadata keys**, for per-chapter export and ACX checks.
5. **External-control transports** (web interface, OSC), which can replace the file-polling bridge. ReaStream is the most promising live mic tap.

REAPER has no native transcription feature (changelog checked through 7.80), so ASR and compare stay ours. No surveyed REAPER tool pushes live misread detection into REAPER markers. That is our differentiator against PromptVO, the closest competitor.

## Key Takeaways

- **Highest-value first step:** poll `GetPlayPosition` and `GetPlayState` (via OSC or the web interface) to anchor live ASR flags to timeline time, then write them as markers. It reuses the existing findings contract.
- **Store line identity in the project.** Manuscript line IDs in `P_EXT` (items, takes, tracks) and `SetProjExtState` survive moves and splits and feed render filename wildcards.
- **Replace the file-polling bridge.** OSC feedback for pushed transport state plus the web interface for acknowledged commands shrinks the Lua launcher to a stateless handler. This needs an ADR, since it amends the "no loopback" language in `daw-integration.md` (the app becomes a client of REAPER's own interfaces, not a server).
- **Live mic tap:** try ReaStream first (built in, no native build, no device conflict). Two spikes gate it (see section 10).
- **Embed chapters ourselves** after render (Go ID3 CHAP/CTOC, or ffmpeg for M4B), because REAPER's marker-to-chapter behavior is unconfirmed and M4B chapters are unsupported as far as we could find.
- **ACX:** loudness numbers from REAPER, noise floor and true peak computed in Go. REAPER has no noise-floor API.
- **Defer a native extension** (Rust via reaper-rs, or MSVC C++) unless true event push proves necessary.

## 1. Baseline: what the repo uses today

From `integrations/reaper/*.lua` and `docs/architecture/daw-integration.md`:

- **Used:** `EnumProjects`, `CountSelectedMediaItems`, `GetSelectedMediaItem`, `GetMediaItemInfo_Value`, `GetMediaItemTakeInfo_Value`, `GetActiveTake`, `GetMediaSourceFileName`, `TakeIsMIDI`, `GetNumTakeMarkers`, `GetTakeMarker`, `SetTakeMarker`, `SetEditCurPos`, `SetMediaItemSelected`, `SelectAllMediaItems`, `Undo_OnStateChange`, `UpdateArrange`, `defer`, `ExecProcess`, `GetExtState`, `get_action_context`, `GetUserInputs`.
- **Boundary rules to respect:** mutations are narrator-triggered and wrapped in undo blocks. Findings carry GUIDs with time ranges only as fallbacks. Go owns settings and process lifecycle. Lua owns only state a running REAPER alone knows.
- **Test gap:** `integrations/reaper` Lua has no automated tests. Every change needs manual verification inside REAPER.
- **Teleprompter design today:** a Python sidecar captures the mic; Lua is not involved in the live loop. The design doc lists "where the audio for a span comes from (rolling buffer vs. REAPER's concurrent recording)" and how a live flag anchors to a take as open questions. Sections 3 to 5 bear directly on both.
- **Machine note (reported by the ecosystem agent, not re-checked):** SWS and ReaPack are installed here, and ReaImGui was not seen in `UserPlugins`.

## 2. Transport, position and recording (built-in ReaScript)

Sources: [ReaScript API](https://www.reaper.fm/sdk/reascript/reascripthelp.html), [changelog](https://www.reaper.fm/whatsnew.txt), [ReaScript overview](https://www.reaper.fm/sdk/reascript/reascript.php). Lua is 5.4.6 since v7.0.

| API | Narration use |
|---|---|
| `GetPlayState` (bits: &1 play, &2 pause, &4 record) | Gate teleprompter and compare. |
| `GetPlayPosition` | Latency-compensated "what you hear" position. Confirmed against the official page. Use it for the cursor the narrator sees. |
| `GetPlayPosition2` | Position of the *next audio block* being processed, which runs ahead of what you hear. One agent recommended it for "engine position"; see section 10 for the open question on which one anchors recorded audio. |
| `GetOutputLatency` (seconds), `GetInputOutputLatency(&in,&out)` (samples), `GetAudioDeviceInfo("BSIZE"/"SRATE"/"MODE")`, `Audio_IsRunning`, `time_precise` | ASR latency budget and timestamps. There is no `GetInputLatency`. |
| `GetCursorPosition`, `SetEditCurPos2(proj,t,moveview,seekplay)` | Read the edit cursor. Jump and scroll to a line. |
| `GoToMarker`, `GoToRegion` (smooth seek), `GetSet_LoopTimeRange`, `GetSetRepeat` | Jump to a line's marker or region. Set a time selection. Loop-rehearse one line. |
| `OnPlayButton`, `CSurf_OnRecord`, `Main_OnCommand` | There is no `OnRecordButton`. Use `CSurf_OnRecord` or the action IDs below. |
| `GetSetProjectInfo_String("RECORD_PATH"/"RECORD_FORMAT")` | Per-chapter record folders. |

Action IDs from an older action-list snapshot ([Ultraschall action list](https://raw.githubusercontent.com/Ultraschall/ultraschall-lua-api-for-reaper/Ultraschall-API-4.6/ultraschall_api/misc/misc_docs/Reaper-ActionList.txt)). **Verify each in the Action list before shipping.**

| Purpose | ID |
|---|---|
| Record / Stop / Play-stop | 1013 / 1016 / 40044 |
| Record mode: normal / time-selection auto-punch / selected-item auto-punch | 40252 / 40076 / 40253 |
| Toggle metronome / metronome and pre-roll settings | 40364 / 40363 |
| Pre-roll on play / on record | 41818 / 41819 |
| Split at cursor | 40012 |
| Render, most recent settings, auto-close / add to render queue | 42230 / 41823 |
| Apply track/take FX to items | 40209 |

SWS count-in toggles: `_SWS_AWCOUNTRECTOG`, `_SWS_AWCOUNTPLAYTOG`.

**Recording behavior narrators rely on:**
- Pre-roll is normally applied only on the first lead-in when loop recording ([Reaper Blog](https://reaper.blog/2021/08/loop-rec-pre-roll/)). Check transport state before assuming pre-roll on a punch.
- "Trim existing items" (Options > Overlapping Recording Behavior) gives the punch-and-roll seam ([Jay Myers](https://www.jaymyersvoiceover.com/blog-ideas/how-to-easily-meet-acx-audiobook-specifications-with-reaper)).
- Three narration recording modes (regular punch-and-roll, record over selected item, record over time selection) are described by [The Audiobook Guy](https://www.theaudiobookguy.co.uk/post/mastering-reaper-s-recording-modes).

**Polling:** `defer` runs on the GUI thread at about 30 Hz (secondary source, (U)). Blocking calls freeze the UI. `ExecProcess(cmd, timeoutms)` runs on the main thread: 0 waits indefinitely, -1 is fire-and-forget (terminates on timeout semantics per the docs), -2 is no-wait minimised. Use -1 or -2 for launches.

## 3. Markers, regions, lanes, per-object data, UI

| API | Narration use |
|---|---|
| `AddRegionOrMarker` (7.72), `GetNumRegionsOrMarkers`, `GetRegionOrMarker`, `GetRegionOrMarkerInfo_Value`, `SetRegionOrMarkerInfo_Value`, `GetSetRegionOrMarkerInfo_String` (7.62) | Preferred per-line and chapter regions. Stable pointer with GUID and `P_NAME`. Value keys include `D_STARTPOS`, `D_ENDPOS`, `I_CUSTOMCOLOR`, `I_LANENUMBER`. |
| `AddProjectMarker2`, `EnumProjectMarkers3`, `SetProjectMarker4`, `GetLastMarkerAndCurRegion(proj,t)` | Older index-based API, marked discouraged. `GetLastMarkerAndCurRegion` maps a play position to the current line region. |
| `GetTakeMarker`, `SetTakeMarker`, `DeleteTakeMarker`, `GetNumTakeMarkers` | Per-take error flags (already used). |
| `GetSetProjectNotes`, item `P_NOTES`, take `P_NAME` | Put manuscript line text on the item. Feeds `$itemnotes(name)` in render filenames. |
| `P_EXT:xyz` via `GetSetMediaItemInfo_String`, `GetSetMediaItemTakeInfo_String`, `GetSetMediaTrackInfo_String`; `SetProjExtState`, `GetProjExtState`, `EnumProjExtState`; the object `GUID` string | Persist line-to-take mapping inside the `.rpp`, keyed by GUID. |
| `GetExtState`, `SetExtState(...,persist)` | App-wide. Persisted values become an `.ini` line: no newlines, use base64. |
| Track `I_RECARM`, `I_RECINPUT`, `I_RECMODE`, `I_RECMON`, `I_FOLDERDEPTH` | Arm the narration track, choose input and monitoring. |
| Track `I_FREEMODE=2` (call `UpdateTimeline()` after), `I_NUMFIXEDLANES`, `C_LANESETTINGS`, `C_LANESCOLLAPSED`, `C_LANEPLAYS:N`, `C_ALLLANESPLAY`, `P_LANENAME:n`; item `I_FIXEDLANE`, `C_LANEPLAYS`, `B_FIXEDLANE_HIDDEN` | Retakes as fixed lanes. Choose the good take per line. 7.54 added an action to play only the most recently played lane for A/B. |
| `SplitMediaItem`, item `D_FADEINLEN`/`D_FADEOUTLEN`/`I_CUSTOMCOLOR`, `SetTakeStretchMarker`, `InsertMedia` | Editing and import. `SplitMediaItem` leaves the left half as the original and returns the right half. |
| `Undo_BeginBlock2`/`Undo_EndBlock2`, `Undo_OnStateChange2`, `MarkTrackItemsDirty`, `PreventUIRefresh(±n)` | One undo step per batch. `defer` scripts get no automatic undo point. Balance every `PreventUIRefresh` add with a remove. |
| `Undo_GetNumEntries`, `Undo_GetCurEntry`, `Undo_GetEntryDesc`, `Undo_GetEntryTime`, `Undo_SetCurPos` (7.79) | Inspect undo history. |
| `SetToggleCommandState` + `RefreshToolbar2`, `get_action_context` | A lit "teleprompter on" toolbar button. Only ReaScripts can have state set. |
| `GetProjectStateChangeCount(proj)`, `GetSetProjectInfo("DIRTY")` (7.75) | Change detection without callbacks. There is no script-level event or callback API. |
| SWS `NF_GetSWSMarkerRegionSub`/`NF_SetSWSMarkerRegionSub` | Per-region subtitle text could hold the manuscript line. Needs SWS. |
| `GetUserInputs`, `gfx.init`/`gfx.dock`, ReaImGui | In-REAPER UI. ReaImGui is third-party; its GitHub repo was archived 3 Jun 2026 and moved to [Codeberg](https://codeberg.org/cfillion/reaimgui). Our Wails window keeps the UI stack and tests portable. |

**Gotchas:**
- Marker and region indices are unstable. Key on GUID or the pointer from 7.62/7.72.
- `SetProjectMarker3` and `AddProjectMarker2` can't clear a name. Use `SetProjectMarker4` with flags&1.
- Marker colors: `ColorToNative(r,g,b)|0x1000000`.
- `GetSetProjectInfo("RENDER_SETTINGS")` &1024 embeds take markers in render.

**Languages and boundaries:** Lua 5.4, EEL2, Python (needs a separate install). `gmem_attach/read/write` shares numeric memory with EEL2, JSFX and Video only. EEL2 has built-in `tcp_connect`/`tcp_listen`/`tcp_recv`; Lua's built-ins have none, and stock LuaSocket won't load. [mavriq-lua-sockets](https://github.com/mavriq-dev/mavriq-lua-sockets) (GPL-3.0) provides static builds with UDP and HTTP but not HTTPS.

## 4. External control transports

**Licensing/architecture note:** `daw-integration.md` rules out our *app* hosting a loopback server, REST endpoint or port. Everything below has the app act as a **client** of REAPER's own interfaces, so the rule is not violated as written. It adds a network dependency and a required user setting, so record the decision in an ADR.

### 4.1 Comparison

| Transport | Direction | Latency | Install | Maintained | Fit |
|---|---|---|---|---|---|
| Web interface (`/_/…`) | Both, request/response | Poll-bound (bundled JS polls at 100 ms; `wwr_req_recur` sets intervals) | None, but the user enables it in preferences | Built in | **High**: commands and state reads |
| OSC control surface | Both, UDP push | Not documented (U) | Add a surface in preferences plus an optional `.ReaperOSC` file | Built in | **High**: transport push |
| MIDI learn / control surfaces | Into REAPER | Low | Enable "input for control messages"; virtual ports need loopMIDI or Windows MIDI Services (status on stable builds unclear) | ReaLearn 2.19.0-pre.2 (2026-09-16) | Medium: pedals only |
| Native extension (C++ or Rust) | Both, true push | Same as REAPER's own surfaces | DLL per platform in UserPlugins | SDK updated 2026-09-13 (7.80) | Best long-term, highest cost |
| Lua sockets (mavriq) | Both, from `defer` | Bound by the defer cycle | ReaPack install (GPL-3.0) | Unverified | Medium; a script must be running |
| reapy / reapy-boost | Both, RPC over socket | About 30-60 calls/s | Python plus a background script | reapy last pushed 2024-01; reapy-boost 2022-12 | Low |
| gmem with JSFX/script | Inside REAPER only | Low | JSFX | Built in | Not usable from Go |
| File-polling bridge (ours) | Both | About 50-100 ms per call in comparable projects | Lua script | Ours | Fragile; replace |
| CLI (`reaper.exe`) | Launch/batch | n/a | None | Built in | Headless render, tests |
| Live-editing `.rpp` | n/a | n/a | n/a | n/a | Not safe (inferred) |

### 4.2 Web interface

- Commands: `/_/cmd;cmd;cmd`, each a numeric action ID (0-65535) or a registered `_ID` for scripts and custom actions ([ReaTeam doc](https://github.com/ReaTeam/Doc/blob/master/web_interface_modding.md)).
- Responses are tab-separated tokens on newline-separated lines. `TRANSPORT` returns `TRANSPORT\tplaystate\tposition_seconds\tisRepeatOn\tposition_string\tposition_string_beats`. Playstate: 0 stopped, 1 playing, 2 paused, 5 recording, 6 record-paused ([third-party API doc](https://mespotin.uber.space/Ultraschall/Reaper_API_Web_Documentation.html)).
- Reads: `BEATPOS`, `MARKER` and `REGION` (lists ending `…_LIST_END`), `GET/EXTSTATE`, `GET/PROJEXTSTATE`, `GET/<cmdid>` (returns `CMDSTATE`).
- Writes: `SET/POS/<seconds>`, `SET/POS_STR/m1|r1`, `SET/REPEAT`, `SET/EXTSTATE/sec/key/val`, `SET/EXTSTATEPERSIST`, `SET/TRACK/n/RECARM`.
- Polling only: no push and no WebSocket in the docs. Third-party OSC-to-WebSocket bridges exist ([reaper-websockets](https://github.com/lucianoiam/reaper-websockets)).
- The docs warn the server can be knocked over by denial of service and advise a password. Default port and CORS behavior were not in what we fetched (U).
- Precedent: [johnjallday/reaper-plugin](https://github.com/johnjallday/reaper-plugin) is a Go project driving REAPER through this interface (macOS arm64 only).

### 4.3 OSC

- Default pattern file ([source](https://raw.githubusercontent.com/Ultraschall/ultraschall-portable/master/Plugins/Default.ReaperOSC)): transport `PLAY/STOP/RECORD/PAUSE/REPEAT`; feedback `TIME`, `BEAT`, `SAMPLES`, `FRAMES`; markers `MARKER_NAME`, `MARKER_TIME`, `LAST_MARKER_*`, `GOTO_MARKER`; regions `REGION_*`, `LAST_REGION_*`, `GOTO_REGION`; actions `ACTION i/action`, `ACTION s/action/str`, `ACTION t/action/@`. The ecosystem agent found the same set, plus `REGIONID_*` (write-only, creates a region if missing) and `LOOP_START_TIME`, in this machine's REAPER install.
- Marker and region feedback is banked by `DEVICE_MARKER_COUNT` and `DEVICE_REGION_COUNT`, both defaulting to 0 ([config deep dive](https://konbear.com/articles/deep-dive-into-reaperosc-config-file)).
- The default file floods devices with feedback. Trim it to the few patterns we need.
- Custom actions run via `/action/_COMMAND_ID`; OSC action bindings live in `reaper-osc-actions.ini`, and REAPER needs a restart after editing ([source](https://radugin.com/posts/2024-07-07/control-reaper-via-osc/)). That source also says a script gets only the first OSC argument and cannot send OSC.
- Go: [hypebeast/go-osc](https://github.com/hypebeast/go-osc) (pure Go, UDP). [hukl/reaper_osc_action](https://github.com/hukl/reaper_osc_action) (MIT) is a Go Stream Deck plugin sending action IDs over OSC.
- UDP is lossy: reconcile on every `TRANSPORT` poll. Whether `/time` can seek is unverified; use web `SET/POS`.

### 4.4 Native extension

- `IReaperControlSurface` provides `SetPlayState`, `SetSurfaceRecArm`, `SetTrackListChange`, `SetRepeatState`, `Extended()` and `Run()` (about 30 Hz). `Extended()` carries `CSURF_EXT_SETPROJECTMARKERCHANGE`, `CSURF_EXT_SETBPMANDPLAYRATE`, `CSURF_EXT_SETFXCHANGE` ([reaper_plugin.h](https://raw.githubusercontent.com/justinfrankel/reaper-sdk/main/sdk/reaper_plugin.h)).
- The SDK says Windows extensions "should be written in C++ and compiled using MSVC" because of vtable ABI ([plugin.php](https://www.reaper.fm/sdk/plugin/plugin.php)). Go via cgo/MinGW is therefore risky (inference, (U)). A plain-C-only `c-shared` DLL might avoid the C++ class, untested.
- [reaper-rs](https://github.com/helgoboss/reaper-rs) (MIT, pushed 2026-09-12) solves the ABI with a C++ shim forwarding to Rust. It backs ReaLearn and Playtime in production, is not on crates.io, and its medium-level API is "approaching stable".
- Realistic route: Rust plus reaper-rs (or a small MSVC C++ DLL) speaking a named pipe, TCP or WebSocket to Go. It needs Windows, macOS x64 and arm64 builds. Only worth it if true events are required.

### 4.5 CLI and files

- CLI flags ([REAPER-CLI](https://github.com/ReaTeam/Doc/blob/master/REAPER-CLI.md)): `-nosplash`, `-newinst`, `-nonewinst`, `-new`, `-template`, `-saveas`, `-renderproject file.rpp` (render and exit), `-cfgfile` (alternate resource dir, useful for isolated integration tests), `-ignoreerrors`, `-batchconvert list.txt`, `-close[all][:save|:nosave][:exit]`, `-noactivate`, `-fxoffline`, `-peaktest` (7.62+, dry-run render printing the peak). Since 6.80 a project and a script can be passed together. Render settings must already be saved in the project.
- `.rpp` is text with nested `<TAG …>` chunks ([chunk definitions](https://raw.githubusercontent.com/ReaTeam/Doc/master/State%20Chunk%20Definitions)). **Live-editing is not safe** while REAPER is open (inferred; a close analogue is documented: REAPER ignores edits to `reaper-extstate.ini` while running). Reading a saved `.rpp` is fine; retry on a torn read or read `.rpp-bak`.
- `reaper-kb.ini` has `KEY` (shortcuts), `ACT` (custom actions) and `SCR` (script registrations, e.g. `SCR 4 0 CMDID "desc" script.lua`). REAPER needs a restart after editing these.

### 4.6 Existing REAPER bridges (2026 survey)

| Project | Architecture |
|---|---|
| [TwelveTake-Studios/reaper-mcp](https://github.com/TwelveTake-Studios/reaper-mcp) | File-polling Lua, about 50 ms per call, Windows supported. |
| [shiehn/total-reaper-mcp](https://github.com/shiehn/total-reaper-mcp) | File-polling Lua; unfinished UDP path on ports 9000/9001. |
| [danielkinahan/ReaMCP](https://github.com/danielkinahan/ReaMCP) | Lua TCP bridge on 127.0.0.1:9001 via mavriq-lua-sockets. |
| [danishaft/reaper-mcp](https://github.com/danishaft/reaper-mcp), [yeeking/reaper-mcp-server](https://github.com/yeeking/reaper-mcp-server) | reapy. |
| [johnjallday/reaper-plugin](https://github.com/johnjallday/reaper-plugin) | Go over the web interface. |

None push events. Design lesson from the mature ones: keep the bridge a thin executor, own validation and safety in the server, and report "uncertain outcome" on timeout rather than guessing.

## 5. Audio access, live mic tap and analysis

### 5.1 Audio access APIs

| API | Use | Caveat |
|---|---|---|
| `CreateTakeAudioAccessor`, `CreateTrackAudioAccessor`, `DestroyAudioAccessor`, `GetAudioAccessorSamples(acc,srate,nch,starttime,nsamp,reaper.array)` | Decoded audio at any sample rate without a file path (take FX, sections, non-file sources). | Main-thread only, so a `defer` loop is the only pump. Documented as pre-FX, but the changelog mentions accessors processing take FX (U). Take-accessor time origin is item-relative. No zero-copy path to Go (U). No documented path to the record-armed input or a recording in progress (U). |
| `AudioAccessorStateChanged` / `AudioAccessorUpdate` | Invalidate cached ASR on edits. | State changes don't auto-refresh. |
| `GetMediaItemTake_Peaks`, `PCM_Source_GetPeaks` | Waveform or silence map without decoding. | Peaks only; extra type 115 gives spectral data. |
| `PCM_Source_GetSectionInfo`, `GetMediaSourceParent`, `GetMediaSourceLength`, `GetMediaSourceNumChannels`, `GetMediaSourceSampleRate` | Detect sections and reversed sources before trusting the file path. | `GetMediaSourceLength` returns quarter notes for beat-based sources. |
| `Audio_RegHardwareHook` (`OnAudioBuffer`, pre and post) | Raw device input tap. | C++ extension only; called on the audio thread. |
| SWS `CF_CreatePreview`, `CF_GetMediaSourceOnline`, `CF_EnumMediaSourceCues`, `CF_GetMediaSourceMetadata` | Read embedded chapters, cues and metadata. | No CF function returns PCM. |

### 5.2 Live mic tap options (teleprompter needs under 300 ms)

| Option | How | Latency and risk |
|---|---|---|
| **A. Go opens the device** | WASAPI shared mode lets several apps capture one endpoint; exclusive mode blocks others ([Microsoft](https://learn.microsoft.com/en-us/windows/win32/coreaudio/exclusive-mode-streams)). | Fails if REAPER holds the interface via ASIO (typically owns the device (U)). |
| **B1. ReaStream** (built in) | Add ReaStream on the input FX, monitor FX or track FX. Protocol is reverse-engineered ([libReaStream](https://github.com/niusounds/libReaStream/blob/main/reastream.txt)): UDP port 58710, little-endian; audio block = magic "MRSR", packet size (4 B), 32-byte zero-padded identifier, channel count (1 B, 1-64), sample rate (4 B), block length (2 B, max 1200 samples), then float32 non-interleaved data. | Best fit: post-input-FX audio to any process with no native build. Packetisation adds at most 1200 samples (25 ms at 48 kHz); total is device block plus about 25 ms plus decode (estimate). **Unverified:** whether a 127.0.0.1 target is accepted and how packets fragment above the MTU. ([Reaplugs](https://www.reaper.fm/reaplugs/)) |
| **B2. JSFX tap via gmem** | JSFX writes `gmem[]`; ReaScript reads it with `gmem_read`. | gmem stays inside REAPER, so a bridge needs Lua sockets or a file. About 33 ms poll granularity. Worse than B1. |
| **B3. C++ extension** | `Audio_RegHardwareHook` to shared memory or a named pipe. | Lowest latency, full control, native build and support burden. |
| **C. Loopback / virtual cable** | REAPER has built-in loopback (up to 256 channels); ReaRoute is a Windows ASIO driver with 16 channels; VB-Cable and Voicemeeter are third-party. | ReaRoute needs ASIO in Go (cgo): poor fit. Virtual cables add an install. |
| **D. Monitor FX / Input FX** | `TrackFX_AddByName(track, name, recFX=true, …)`. | Where B1 or B2 would live. Sees pre-record, post-input-FX audio. |
| **E. Tail the growing WAV** | REAPER reads a WAV being recorded in another tab; a forum-derived note says data is written per buffer but the header is stale until stop (U). | Parse defensively (length fields unreliable, read to EOF). Fallback only, not the under-300 ms path. |

### 5.3 Loudness and quality analysis

| API | What | Caveat |
|---|---|---|
| `CalculateNormalization(src, mode, target, start, end)` | Gain for mode 0 LUFS-I, 1 RMS-I, 2 peak, 3 true peak, 4 LUFS-M max, 5 LUFS-S max. Range 0,0 is the whole file. | Best headless number source. |
| `CalcMediaSrcLoudness(src)` | Per-source loudness. | |
| `GetSetProjectInfo_String("RENDER_STATS"/"RENDER_STATS_SUMMARY", "<action id>", false)` | Dry-run render stats (7.62). Example action 42437 (dry run of selected items). 7.79 added stereo-loudness actions; 7.75 added a selected-items source loudness path. | Shows UI, cancellable (returns -1). Stat key names undocumented (U). |
| SWS `NF_AnalyzeMediaItemPeakAndRMS`, `NF_GetMediaItemPeakRMS_Windowed`, `NF_AnalyzeTakeLoudness(take, truePeak, …)` | Windowed RMS, LRA, true peak, short-term and momentary max. | Needs SWS. Short-term needs items of at least 3 s. |
| `Track_GetPeakInfo`, `Track_GetPeakHoldDB` (channels 1024/1025 return loudness on the master or loudness-metered tracks) | Live meters. | Level indication only. |
| `TrackFX_GetNamedConfigParm("GainReduction_dB"/"pdc")`, `TrackFX_GetParamNormalized` on JS loudness meters | Compressor reduction, plugin latency, meter values. | Per-plugin parameter mapping; discover indices first. |

**ACX requirements** ([ACX](https://help.acx.com/s/article/what-are-the-acx-audio-submission-requirements)): RMS between -23 and -18 dB, peak below -3 dB, noise floor below -60 dB RMS, MP3 at 192 kbps or higher CBR at 44.1 kHz. Room tone: ACX says 1-5 s at head and tail; third-party guides say 0.5-1 s head and 1-5 s tail, so verify before enforcing.

**Recommended split:** REAPER for integrated numbers (`CalculateNormalization`, dry-run stats). Go for windowed RMS, sample and true peak, and the noise floor from the quietest room-tone segment of the rendered WAV.

## 6. Render, export, chapters

`GetSetProjectInfo` keys (all from the [API](https://www.reaper.fm/sdk/reascript/reascripthelp.html)):

- **Settings and bounds:** `RENDER_SETTINGS` (&8 uses the region render matrix, &32/&64 selected items, &512 embed metadata, &1024 embed take markers), `RENDER_BOUNDSFLAG` (0 custom, 1 project, 2 time selection, 3 all regions, 4 selected items, 5 selected regions, 6 all markers, 7 selected markers), `RENDER_STARTPOS`/`ENDPOS`, `RENDER_TAILFLAG`/`TAILMS`.
- **Audio format:** `RENDER_CHANNELS`, `RENDER_SRATE`, `RENDER_ADDTOPROJ`, `RENDER_DITHER`.
- **Post-processing:** `RENDER_NORMALIZE` (bitfield: LUFS or peak targets, brickwall, fades, trim silence, pad) with `RENDER_NORMALIZE_TARGET`, `RENDER_BRICKWALL`, `RENDER_FADEIN`/`FADEOUT`, `RENDER_PADSTART`/`PADEND`, `RENDER_TRIMSTART`/`TRIMEND`.

`GetSetProjectInfo_String` keys: `RENDER_FILE` (directory), `RENDER_PATTERN` (wildcards), `RENDER_FORMAT`/`RENDER_FORMAT2` (base64 sink config or a 4-character code such as `evaw` or `l3pm`), `RENDER_METADATA` (`"ID3:TALB|album"` to set), `RENDER_TARGETS` (files that would be written), `RENDER_STATS`, `RENDER_STATS_SUMMARY`.

- **Region render matrix:** `SetRegionRenderMatrix(proj, regionidx, track, flag)` (flag greater than 0 adds the track, less than 0 removes it, 2 forces mono, 4 forces stereo). `EnumRegionRenderMatrix` returns a MediaTrack*, not a key/value pair.
- **Wildcards:** `$region`, `$track`, `$project`, `$tracknumber`, `$marker`, `$item`, `$itemnotes(name)` (7.55), `$projectnotes(key)` (7.56), `$region{lane}`/`$regionlane{N}`. `ResolveWildcards(proj, time, str)` resolves them via API.
- **Chapters:** REAPER embeds ID3 tags including chapter tags in MP3 (since 6.10), Vorbis chapters in FLAC/OGG/Opus, and markers as cues in WAV. A secondary source says a `CHAP=Title` marker name becomes an MP3 chapter with metadata embedding on (forum thread unfetchable (U)). Ultraschall ships a `PrepareChapterMarkers4ReaperExport` helper, which suggests a manual step may be needed. No M4B chapter support found in the changelog. MP4/M4A render exists and ffmpeg's mov muxer writes chapters. Go ID3 CHAP support: `n10v/id3v2` (search snippet only), or `sa6mwa/id3v24` extending `bogem/id3v2`.
- **Recent changelog items that matter:** 6.10 ID3 chapters; 7.27 dry-run render action; 7.47 PDC auto-bypass while recording; 7.54 play-most-recent-lane action; 7.55/7.56 new wildcards; 7.62 ruler lanes, `RENDER_STATS`, region/marker string API, `-peaktest`; 7.63 renumber regions by lane; 7.66 CSV/RPP marker import; 7.72 `AddRegionOrMarker`; 7.75 spectral-repair actions, `DIRTY` flag; 7.79 undo-history API, stereo loudness actions; 7.80 Repair Pops/Clicks dialog.

**Processing and templates:** action 40209 applies track/take FX. `Main_OnCommand`/`Main_openProject("….RTrackTemplate")` adds a track template; `InsertTrackAtIndex` plus `SetTrackStateChunk` is the lower-level route. `GetTrackStateChunk`/`GetItemStateChunk` return raw RPPXML; chunk edits can reset undo state and drop unknown fields (U), so prefer API calls. `RENDER_NORMALIZE` bits can trim silence and pad at render time.

**Time mapping for compare:** naive source time is `D_STARTOFFS + (t - D_POSITION) * D_PLAYRATE` (inference). It breaks with stretch markers (`GetTakeStretchMarker`), sections or reversed sources, beat-based sources and MIDI takes (`TakeIsMIDI`; sample rate 0). `D_STARTOFFS` can be negative and a source longer than the item is normal. MP3 encoder-delay offsets are possible (U). Our existing code already handles offset, rate and playrate, so the audio-accessor path is only needed for take FX, sections and non-file sources.

## 7. Ecosystem and competitors

| Project | Author | What it does | License | Maintained |
|---|---|---|---|---|
| [thenarratorUK/reascripts](https://github.com/thenarratorUK/reascripts) | thenarratorUK | Chapter/Line Region Maker, breath and click detect/reduce, Pozotron pickup import, Character Take Report, Close Gaps in Room Tone. Needs REAPER 7+ and SWS. | None declared (learn, don't copy) | Yes (2026-09-12) |
| [ReaSpeech](https://github.com/TeamAudio/reaspeech) | TeamAudio | Docker faster-whisper backend, searchable marker-based transcript index; uses ReaImGui. | GPL-3.0 | Yes |
| [ReaSpeech Lite](https://github.com/TeamAudio/reaspeech-lite) | TeamAudio | VST3/ARA plugin embedding whisper.cpp; markers, regions or notes track. | AGPL-3.0 | Yes |
| [ReaWhisper](https://github.com/HeDaScripts/ReaWhisper) | HeDaScripts | Whisper to SRT to text items. | MIT | Stale (2024) |
| [SWS](https://github.com/reaper-oss/sws) | Community | Item peak/RMS analysis, snapshots, region playlist, marker actions. ACX's own guidance uses it. | MIT | Pushed 2026-05 |
| [Steven Jay Cohen setup](https://stevenjaycohen.com/journal/my-reaper-setup-for-audiobooks) | S. J. Cohen | Punch and Roll, New Chapter, Trim to Chapter start/end, Export Chapters vs Render Mastered Chapters; `.rpp-bak` recovery. | Unstated | Unknown |
| [acendan/reascripts](https://github.com/acendan/reascripts) | acendan | Import item names from a text file; insert marker at item start with item name. | MIT | Yes |
| [Magnolius](https://github.com/m-dahlberg/magnolius-reaper) | m-dahlberg | Offline DeClick and mouth-noise repair. | GPL-3.0 | Yes |
| [DialogueWorkflow](https://github.com/Gminorscale/DialogueWorkflow) | Gminorscale | CSV to regions plus a browser teleprompter driven through the web interface. Closest architectural precedent. | MIT | Small, active |
| SRT/text-item scripts | X-Raym | Subtitle import and export as text items. | GPL-3.0 (unverified for these files) | Yes |
| Items Volume and Loudness Pack | ExtremRaym | Match items to a reference by LUFS/RMS/peak. | Paid | Yes |
| [Pozotron](https://www.pozotron.com/support/docs/daw_markers/) | Pozotron | Commercial proofing service; exports pickup markers for Audition, Reaper, Audacity with `@narrator` tags. Format not retrievable. | Commercial | Yes |

**Gaps found (inferred from search results, not exhaustive):** no public ACX-check ReaScript, no punch-and-roll script on ReaPack, no "mark bad take" script. [theaudiobookguy.co.uk/acx-audio-checker](https://www.theaudiobookguy.co.uk/acx-audio-checker) is a free web checker whose author says accuracy is not guaranteed.

**Comparable products' DAW hookups:**

- [PromptVO](https://www.promptvo.com/): voice-following teleprompter with live misread detection (skipped, added, swapped words), manuscript prep flagging hard names, and post-recording proofing (claims about 90% of remaining misreads). It says it "integrates with existing DAWs" but gives no mechanism.
- [TelePrompterProTools](https://github.com/krocksss/TelePrompterProTools): drives Pro Tools via PTSL (gRPC on localhost:31416) with optional MTC via loopMIDI; faster-whisper for word timing. No license declared.
- [Descript](https://help.descript.com/hc/en-us/articles/35482375421581-Record-with-Descript-s-built-in-teleprompter): scrolling teleprompter, no DAW sync.
- MTC/LTC and SysEx-over-VST sync approaches exist for other DAWs (secondhand; source page returned 403).

## 8. Narrator pain points (secondary sources only)

- **Time cost:** roughly 6.2 hours of work per finished hour ([Narrator's Roadmap](https://www.narratorsroadmap.com/audiobook-production-workflow/)).
- **Pickup loop:** the proofer flags errors with timecodes, the narrator re-records, and an editor integrates the pickups: a manual marker workflow.
- **Delivery spec:** ACX numbers in section 5.3.
- **Recovery and files:** `.rpp-bak` backups; bulk file renames typically happen outside REAPER.
- **Not found:** hard evidence on "losing place after a flub" beyond PromptVO's marketing.

## 9. Ranked opportunities

| # | Idea | Relies on | Reuses |
|---|---|---|---|
| 1 | **Timeline-anchored live flags:** write live-detected misreads and skips as take or project markers at (play position minus ASR latency). | `GetPlayPosition`, `GetPlayState`, `SetTakeMarker`/`AddRegionOrMarker`, OSC or web `TRANSPORT` | Findings contract, live ASR |
| 2 | **Punch-and-roll navigator:** after a flub, map the manuscript position to the last-good timeline position, set cursor and time selection, arm and record. | `SetEditCurPos2`, `GetSet_LoopTimeRange`, actions 40076/1013 | Live ASR position |
| 3 | **Line-to-item-to-take mapping in the `.rpp`:** paragraph IDs in `P_EXT`, `P_NOTES`, `P_NAME`; feeds render filename wildcards. | `GetSetMediaItemInfo_String`, `SetProjExtState` | Manuscript model |
| 4 | **Pickup list:** import or export proofer markers (Pozotron/CSV), show "pickups remaining", jump-to-next. | Region/marker APIs, 7.66 CSV import | Transcript Compare exports |
| 5 | **Per-chapter render and export:** manuscript headings to regions, render, then embed chapter tags. | Render keys and matrix, `-renderproject` | Manuscript headings |
| 6 | **ACX check per chapter region.** | `CalculateNormalization`, dry-run `RENDER_STATS`, Go analysis | Go audio code |
| 7 | **Web/OSC transport replacing file polling.** | Section 4 | Wails host |
| 8 | **Retakes as fixed lanes:** choose the good lane per line. | `I_FREEMODE`, `C_LANEPLAYS` | Compare results |
| 9 | **Session stats:** PFH time tracking and per-chapter progress. | Region lengths, ProjExtState | Manuscript progress |
| 10 | **Cleanup launchers:** Repair Pops/Clicks, Magnolius. | `Main_OnCommand` | None |
| 11 | **Change-driven re-compare:** re-run compare only when `GetProjectStateChangeCount` changes; toolbar toggle for the teleprompter. | Section 3 | Compare |

## 10. Recommended architecture and open spikes

**Architecture**

- **State to Go:** trimmed OSC feedback (`PLAY/STOP/RECORD/TIME/LAST_MARKER_*`) into a Go UDP listener, with web `/_/TRANSPORT` polling (30-100 ms) as fallback and reconciliation.
- **Commands from Go:** web `/_/<id>` for acknowledged commands, `SET/POS`, `SET/REPEAT`, `SET/TRACK/n/RECARM`. Foot pedals use REAPER MIDI learn on action IDs; no MIDI path in Go.
- **Payloads:** Go writes `SET/EXTSTATE/narration/<key>/<payload>`, then triggers a registered ReaScript action. The Lua launcher becomes a stateless command handler with no polling loop or file bridge. (Payload size and escaping limits unverified.)
- **Mic tap:** ReaStream to Go, subject to the spikes below; WASAPI shared as the simple fallback.
- **Later, only if truly needed:** a Rust (reaper-rs) or MSVC C++ extension pushing JSON over a named pipe. Go-in-DLL is unproven.

**Spikes to run before committing**

1. **ReaStream** to localhost UDP 58710: packet format, unicast target, MTU behavior, measured end-to-end latency.
2. **OSC feedback rate and marker banking** (documented latency is (U)).
3. **Audio accessors during recording:** can a track or take accessor see a recording in progress, and are take FX included?
4. **Play-position anchor for recorded audio:** `GetPlayPosition` (what you hear) vs. `GetPlayPosition2` (next block). The API page defines them; the right one for aligning mic-derived ASR words to the recorded take needs a measured test against a known click.
5. **Render details:** `RENDER_STATS` key format, marker-to-CHAP mapping, and current action IDs (Glue, Auto trim, Dynamic split IDs were unverified).
6. **Web interface defaults:** port, auth and CORS.

**Risks**

- One-time user setup for the web interface and OSC. Automating it by editing `reaper.ini` while REAPER runs is unverified and risky (silent overwrite).
- No documented web-interface auth defaults; set a password if enabled. UDP is lossy.
- Native extension means recurring cross-platform build cost.
- `integrations/reaper` Lua has no automated tests: manual verification in REAPER for every Lua change (per CLAUDE.md).
- `daw-integration.md` needs an ADR if we adopt the web or OSC client approach.
- Licensing: mavriq-lua-sockets is GPL-3.0 (don't bundle); don't copy thenarratorUK code (no license); ReaSpeech (GPL-3.0) and ReaSpeech Lite (AGPL-3.0) can be called but not embedded.

## Sources

Official / SDK
1. [ReaScript API reference](https://www.reaper.fm/sdk/reascript/reascripthelp.html): function signatures and descriptions (downloaded and grepped locally).
2. [ReaScript overview](https://www.reaper.fm/sdk/reascript/reascript.php): languages and action registration.
3. [REAPER changelog](https://www.reaper.fm/whatsnew.txt): version history through 7.80.
4. [OSC docs](https://www.reaper.fm/sdk/osc/osc.php): control surface pattern config.
5. [reaper_plugin.h](https://raw.githubusercontent.com/justinfrankel/reaper-sdk/main/sdk/reaper_plugin.h): `IReaperControlSurface`, `Audio_RegHardwareHook`.
6. [Extension plugin guide](https://www.reaper.fm/sdk/plugin/plugin.php): MSVC ABI note.
7. [JSFX docs](https://www.reaper.fm/sdk/js/js.php): gmem and JSFX.
8. [ReaPlugs](https://www.reaper.fm/reaplugs/): ReaStream description.

Community docs and libraries
9. [ReaTeam web interface doc](https://github.com/ReaTeam/Doc/blob/master/web_interface_modding.md), [REAPER-CLI](https://github.com/ReaTeam/Doc/blob/master/REAPER-CLI.md), [State chunk definitions](https://raw.githubusercontent.com/ReaTeam/Doc/master/State%20Chunk%20Definitions).
10. [Ultraschall web API doc](https://mespotin.uber.space/Ultraschall/Reaper_API_Web_Documentation.html), [filetype descriptions](https://mespotin.uber.space/Ultraschall/Reaper-Filetype-Descriptions.html), [action list snapshot](https://raw.githubusercontent.com/Ultraschall/ultraschall-lua-api-for-reaper/Ultraschall-API-4.6/ultraschall_api/misc/misc_docs/Reaper-ActionList.txt), [Default.ReaperOSC](https://raw.githubusercontent.com/Ultraschall/ultraschall-portable/master/Plugins/Default.ReaperOSC).
11. [ReaperOSC deep dive](https://konbear.com/articles/deep-dive-into-reaperosc-config-file), [OSC with actions](https://radugin.com/posts/2024-07-07/control-reaper-via-osc/).
12. [libReaStream protocol](https://github.com/niusounds/libReaStream/blob/main/reastream.txt).
13. [reaper-rs](https://github.com/helgoboss/reaper-rs), [ReaLearn/Helgobox](https://www.helgoboss.org/projects/realearn), [reaper-sdk](https://github.com/justinfrankel/reaper-sdk), [go-osc](https://github.com/hypebeast/go-osc), [mavriq-lua-sockets](https://github.com/mavriq-dev/mavriq-lua-sockets), [reapy](https://github.com/RomeoDespres/reapy), [ReaImGui (Codeberg)](https://codeberg.org/cfillion/reaimgui), [SWS](https://github.com/reaper-oss/sws).
14. [Microsoft WASAPI exclusive mode](https://learn.microsoft.com/en-us/windows/win32/coreaudio/exclusive-mode-streams), [Windows MIDI Services](https://microsoft.github.io/MIDI/kb/virtual-loopback/).

Narration ecosystem
15. [thenarratorUK/reascripts](https://github.com/thenarratorUK/reascripts), [ReaSpeech](https://github.com/TeamAudio/reaspeech), [ReaSpeech Lite](https://github.com/TeamAudio/reaspeech-lite), [ReaWhisper](https://github.com/HeDaScripts/ReaWhisper), [acendan](https://github.com/acendan/reascripts), [Magnolius](https://github.com/m-dahlberg/magnolius-reaper), [DialogueWorkflow](https://github.com/Gminorscale/DialogueWorkflow).
16. [Pozotron](https://www.pozotron.com/support/docs/daw_markers/), [PromptVO](https://www.promptvo.com/), [TelePrompterProTools](https://github.com/krocksss/TelePrompterProTools), [Descript teleprompter](https://help.descript.com/hc/en-us/articles/35482375421581-Record-with-Descript-s-built-in-teleprompter).
17. [Jay Myers ACX with REAPER](https://www.jaymyersvoiceover.com/blog-ideas/how-to-easily-meet-acx-audiobook-specifications-with-reaper), [S. J. Cohen setup](https://stevenjaycohen.com/journal/my-reaper-setup-for-audiobooks), [Audiobook Guy recording modes](https://www.theaudiobookguy.co.uk/post/mastering-reaper-s-recording-modes), [Reaper Blog loop-rec pre-roll](https://reaper.blog/2021/08/loop-rec-pre-roll/), [Narrator's Roadmap](https://www.narratorsroadmap.com/audiobook-production-workflow/), [ACX requirements](https://help.acx.com/s/article/what-are-the-acx-audio-submission-requirements).
18. REAPER MCP servers: [TwelveTake-Studios](https://github.com/TwelveTake-Studios/reaper-mcp), [total-reaper-mcp](https://github.com/shiehn/total-reaper-mcp), [ReaMCP](https://github.com/danielkinahan/ReaMCP), [danishaft](https://github.com/danishaft/reaper-mcp), [yeeking](https://github.com/yeeking/reaper-mcp-server), [johnjallday](https://github.com/johnjallday/reaper-plugin), [hukl/reaper_osc_action](https://github.com/hukl/reaper_osc_action).

## Methodology

Four parallel research passes, each returning cited findings: (1) core ReaScript API, (2) external control and IPC transports, (3) narration workflows and ecosystem, (4) audio access, analysis and render. The repo's `integrations/reaper` Lua, `docs/architecture/daw-integration.md` and `docs/architecture/manuscript-teleprompter.md` were read to establish the baseline. One cross-check was done directly: `GetPlayPosition` vs. `GetPlayPosition2` descriptions were confirmed against the downloaded official API page. Nothing in this report was executed or tested against a running REAPER. Every (U) item is a candidate spike, not a fact. Forum and Reddit sources were unreachable, and the ecosystem "gaps" conclusions rest on absence in search results.
