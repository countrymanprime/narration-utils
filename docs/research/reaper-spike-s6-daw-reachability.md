# REAPER spike S6: DAW reachability, executable discovery and auto-run

**Status: done, 2026-09-22. Everything below was observed in REAPER 7.80 on Windows; a different version may differ.** Spike S6, phase 6 of the [project-workspace-and-daw-link PRD](../prds/project-workspace-and-daw-link.prd.md) (Open Questions W10, W11, W12). It answers the three questions Phases 7 and 8 need before they can be scoped, using the same isolated-launch method as [spike S0](reaper-spike-s0-item-extension-data.md).

## What it settles

| Question | Answer | Unblocks |
| --- | --- | --- |
| W10: Can the app know REAPER is running and which project is open? | Yes, with a file-based heartbeat the bridge already has the infrastructure for. `EnumProjects(-1,'')` returns the active tab's path for a saved project and the exact **empty string** (not `nil`) for an unsaved one, confirming the PRD's evidence claim rather than refuting it. | Phase 7 (open-project verification): the heartbeat mechanism is proven; wiring it into `bridge.Client`/`events.go` is that phase's own work, not this spike's |
| W11: Where is `reaper.exe`? | The Windows "Uninstall" registry key's `InstallLocation` value is a reliable, version-independent source (`REAPER (x64)`, 7.80, confirmed on this machine); the `.rpp` file association (`Reaper.Project\shell\open64\command`) is a working fallback. `apps/desktop/internal/daw` implements both, landed in this PR. | Phase 8 (launch DAW): the locator is ready to call; a Settings override field is not added yet, since Phase 8 owns the Settings DAW panel |
| W12: Can the launcher script start automatically when the app launches REAPER? | Yes. `reaper.exe -cfgfile <cfg> "<project.rpp>" "<script.lua>"` (REAPER 6.80+, confirmed the citation in `reaper-automation-surface.md:150`) runs the script immediately at startup with the project already open and `EnumProjects` already reporting it — no user action, no REAPER action/macro needed. | Phase 8, and owner decision D10 (ship auto-start behind a Settings toggle, default OFF, only because this spike proved it works) |

## Method

- **Machine and build.** Windows 11, REAPER 7.80/x64, the same install spike S0 used (`C:\Program Files\REAPER (x64)\reaper.exe`, confirmed present via `Get-ItemProperty` on the Uninstall registry key before any script ran). Every script call closes the audio device first (`reaper.Audio_Quit()`) and asserts it is closed, exactly as S0's guard does; no recording, arming or playback occurred.
- **Isolation.** Reused `integrations/reaper/spikes/run-reaper.ps1` unchanged (owner decision D3): `-cfgfile <temp>\reaper.ini`, `-newinst -noactivate`, and only a **copy** of `Challenges_001.rpp` was ever opened, placed under `%TEMP%\nu-spike-s6\project\`. The original file's SHA-256 (`998B2D14...`) was read and confirmed unchanged both before and after the runs; nothing in `C:\Users\Count\Documents\REAPER Media\Projects\Challenges\` was written to.
- **Script.** [`integrations/reaper/spikes/reachability.lua`](../../integrations/reaper/spikes/reachability.lua), landed in this PR alongside S0's scripts. It runs the same D3 guard as `probe.lua`, then: reads `EnumProjects(-1, '')` and `EnumProjects(n, '')` for every tab (a loop until `nil`), writes a heartbeat line (`RUNNING|<timestamp>|<rpp>|<name>|<unsaved-flag>`, rewritten in place — the same shape a `reaper.defer` timer loop would maintain continuously; this spike snapshots it three times to show the file is safely overwritten rather than appended, since the driver needs the script to finish and signal "done"), and records whether it was itself started together with an already-open project (the W12 evidence).
- **Two runs**, both via `run-reaper.ps1 -IgnoreErrors` (the copied `.rpp`'s media is offline, same as S0's `real_project.lua`; nothing about media was exercised):
  - **Run A** (`-Project <copy of Challenges_001.rpp>`): the saved-project case.
  - **Run B** (no `-Project` argument, REAPER's own default blank project): the unsaved-project case.
- **Registry evidence (W11)**, captured with PowerShell `Get-ItemProperty` before any REAPER script ran, on the Uninstall key and the `.rpp` ProgID:

  ```
  HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\{...}
    DisplayName      = REAPER (x64)
    InstallLocation  = C:\Program Files\REAPER (x64)
    DisplayVersion   = 7.80

  HKEY_CLASSES_ROOT\Reaper.Project\shell\open64\command
    (default) = "C:\Program Files\REAPER (x64)\reaper.exe" -project "%1"
  ```

  Both resolve to the same `reaper.exe`. `HKLM\...\App Paths\reaper.exe` does **not** exist on this install (checked and absent) — the earlier PRD text's "registry lookup" option meant the Uninstall/association keys above, not App Paths, and this spike confirms which of the two actually work.

## Results

### W10 — `EnumProjects` and the heartbeat

| Case | `EnumProjects(-1, '')` second return value | Heartbeat line written |
| --- | --- | --- |
| Run A, saved copy | `C:\Users\Count\AppData\Local\Temp\nu-spike-s6\project\Challenges_001_copy.rpp` (non-empty, matches the copy's real path) | `RUNNING\|231331.20...\|C:\...\Challenges_001_copy.rpp\|Challenges_001_copy.rpp\|0` |
| Run B, unsaved | `""` (empty string, confirmed `rpp_is_empty_string=true` and `rpp_is_nil=false` — REAPER always returns a project pointer and a string, never `nil` for the string) | `RUNNING\|231364.99...\|\|\|1` |

A second, independent enumeration loop (`EnumProjects(0..n, '')` until it returns `nil`) reported exactly one project in both runs — REAPER always has at least the active tab, so "no tabs" is not a case the app needs to model; "the active tab is unsaved" is, and it is exactly the empty string the PRD's evidence section already described. **This confirms the PRD's claim rather than refuting it.**

The heartbeat file mechanism itself (write one line, rewrite in place, poll from Go) needed no new REAPER capability: `io.open(path, 'w')` from inside REAPER's Lua and REAPER's existing per-command polling model (the same `session_dir` files the bridge already uses) are sufficient. **Not implemented in this PR**: wiring a `reaper.defer`-driven heartbeat loop into `narration_ui_bridge.lua`, a `PROJECT_STATUS`/`report_project` event in `apps/desktop/internal/bridge/wire.go`'s table, and a Go consumer (`daw.Reachable()`/`daw.CurrentProject()` reading it) — that is real product surface belonging to Phase 7, which this spike only de-risks. The alternative the PRD raised, an `events.log` event, is equally viable: the fan-out in `events.go` already broadcasts an event with an empty run ID (`Fields[1] == ""`) to every subscriber regardless of `Owns`, which is exactly the "no run in progress, tell everyone" shape a heartbeat needs — no protocol change beyond a new row in `wire.go`'s table. Recommendation for Phase 7: the `events.log` event route, not a second polled file, since it reuses `Dispatch`/`Subscribe` instead of adding a new poll loop to the Go host.

### W11 — locating `reaper.exe`

Landed in this PR as `apps/desktop/internal/daw`:

- `LocateReaperExecutable()` (Windows-only, `locate_windows.go`) reads the Uninstall registry key (both `HKLM\SOFTWARE\...\Uninstall` and the `WOW6432Node` view) via `golang.org/x/sys/windows/registry` (already a direct dependency, no new one added), matches a `DisplayName` of exactly `REAPER` or `REAPER (<arch>)` (`looksLikeReaper`, narrower than a bare prefix match so an unrelated program cannot collide), and falls back to the `.rpp` file association command if no Uninstall entry's `InstallLocation` has a `reaper.exe` on disk.
- `Resolve(override, autoDetect)` lets a Settings override always win when it names a real file, otherwise calls auto-detect — the owner recommendation ("auto-detect... with a manual override setting").
- Verified against the real install on this machine: `LocateReaperExecutable()` returned `C:\Program Files\REAPER (x64)\reaper.exe` via `uninstall_registry`.
- **Not implemented in this PR**: the Settings field itself (a `DAW.reaper_path` key needs no schema change — `settings.Store` already stores an arbitrary `tool.key` string through its three-layer contract — but the Settings UI panel and the "detached launch, not through the sidecar supervisor's kill-on-close job" launch code are Phase 8's scope).

### W12 — auto-running the launcher script

Both spike runs launched REAPER with `"<project or nothing>" "reachability.lua"` on the command line — the same `<cfgfile> [project] script` form `NarrationUtils_Launcher.lua`'s own bridge already assumes is possible, and the exact form `reaper-automation-surface.md:150` cited as unverified. In both runs the script executed immediately at REAPER startup, with no dialog, action or narrator step, and `launch-mode-report.txt` recorded `script_ran_at_launch=true` with the project already visible to `EnumProjects` in run A. This is a clean, repeatable "yes": REAPER 6.80+ (confirmed on 7.80) runs a script argument automatically at launch, together with a project argument.

This directly enables the Phase 8 flow the PRD describes: when the app itself starts `reaper.exe`, it can pass `NarrationUtils_Launcher.lua` as the trailing script argument so the bridge is live the moment REAPER opens, without the narrator running the "Narration Utils" action by hand. It does **not** by itself resolve the tension the PRD notes ("REAPER is never modified automatically") — that is a policy question the owner already answered in D10 (ship it, but behind a Settings toggle defaulting OFF), not a technical one this spike needed to re-litigate.

## Not done, and why

- **The Lua heartbeat loop, the `PROJECT_STATUS` wire event, and `daw.Reachable()`/`daw.CurrentProject()` Go functions** are Phase 7 scope (W10's own "resolved by" language in the PRD names Phase 7/8 as the implementation phases; Phase 6 is "docs plus scratch work," per the phase table). This spike proves the mechanism; it does not ship it, to keep this PR's surface to what a spike should land.
- **The Settings DAW panel, override field and detached launch action** are Phase 8 scope for the same reason. `daw.Resolve`/`LocateReaperExecutable` are ready for that phase to call.
- **A real second/other REAPER project tab** (`EnumProjects(1, '')` etc. with more than one tab actually open) was not separately exercised beyond the "no more than one tab" loop above; both runs opened exactly one project, which is REAPER's default. Nothing in the API suggests multi-tab behavior differs (the loop already walks every tab index), but it was not observed directly.
- **`ShellExecute`-style association launching** (actually opening a `.rpp` through the shell rather than just reading where its handler points) was not exercised; only the registry values were read. The command string parses cleanly and was not run.

## Reproduce

```powershell
$spike = "$env:TEMP\nu-spike-s6"
New-Item -ItemType Directory -Force "$spike\project","$spike\cfg-a","$spike\cfg-b","$spike\out-a","$spike\out-b" | Out-Null
Copy-Item "C:\Users\<you>\Documents\REAPER Media\Projects\Challenges\Challenges_001.rpp" "$spike\project\Challenges_001_copy.rpp"

cd integrations/reaper/spikes
pwsh run-reaper.ps1 -Cfg "$spike\cfg-a" -Out "$spike\out-a" -Script reachability.lua `
  -Project "$spike\project\Challenges_001_copy.rpp" -Done "$spike\out-a\report.txt" -IgnoreErrors
pwsh run-reaper.ps1 -Cfg "$spike\cfg-b" -Out "$spike\out-b" -Script reachability.lua `
  -Done "$spike\out-b\report.txt"

Get-Content "$spike\out-a\enumprojects-report.txt", "$spike\out-a\heartbeat.txt", "$spike\out-a\launch-mode-report.txt"
Get-Content "$spike\out-b\enumprojects-report.txt", "$spike\out-b\heartbeat.txt", "$spike\out-b\launch-mode-report.txt"
```

Use a fresh `-Out` folder per run (the "done" file must not already exist), and keep `-Cfg`/`-Out`/`-Project` outside the repository under the temp folder, per `run-reaper.ps1`'s own guard.
