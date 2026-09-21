# REAPER spike S0: item extension data in a saved project

**Status: done, 2026-09-21. Everything below was observed in REAPER 7.80 on Windows; a different version may differ.** Spike S0 of the [REAPER automation research](reaper-automation-surface.md) (section 9) and phase 5 of the follow-through PRD. It ran in a real REAPER 7.80 on the development machine under owner decision D3 (isolated resource directory, copies only). It also ran the scripted part of the line identity manual checklist against the real bridge, and produced the REAPER-saved fixture pack the later PRDs read.

## What it settles

| Question | Answer | Unblocks |
| --- | --- | --- |
| Is `P_EXT` on an item stored in the `.rpp`, and does it survive save and reload? | Yes. Item level is an `<EXTI` block, take level an `<EXT` block, inside the item chunk. Values round-trip through save, reload and `read_line_ids`, including quotes, backslashes, non-ASCII and a 3,000-character value. | [ADR 0026](../adr/0026-manuscript-line-identity-in-item-extension-data.md) is confirmed by evidence; PRD phases 6 and 7 (line identity) |
| Can a reader parse it without REAPER? | Yes: one `key value` line per key, with four value forms (below), the same across every save, reload, split and duplicate tried in 7.80. | PRD Open Question 9 answered: phase 14 (static read of line IDs) is feasible; it needs a real chunk reader, not a regex |
| What do split, duplicate, copy and undo do to a stamp? | Split: both halves keep it (the right half gets a new GUID). Duplicate: the copy keeps it. A state-chunk copy (what a paste serializes) keeps it. Undo removes the stamp exactly and redo restores it. | Line identity survives the edits a narrator makes |
| Does stamping disturb the rest of a project? | No. On a copy of a real 41-item project, stamping five items added exactly five `<EXTI` blocks (21 lines) and changed the header save time; nothing else. | The "no unreviewed edits" success metric |
| Does the bridge work in a real REAPER? | Yes after one fix to the bridge found here (below). All 37 scripted checks pass. | PRD phases 1, 3 and 4 evidence |
| Is there a REAPER-saved fixture pack? | Yes, `apps/desktop/internal/tracks/testdata/reaper/` (README there). | Evidence ledger parser superset, take review, recording coverage |

## Method

- **Machine and build.** Windows 11, REAPER 7.80/x64 rev 9d9fa7 (13 Sep 2026), an evaluation license. **REAPER opened the default Windows audio device on start** (WaveOut, Microsoft Sound Mapper, two in, two out, 44.1 kHz) even though the first-run "select an audio device" prompt was answered No: nothing was recorded, armed or played, but the device was open while the scripts ran (the runs before the guard below). Every script now calls `reaper.Audio_Quit()` first and asserts `Audio_IsRunning() == 0`; the last runs passed that guard. Lua 5.4 inside REAPER, and `debug.getinfo` works there.
- **Isolation.** `reaper.exe -cfgfile <temp>\reaper.ini -nosplash -newinst -noactivate [<copy of a .rpp>] <script.lua>`. The resource directory is a temp folder, so the owner's settings, scripts and projects are not read or written. Two first-run dialogs appear in a fresh resource directory and the driver answers them: "select an audio device" (No) and the evaluation notice (closed). A `-ignoreerrors` flag is available for projects with missing media.
- **The owner's project.** `Challenges_001.rpp` was **copied** (the `.rpp` only, 103,872 bytes) to a temp folder and only the copy was opened. The original's SHA-256 is unchanged (`998b2d14...`) and no file in its folder is newer than the copy. Because only the `.rpp` was copied, its 41 items had offline media, which does not matter for structure.
- **Scripts.** [`integrations/reaper/spikes/`](../../integrations/reaper/spikes/) (README there): `probe.lua`, `enumcheck.lua`, `build_cases.lua`, `checklist.lua`, `real_project.lua`, and the driver `run-reaper.ps1`. The fixtures use synthetic 3-second tones as media. The driver refuses a `-Cfg`, `-Out` or `-Project` outside the temp folder or under a `REAPER Media` folder, quotes every argument, and each script asserts at start that REAPER's resource path is the scratch `-Cfg` folder, closes the audio device and asserts it is closed. **Recorded outputs** (paths removed) are in `integrations/reaper/spikes/results/`: `build-cases-report.txt`, `checklist-report.txt` (the run with the guards), `real-project-summary.txt` and `audio-probe.txt` (the default audio device REAPER opens on start).

## Extension data in the saved file

```
<ITEM
  ...
  IGUID {86C04508-9091-445A-964E-F53883A33A97}
  <EXTI
    narration_utils_line_id line-000001
    narration_utils_line_text "The first line, with | a pipe."
  >
  NAME "take A"
  GUID {01900541-E2B7-4A63-9468-52EF0E33CC23}
  <SOURCE WAVE
    FILE "media/take_a.wav"
  >
  <EXT
    narration_utils_take_note "take-level value"
  >
>
```

- **Item keys** are the `<EXTI` block, **take keys** the `<EXT` block of that take. The key is stored without the `P_EXT:` prefix.
- **Value forms.** A bare token when it has no spaces; `"..."` when it has spaces; a backtick pair for the value with both kinds of quote that was tried (marker names with only double quotes are `'...'` quoted, so a reader must accept all three quote characters); and a `<BIN key` sub-block of base64 (wrapped at 128 characters) for a value with a line break or a very long one. A reader has to handle all four.
- **API behaviour.** A missing key reads as `false, ''`. Setting returns `true, value`. Multi-line values round-trip in memory and are stored as `<BIN`, but the bridge already flattens line breaks (`one_line`), so line text never takes that path.
- **Item and take GUIDs.** In REAPER 7 an item chunk has `IGUID` (the item, which is what `GetSetMediaItemInfo_String(item, "GUID")` returns) and one `GUID` per take. The hand-written `basic.rpp` fixture puts the item's GUID under `GUID`; a parser must read `IGUID`.
- **Undo and pointers.** Undo and redo replace REAPER's item objects, so a script must look items up by GUID again afterwards. The stamp block is one undo entry, "Narration Utils: stamp manuscript line IDs", and Undo then Redo restores the stamp.
- **Not exercised.** REAPER's clipboard actions (copy and paste items, actions 40698, 42398, 40058) do nothing when driven headless (no focused arrange window), so a real paste was not tested; a state-chunk copy, which is what a paste serializes, keeps the extension block. A manual paste is on the owner's list.

## What else the saved files show (fixture pack)

| Case | In the file |
| --- | --- |
| Multi-take item | One `ITEM` with `NAME`, `GUID`, `<SOURCE>` per take; the first take has no `TAKE` line, later ones `TAKE` or `TAKE SEL` for the active one. The first `NAME`/`<SOURCE>` of an item chunk is the first take's, not the active one's. |
| Muted item / track | Item `MUTE 1 0`; track `MUTESOLO 1 0 0`. |
| SECTION source | `<SOURCE SECTION` with `LENGTH`, `STARTPOS`, `OVERLAP` and a nested `<SOURCE WAVE`. |
| Play rate and stretch | `PLAYRATE 1.25 0 0 -1 0 0.0025` (rate, preserve-pitch flag, pitch, ...); `SM 0.4 0.5 + 1.6 1.4` (stretch markers as position and source position pairs); `SOFFS`. |
| FX | Track `<FXCHAIN` and take `<TAKEFX`, each `<VST "VST: ReaEQ (Cockos)" reaeq.dll ... 1919247729<5653...>` followed by base64 state. The header line contains `<` and `>`. |
| Regions | Two `MARKER` lines (start with name, colour and `R {GUID}`; end with an empty name). Markers and regions are numbered separately. |
| Markers | `PICKUP: re-record "the wind" (mispronounced)` is stored `'...'` quoted because the name has double quotes; every marker and region has a GUID. |
| No-op re-save | Reopen and save under a new name: `ACT 1 -1` becomes `ACT 0 -1`, each track gains `LANEREC -1 -1 -1 0`, FX state gains a preset name, the save time in the header changes, and project-relative media paths become absolute. |

On the real project copy an unchanged save to a new folder changed the header time and rewrote all 41 media paths as absolute; stamping five items on top added only five `<EXTI` blocks.

## Where the harness fake was wrong

The harness fake ([ADR 0066](../adr/0066-the-lua-bridge-is-tested-by-a-harness-under-lua-5-4-and-reaper-api-behaviour-is-checked-in-reaper.md)) had been written from the API documentation and the bridge's own calls. The real REAPER showed:

| Behaviour | Fake before | Real REAPER 7.80 | Result |
| --- | --- | --- | --- |
| `reaper.EnumerateFiles` | A live listing | **Cached** until `EnumerateFiles(dir, -1)`: a file created after the first call is invisible and a removed one stays listed for seconds | A **bridge bug**: after every command the bridge reported `ERROR||Unsupported hub protocol` for the ghost listing, and new commands could wait. Fixed in the event fan-out PR (the bridge clears the listing and skips a vanished file); the fake now caches |
| Marker and region numbers | One shared counter | Separate: marker 1 and region 1 coexist | Fake fixed |
| `SetTakeMarker` | Appended, returned the last index | Keeps take markers ordered by source position and returns the marker's final index | Fake fixed |
| Undo points | Every `Undo_EndBlock2` and `Undo_OnStateChange` records | Both record the named point in the cases the bridge uses (`Undo_EndBlock2` with flags `-1` after stamping; `Undo_OnStateChange` after `SetTakeMarker`); whether REAPER skips a point when nothing changed was not established | Not modelled further; the bridge's undo entries are verified in the scripted run (checklist steps 2, 3 and 10) |
| Media path stored | n/a | `PCM_Source_CreateFromFile('media/x.wav')` in a saved project stores a relative path; an absolute source path stays absolute | Fixture README |

`tests/fake_fidelity_test.lua` pins the fake to these observations.

## The scripted checklist against the real bridge

`checklist.lua` loads the real bridge in REAPER and drives it through the file protocol on a scratch project. 37 checks pass, 0 fail:

| Checklist step | Result in REAPER 7.80 |
| --- | --- |
| 2 Stamp | `LINES_STAMPED\|t1\|1\|0\|0\|0`; id and text on the item; undo entry named as documented; Undo removes, Redo restores |
| 3 Idempotent | `...\|0\|1\|0\|0` and no new undo entry |
| 4 Conflict | `LINES_CONFLICT` and the old id kept; `overwrite=1` changes it |
| 5 Stale | `LINES_STALE`, no item changed |
| 6 Survives editing | Split: both halves keep the stamp; duplicate keeps it; chunk copy keeps it; `read_line_ids` reports all four |
| 7 Save and reload | Same four items, same text |
| 8 Untouched fields | Notes and take names unchanged |
| 9 Regions | One coloured region; again `...\|0\|1\|0`; a malformed row counted invalid |
| 10 (bridge side) | `prepare_compare` (manifest, 1 item), `inspect_compare_results` (`COMPARE_MARKER` at project time 5.25), `export_compare_markers` (one take marker, undo entry), `jump_to_compare_marker` (cursor and selection; an unknown row gives `ERROR\|c1\|Marker location is no longer available.`) |

## Not done, and why

- **Transcript Compare through the app** (checklist step 10 in full) and a **real paste** need the owner in REAPER with the app running.
- **Spikes S1, S3 and S4** need audio hardware and the owner present: pending. S5 and S7 are later phases of the PRD.
- **Media of the real project** was not copied (369 MB folder; REAPER would also write peak files beside media), so nothing here says anything about audio.

## Reproduce

See [`integrations/reaper/spikes/README.md`](../../integrations/reaper/spikes/README.md). Everything runs from a fresh temp `-Out` folder and a temp `-Cfg`; a different REAPER version will write different files, which is why the version is recorded with the fixtures.
