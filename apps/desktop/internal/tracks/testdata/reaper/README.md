# REAPER-saved fixtures

Real `.rpp` files written by REAPER itself, kept for the parser tests and for the PRDs that need to read what REAPER saves (the evidence ledger's parser superset, take review, recording coverage). The hand-written `../basic.rpp` predates them and stays.

## Provenance

| | |
| --- | --- |
| Written by | REAPER 7.80/x64, rev 9d9fa7 (13 Sep 2026), Windows 11, an evaluation license |
| Date | 2026-09-21 |
| How | A scripted, isolated run: `reaper.exe -cfgfile <temp>\reaper.ini -nosplash -newinst -noactivate <script.lua>` with a temp resource directory, on scratch projects. REAPER opens the default Windows audio device on start even when the first-run prompt is answered No; nothing was recorded, armed or played in these runs (the fixtures were written before the scripts closed the device with `Audio_Quit`, which they now do first). Nothing of the owner's REAPER setup or projects was used. |
| Scripts | [`integrations/reaper/spikes/`](../../../../../../integrations/reaper/spikes/): `build_cases.lua` wrote `saved-cases.rpp` and `resave-noop.rpp`; `checklist.lua` wrote `line-identity.rpp`; `spike_s7_fixed_lanes.lua` wrote `fixed-lanes.rpp` and `fixed-lanes-resaved.rpp` (2026-09-23); `make_media.py` wrote the media; `run-reaper.ps1` is the driver. |
| Results | [`docs/research/reaper-spike-s0-item-extension-data.md`](../../../../../../docs/research/reaper-spike-s0-item-extension-data.md) |
| Media | `media/*.wav`: synthetic 3 s sine tones (220, 330 and 440 Hz), 8 kHz mono 16-bit. No narration, no personal audio. |

The files are byte for byte what REAPER wrote (CRLF line endings included, so `.gitattributes` keeps them out of line-ending conversion), with **one mechanical edit**: an absolute media path that pointed into the temp directory of the machine that made them was replaced by the neutral prefix `C:\spike-machine\project\media` (10 lines in `resave-noop.rpp`, 6 in `line-identity.rpp`; the text after `media` is untouched). Nothing else was changed.

## What each file holds

| File | Cases |
| --- | --- |
| `saved-cases.rpp` | Six tracks, eight items. **Multi-take** (three takes; the second is the active one, `TAKE SEL`; take volume; an item note). **Muted** (a muted track holding a muted item `MUTE 1 0` and an audible one). **Section** (`<SOURCE SECTION` wrapping `<SOURCE WAVE`). **Rate and stretch** (`PLAYRATE 1.25 0 ...`, `SM` stretch markers). **FX chains** (`<FXCHAIN` with ReaEQ and ReaComp on the track, `<TAKEFX` with ReaGate and ReaXcomp on a take). **Stamped** (item extension data `<EXTI ...>` and take extension data `<EXT ...>` with the line identity keys, plus a second item with hostile values: quotes, backslash, percent, non-ASCII, a 3,000-character value, a value with a newline). Project markers named `PICKUP: ...` and `PICKUP_DONE: ...`, and three chapter regions, all with GUIDs. Media paths are project-relative (`media/...`). |
| `resave-noop.rpp` | `saved-cases.rpp` opened in REAPER and saved again to a new name with no edit. Compare the two: `ACT 1 -1` becomes `ACT 0 -1`, every track gains `LANEREC -1 -1 -1 0`, the FX chain state blobs gain a preset name (`AAAQAAAA` becomes `AFByb2dyYW0gMQAQAAAA`), and the relative media paths come back **absolute**. The header carries a save time, which differs when the two saves are seconds apart. |
| `fixed-lanes.rpp` | Spike S7 (2026-09-23, same REAPER build, written by `spike_s7_fixed_lanes.lua`, byte for byte, relative media paths): 14 tracks, one per fixed-lane case. Lanes turned on by the API (`FREEMODE 2`, `ITEMLANES 1` with items at `YPOS 0 0.5 2`) and by REAPER's action (`YPOS 0 1 2`); three retakes of one line on lanes 0 to 2 of a 7-lane track with lane 2 playing (`LANESOLO 4`) and named lanes (`LANENAME "Retake 1" ...`); a multi-take item on a lane track; takes converted to lanes (each lane item carries the item's line id) and lanes converted back to takes (the playing lane's take active, `TAKE SEL`); a comp lane "C1" with a comp area (`LINKEDLANE 0 3 3 0 -1 0.01 0.01`) and its copied item. See [the S7 result](../../../../../../docs/research/reaper-spike-s7-fixed-lanes.md). |
| `fixed-lanes-resaved.rpp` | `fixed-lanes.rpp` reopened by the same run and saved again. Shows the phantom lane: the tracks whose lanes were turned on by the API alone go from `ITEMLANES 1` to `ITEMLANES 2`. The one mechanical edit: its 36 absolute media paths into the run's temp folder were replaced by `C:\spike-machine\project\media`. |
| `line-identity.rpp` | The scripted line identity checklist's project after it ran: an item stamped through the real bridge (`stamp_item_lines`), then split (both halves keep the stamp), duplicated and chunk-copied (the copies keep it), so four `<EXTI` blocks; one chapter region made by `create_chapter_regions`; the track was renamed by the script. Media paths are absolute (REAPER wrote them that way after the project was reopened). |

## Things a reader of these files has to handle

- **Item GUIDs are `IGUID`, take GUIDs are `GUID`.** In 7.x an `ITEM` chunk has `IGUID {...}` (the item, what `GetSetMediaItemInfo_String(item, "GUID")` returns) and one `GUID {...}` per take. The older hand-written `basic.rpp` puts the item's GUID under `GUID`.
- **Item name, source and GUID are per take.** The first `NAME` and `<SOURCE>` in an item chunk belong to the first take; the active take is the one marked `TAKE SEL` (the first take has no `TAKE` line).
- **Extension data.** Item level is `<EXTI` and take level is `<EXT`, each holding `key value` lines. A value is a bare token, or quoted with `"..."`, `'...'` or a backtick pair depending on the quotes it contains; a long value or one with a line break is a `<BIN key` block of base64 (wrapped at 128 characters). Values survive save and reload.
- **Regions** are two `MARKER` lines: the start (`MARKER <n> <start> "<name>" 1 <colour> 1 R {GUID} 0 1`) and the end (`MARKER <n> <end> "" 1`). Markers and regions are numbered separately, ordered by time in the file.
- **Fixed item lanes** (`fixed-lanes*.rpp`). An item has no lane number: its lane is its `YPOS <top> <height> 2` line, fractions of the track height (`YPOS 0.5 0.25 2` is lane 2 of 4), with the lane count in the track's `ITEMLANES` and the playing lanes as a bitmask in the first field of `LANESOLO`. Several items at the same position on one lane track are retakes, not overlapping audio. The parser reads the lane (`Item.Lane`) and which lanes play (`Track.PlayingLanes`, every lane when there is no `LANESOLO` line) on a `FREEMODE 2` track only; `reaper_fixed_lanes_test.go` pins what it reads from both files.
- **Sources** can be `<SOURCE SECTION` around the real `<SOURCE WAVE`. `<VST` header lines contain `<` and `>` (`1919247729<5653...>`) and are followed by base64 state.

## Tests

`apps/desktop/internal/tracks/reaper_fixtures_test.go` parses these files and pins what the current parser sees. As of the analysis evidence ledger's Phase 1 (the parser superset), it reads every take, follows the active one (not the first), and reads the item GUID (`IGUID`), mute, per-take `SOFFS`/`PLAYRATE`/`GUID`, `SECTION` offsets, FX-chain presence (`<TAKEFX>` per take, `<FXCHAIN>` per track), a stretch-marker count, and item/take extension data (`<EXTI>`/`<EXT>`, including `<BIN>` blocks). Not yet read: item volume/pan (`VOLPAN`/`TAKEVOLPAN`), item notes, and the `PLAYRATE` line's reverse/pitch fields beyond the rate itself (unverified by any fixture - no reversed item is stamped here). Update those assertions when the parser learns more.

## Regenerating

From the repository root, with REAPER installed, in PowerShell (see the spike README):

```powershell
python integrations/reaper/spikes/make_media.py $env:TEMP\s0\media
pwsh integrations/reaper/spikes/run-reaper.ps1 -Cfg $env:TEMP\s0-cfg -Out $env:TEMP\s0 -Script integrations/reaper/spikes/build_cases.lua -Done $env:TEMP\s0\report.txt
```

then repeat the `-Script checklist.lua` run in a fresh `-Out` folder that also holds `media/`, and apply the path scrub described above. A different REAPER version will write different files: that is the point of recording the version.
