# DAW Integration Boundary

**Status: native Wails desktop workspace and REAPER file bridge implemented.**

## REAPER rules

- Keep business logic in Go and user-facing UI in React. The two packaged Python analysis sidecars remain Manuscript Guide and Transcript Compare. Keep only project discovery, manifest construction, marker/take mutations, and cursor navigation in REAPER Lua.
- Reading a project's track and item metadata does not need REAPER at all: the Go `tracks` package parses the `.rpp` file directly, so the [Tracks](../utilities/tracks.md) page works in a standalone launch. The "project discovery in Lua" rule above applies to state only a running REAPER knows (selection, edit cursor, take markers); anything derivable from the saved project file stays in Go.
- The installed launcher resolves its adjacent Wails executable and resource bridge; checkout paths are a development-only fallback.
- The launcher does not read or write ExtState paths. Go resolves the shared layered JSON settings and passes explicit marker colors with the marker-export command.
- Import `NarrationUtils_Launcher.lua` into REAPER's Action list. It starts the non-blocking native Wails workspace and its file-session bridge for REAPER-only operations. There is no loopback server, REST endpoint, browser tab, or port override.
- The workspace is a native Wails window. REAPER launches the executable directly; it does not use a loopback port, REST endpoint, browser tab, or port override.
- For new work, carry REAPER project, track, item, and take GUIDs in the shared finding record; use project-time ranges only as fallbacks.
- All mutation actions must be explicitly triggered by the narrator, wrapped in REAPER undo blocks, and report failures without partially applying unrelated actions. Transcript Compare therefore inspects take markers after analysis and only writes its pending findings when the narrator selects **Export markers**.
- Before export, the REAPER adapter marks a finding as already marked when the same active take has a marker within 0.15 seconds with the same case-insensitive issue prefix (`MISREAD:`, `SKIPPED:`, or `EXTRA:`). Export rechecks immediately before every add and reports added and skipped counts.

## Settings layering

Every user setting is resolved by the Go host through the same layered rules against the same on-disk JSON files, not REAPER ExtState. The Python sidecars receive their settings through their explicit command contracts. Three tiers, most-specific first:

1. Project override - `<project folder>/narration-utils/settings.json` (see Project-sidecar rules below).
2. Per-user global - `%APPDATA%/narration-utils/global-settings.json`.
3. Repo default - `shared/config/defaults.json`, checked in.

REAPER never parses this JSON. The Wails host owns setting resolution and passes marker colors with the explicit marker-export command.

## Project-sidecar rules

- Store generated, reviewable metadata beside the `.rpp` project in a tool-specific folder.
- Do not rewrite source media or make user choices in place. Keep analyzer output, decision state, and cache data distinct.
- Use `<project>/narration-utils/manuscript/manuscript.json` as the common manuscript input. Source DOCX and Markdown files are copied into the manuscript source folder at explicit import time; runtime tools never parse them. Existing canonical PDF-derived v1 data remains readable, but new PDF import is fail-closed pending corpus parity.
- A project's settings overrides live in one shared sidecar, `<project>/narration-utils/settings.json` (sectioned by tool name), separate from each tool's own generated-output folder - it holds user-set overrides, not analyzer output.

## Audacity boundary

- Audacity is a future adapter, not a Lua port. Its closest finding representation is a UTF-8 label track. The layered Python config module and React workspace are DAW-agnostic, so an Audacity adapter reuses them directly.
- Use its optional `mod-script-pipe` only from a local desktop process and only after the user has enabled it.
- First adapter scope: import findings as labels, navigate/export reviewed labels, and preserve the DAW-neutral finding data. Take management has no direct Audacity equivalent.

## Acceptance criteria

- A REAPER adapter can navigate, loop, and add an approved marker from a valid finding.
- Failure to resolve a stale GUID produces a reviewable warning and does not operate on an adjacent item.
- Audacity planning never requires REAPER ExtState or take-marker semantics.
