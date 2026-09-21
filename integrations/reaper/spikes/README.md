# REAPER spike scripts

Scripts that run **inside a real REAPER** to answer questions a fake cannot: how REAPER stores and returns things. They are research tools, not product code: they are not part of the app or its installer (`scripts/release/prepare-resources.py` leaves this folder out), and the results are written up in [`docs/research/`](../../../docs/research/) (S0: [reaper-spike-s0-item-extension-data.md](../../../docs/research/reaper-spike-s0-item-extension-data.md)).

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

## Running one

```powershell
python integrations/reaper/spikes/make_media.py $env:TEMP\spike\media
pwsh integrations/reaper/spikes/run-reaper.ps1 -Cfg $env:TEMP\spike-cfg -Out $env:TEMP\spike `
  -Script integrations/reaper/spikes/checklist.lua -Done $env:TEMP\spike\report.txt
Get-Content $env:TEMP\spike\report.txt
```

Use a fresh `-Out` folder per run (the "done" file must not exist yet), and keep `-Cfg` outside the repository.
