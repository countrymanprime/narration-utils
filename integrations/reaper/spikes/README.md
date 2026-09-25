# REAPER spike scripts

Scripts that run **inside a real REAPER** to answer questions a fake cannot: how REAPER stores and returns things. They are research tools, not product code: they are not part of the app or its installer (`scripts/release/prepare-resources.py` leaves this folder out), and the results are written up in [`docs/research/`](../../../docs/research/) (S0: [reaper-spike-s0-item-extension-data.md](../../../docs/research/reaper-spike-s0-item-extension-data.md); take-review phase 1: [take-review-spike-p1-take-mechanics.md](../../../docs/research/take-review-spike-p1-take-mechanics.md); S7: [reaper-spike-s7-fixed-lanes.md](../../../docs/research/reaper-spike-s7-fixed-lanes.md)).

## Rules (owner decision D3)

- REAPER starts with `-cfgfile <temp>\reaper.ini`, so its resource directory is a temp folder: the owner's REAPER settings, scripts, ExtState and projects are never read or written.
- A project is only ever opened as a **copy** in a temp folder. Never point `-Project` at, or save into, anything under `C:\Users\<you>\Documents\REAPER Media\`. (REAPER writes peak files next to media, so a copy needs its media copied too, or the run must use synthetic media as these scripts do.)
- No audio hardware in use: REAPER opens the default Windows audio device on start even when the first-run "select an audio device" prompt is answered No (WaveOut, Sound Mapper; nothing is recorded, armed or played), so every script closes it first (`reaper.Audio_Quit()`) and asserts it is closed, and no script starts playback or recording.
- `run-reaper.ps1` refuses a `-Cfg`, `-Out` or `-Project` outside the temp folder or under a `REAPER Media` folder, and every script asserts at start that REAPER's resource path is the scratch `-Cfg` folder (so a mis-quoted `-cfgfile` cannot fall back to the owner's real one). `real_project.lua` also stops if a media file resolves outside the scratch folders.
- `run-reaper.ps1` closes only the REAPER process it started.
- Spikes that need audio input, loopback hardware or the owner present (S1, S3, S4) are not here; they stay pending.

## Files

| File | What it does |
| --- | --- |
| `run-reaper.ps1` | The driver: starts REAPER isolated, answers its first-run and close-time dialogs, waits for a "done" file, closes REAPER. Sets `NARRATION_UTILS_SPIKE_OUT` (scratch folder) and `NARRATION_UTILS_REAPER_DIR` (the bridge sources under test) for the scripts. |
| `win.ps1` | Window and dialog helpers for the driver (Win32 and UI Automation). |
| `make_media.py` | Writes three 3-second synthetic tones into `<out>/media`. |
| `probe.lua` | Reports the REAPER version, its Lua version and whether `debug.getinfo` works. |
| `audioprobe.lua` | Reports which audio device REAPER has open right after it starts (WaveOut, Sound Mapper). |
| `enumcheck.lua` | Shows that `reaper.EnumerateFiles` caches a directory listing until it is called with index `-1`. |
| `build_cases.lua` | Builds the fixture project (multi-take, muted, section, rate and stretch, FX, extension data, markers, regions), saves it, reloads it, saves it again, and records the API return shapes the harness fake copies. |
| `real_project.lua` | Opens a copy of a real project, re-saves it unchanged, stamps its first five items through the real bridge and saves again, so the two saved files can be compared. |
| `results/` | The recorded outputs of the runs described in the S0 research doc (paths removed). |
| `checklist.lua` | Loads the real bridge in REAPER and runs the line identity checklist (stamp, undo, idempotence, conflict, stale, split, duplicate, save and reload, notes untouched, regions, and the Transcript Compare commands with a hand-made results file), writing PASS/FAIL per step. |
| `make_length_media.py` | Writes a 1 s, a 5 s and a 4 s synthetic tone into `<out>/media`, for the take-mechanics spike's longer/shorter/offset-alignment cases. |
| `take_mechanics.lua` | Take-review PRD phase 1 (Q4, Q5): builds a target item with one active take, adds a candidate as a new take by source range (same length, longer, shorter, and one needing a source-offset alignment), and checks which take is active, whether item length changes, undo and redo, and namespaced take `P_EXT` provenance (write, read, isolation from item-level line identity, and survival through save and reload). |
| `spike_s7_fixed_lanes.lua` | Spike S7 (follow-through PRD phase 24): fixed item lanes on a scratch project. Enables lanes by the API and by REAPER's action, places retakes on lanes (`I_FIXEDLANE`, `I_NUMFIXEDLANES`), switches lane play state (`C_LANEPLAYS`, the lane actions) with undo and redo, names lanes, converts takes to lanes and back, builds a comp lane and a comp area, turns lanes off, then saves, reopens and saves again. Writes `fixed-lanes-report.txt` plus each track's state chunk under `chunks/`. Result: [reaper-spike-s7-fixed-lanes.md](../../../docs/research/reaper-spike-s7-fixed-lanes.md). |
| `take_review_smoke.lua` | Take-review PRD phase 6 smoke test: loads the real `narration_take_review.lua` (production code, not a copy) into a fresh registry and runs its `create_take` command against a real target item in a scratch copy of `Challenges_001.rpp` (its referenced `Audio Files` copied alongside it) plus a synthetic candidate tone from `make_media.py`. Proves against the real API: the previously active take stays active, the item's `D_LENGTH` is unchanged, and the new take's `P_EXT` provenance survives an `Undo`/`Redo` cycle once re-resolved by GUID (the phase 1 spike's warning). |
| `navigation_check.lua` | Review-dashboard PRD phase 6: loads the real bridge registry and runs `navigate_item`, `loop_context`, `stop_loop`, `ping` and the compare commands against a scratch project built from `make_media.py`'s tones, checking the time selection, loop points and repeat as REAPER reads them back, undo points, the stale rule and the GUIDs on `COMPARE_MARKER`. `OnPlayButton` is replaced by a recorder before the bridge loads, so nothing plays. Recorded in [reaper-navigation.md](../../../docs/architecture/reaper-navigation.md#verification-record). |
| `spike_ep0_workspace.lua` | Edit and proof workspace PRD phase 0 (spike SF and the undo questions): loads the real bridge registry and runs `set_active_take`, `list_fx_chains`, `list_fx`, `apply_fx_chain` and `add_take_fx` against a scratch project built from `make_media.py`'s tones, with `.RfxChain` files it writes into the isolated resource folder from REAPER's own FX chain text. It scripts rows A6 to A8b and A10 of the verification pass, then records what a split does to take FX, take markers, extension data, GUIDs and fades, whether a take FX survives a save and reload, and what `GetMediaItemTake_Peaks` answers for a known tone. Nothing plays. Writes `ep0-workspace-report.txt`. Result: [edit-and-proof-spike-ep0.md](../../../docs/research/edit-and-proof-spike-ep0.md) (the run is pending on the owner). |

## Running one

```powershell
python integrations/reaper/spikes/make_media.py $env:TEMP\spike\media
pwsh integrations/reaper/spikes/run-reaper.ps1 -Cfg $env:TEMP\spike-cfg -Out $env:TEMP\spike `
  -Script integrations/reaper/spikes/checklist.lua -Done $env:TEMP\spike\report.txt
Get-Content $env:TEMP\spike\report.txt
```

Use a fresh `-Out` folder per run (the "done" file must not exist yet), and keep `-Cfg` outside the repository.
