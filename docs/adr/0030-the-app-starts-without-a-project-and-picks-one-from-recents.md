# 0030. The app can start without a project and picks one from a per-user recents list

**Status:** Proposed
**Date:** 2026-09-19

## Context

The app was launched only from REAPER: `shared/reaper/NarrationUtils_Launcher.lua` resolves the open project's folder and name and passes `--project-folder`, `--project-name` and `--daw REAPER` to the Wails executable, so the frontend never had a "no project" state. Reading tracks from the `.rpp` and working on a manuscript need no running REAPER, and a narrator should be able to open the app on its own and choose a project. Both entry points have to coexist, and the REAPER one must keep working unchanged. The design record is [standalone-launch.md](../architecture/standalone-launch.md).

## Decision

1. An empty `projectFolder` in `Bootstrap` (`shell/app.go:560`) is a first-class state. `App.tsx` shows `ProjectPicker` instead of the app while it is empty (`shared/ui/src/App.tsx:156`). The picker is a separate screen from `StartupScreen.tsx`, which is only about connecting to the host.
2. `ProjectSwitch` (`shell/bindings.go:195`) is the one place a picker-chosen project is attached. It sets the DAW to `"Standalone"`, goes through the same in-flight-work guard as the REAPER second-launch path (`attachProjectLocked`, `shell/app.go:394`, which refuses while work is running), records the project in recents, and emits `system:attached`, which the UI turns into a bootstrap refresh. The other bindings are `ProjectSelectFolder`, `ProjectCreate`, `ProjectRecents` and `ProjectRemoveRecent`.
3. Recent projects are stored per user, not per project, in `%APPDATA%\narration-utils\recent-projects.json` (falling back to `%USERPROFILE%\AppData\Roaming\...`, `recentProjectsPath` in `shell/app.go`). `shell/internal/recents/store.go` keeps at most 10 entries, dedupes by path case-insensitively, and drops entries whose folder no longer exists, both when adding (`Touch`) and when listing (`List`). A missing or corrupt file reads as an empty list.
4. "Create new" only creates the folder (`os.MkdirAll` in `ProjectCreate`) and then switches to it. The `narration-utils/` sidecar folders are created lazily by whichever service first writes to them, for example `shell/internal/manuscript/service.go:332`. Nothing is scaffolded in REAPER.
5. The REAPER launcher is unchanged and still always passes `--project-folder`, `--project-name` and `--daw REAPER` (`shared/reaper/NarrationUtils_Launcher.lua:104-109`).

## Consequences

- A launch without a project works, and a REAPER launch behaves as before.
- A standalone project has no REAPER session directory, so no bridge client exists and (`shell/app.go:169-172`) every bridge-backed feature is unavailable: Transcript Compare cannot prepare, jump or export (`shell/internal/transcript/service.go:97,233,267`), and any future bridge command is unavailable the same way. Features that read the saved `.rpp` directly, such as Tracks, still work.
- A standalone launch also needs an entry point: no installer, Start Menu entry or desktop shortcut exists yet, so today it means running the executable by hand. That is planned in the release readiness PRD.
- Pruning is silent and immediate. A project on a drive that is unplugged or a share that is offline disappears from the list, and the next `Touch` writes the shorter list to disk, so it does not reappear when the drive returns.
- Case-insensitive dedupe is applied on every platform, not just Windows; that suits Windows paths and would merge two distinct paths on a case-sensitive filesystem. The recents location already assumes `%APPDATA%`, so the feature is Windows-first until that is revisited.
- A recents write failure is deliberately swallowed so it cannot fail a switch, which means a broken `%APPDATA%` shows up only as an empty list.
- Because sidecar folders appear on first write, a freshly created project is an empty directory until something is saved into it.
- Changing where recents live, or scaffolding the sidecar folders at creation, would need a new ADR that supersedes this one.
