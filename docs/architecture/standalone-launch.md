# Standalone app startup & project picker

**Status: Implemented** (project picker and recent projects). The OS-level entry points (installer, Start Menu entry, desktop shortcut) are not built; see [Packaging](#packaging-not-built).

## Problem

The app was originally launched only from REAPER: `shared/reaper/NarrationUtils_Launcher.lua` resolves the current REAPER project's folder and name and passes them as `--project-folder`/`--project-name`/`--daw REAPER` when spawning the Wails executable, so the frontend never had a "no project selected" state. This document records how a launch without a project is handled.

## What shipped

- **Empty project folder is a first-class state.** `Bootstrap()` (`shell/app.go:560`) already tolerated an empty `projectFolder`. The frontend shows `ProjectPicker` instead of the app whenever `data.projectFolder` is empty (`shared/ui/src/App.tsx:156`); it is a separate screen from `StartupScreen.tsx`, which is only about connecting to the host.
- **Bindings** (`shell/bindings.go`): `ProjectSelectFolder` (`:175`, a native folder dialog that can create directories), `ProjectSwitch` (`:195`), `ProjectCreate` (`:219`), `ProjectRecents` (`:229`) and `ProjectRemoveRecent` (`:240`). `ProjectSwitch` is the one place a picker-chosen project is attached: it sets the DAW to `"Standalone"` (`:202`), goes through the same in-flight-work guard as the REAPER second-launch path (`attachProjectLocked`, `shell/app.go:394`, which refuses with "busy" while work is running), records the project in recents, and emits `system:attached`, which `App.tsx` turns into a bootstrap refresh.
- **Recent projects** live in `%APPDATA%\narration-utils\recent-projects.json` (falling back to `%USERPROFILE%\AppData\Roaming\...`, `shell/app.go:100`), not in the project, because the list is per user. The store (`shell/internal/recents/store.go`) keeps at most 10 entries (`:18`), dedupes by path case-insensitively, and drops entries whose folder no longer exists both when adding (`Touch`, `:38`) and when listing (`List`, `:85`). A missing or corrupt file reads as an empty list.
- **Picker actions** (`shared/ui/src/components/project/ProjectPicker.tsx`): open a recent project or remove one from the list, "Browse..." to an existing folder (`:92`), and "Create new..." (`:99`).
- **"Create new" only makes the folder.** `ProjectCreate` runs `os.MkdirAll` on the chosen path and then `ProjectSwitch`. The `narration-utils/` sidecar folders (`manuscript/`, settings and so on) are created lazily by whichever service first writes to them (for example `shell/internal/manuscript/service.go:332,366`), and nothing scaffolds anything in REAPER: the DAW is `Standalone`.
- **The REAPER launcher is unchanged** and still always passes `--project-folder`, `--project-name` and `--daw REAPER` (`shared/reaper/NarrationUtils_Launcher.lua:104-109`), so the embedded launch path behaves as before.

## Packaging (not built)

No installer definition, Start Menu entry or desktop shortcut exists yet. Windows needs an installer that registers a Start Menu entry and optionally a desktop shortcut so the app can be launched with no `--project-folder` at all, which the picker above already handles. This is planned in [release-readiness-provisioning-and-docs-site.prd.md](../prds/release-readiness-provisioning-and-docs-site.prd.md) (Windows installer phase). The PyInstaller sidecar bundling is a separate, already-solved concern.
