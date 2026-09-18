# Standalone app startup & project picker

**Status: Planned — not implemented.**

## Problem

The app has **never** launched without a project. `shared/reaper/NarrationUtils_Launcher.lua` always resolves the current REAPER project's folder/name and passes `--project-folder`/`--project-name`/`--daw REAPER` when spawning the Wails executable (`project_context()`, `NarrationUtils_Launcher.lua`). The frontend's `StartupScreen.tsx` only has states for connecting-to-host (opening/timeout/error/disconnected) — there is no "no project selected" state, even partial. On the Go side, `shell/app.go`'s config parsing already treats `--project-folder` as optional and `Bootstrap()` degrades gracefully (empty `projectFolder`/`projectName`, no crash) if it's missing — but nothing in the frontend or the OS-level packaging expects or handles that case today. No recent-projects list, no open/create-project dialog, and no OS-level launch path (start-menu/desktop icon, packaging metadata) exist anywhere in the repo.

## Proposal

### 1. Standalone launch path

An OS-level entrypoint (desktop shortcut, Start Menu / Applications entry) that launches the Wails executable with no `--project-folder` argument at all — this already technically works at the Go level (`Bootstrap()` won't crash), it just has nowhere useful to go in the UI today.

### 2. Project picker / creation screen

When `Bootstrap()` reports an empty `projectFolder`, the frontend should show a dedicated screen (not `StartupScreen.tsx`'s connection-status states, which are about a different failure mode) offering:
- **Open recent** — a small persisted list of previously-attached project folders (needs a new small local store; there is no existing "project" concept as an app-owned, browsable unit today — see research below).
- **Browse for a folder** — using Wails' `runtime.OpenDirectoryDialog` (the app already uses `runtime.OpenFileDialog` for `ManuscriptSelectFile`, so the binding pattern is established).
- **Create new** — scaffold a new project folder with the `narration-utils/` sidecar structure the rest of the app already expects (`<project>/narration-utils/manuscript/`, `settings.json`, etc. — see `docs/architecture/daw-integration.md`'s Project-sidecar rules).

### 3. Packaging

No icon, shortcut, or Start Menu registration exists in `shell/wails.json` or the release scripts (`scripts/release/`) today — Wails' default build output is used as-is. This needs platform-specific packaging additions (Windows: an installer that registers a Start Menu entry and optionally a desktop shortcut; the existing PyInstaller-based Python sidecar bundling in `pyproject.toml` is a separate, already-solved concern and not part of this).

## Compatibility constraint

The REAPER-embedded launch path (`NarrationUtils_Launcher.lua` → `--project-folder` always supplied) must keep working unchanged — this is purely additive. `Bootstrap()`'s already-optional `projectFolder` handling means the Go side needs no changes; this is almost entirely frontend (the new picker screen) plus packaging work.

## Out of scope for this doc

The exact on-disk format for a "recent projects" list, and whether "Create new" needs any REAPER-specific scaffolding when created outside a REAPER session — both need product decisions once this is scheduled.
