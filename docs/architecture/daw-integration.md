# DAW Integration Boundary

**Status: React workspace and REAPER integration bridge implemented.**

## REAPER rules

- Keep business logic and all user-facing UI in Python/React. Keep only project discovery, manifest construction, marker/take mutations, and cursor navigation in REAPER Lua.
- Continue resolving paths from the script location so checkouts remain relocatable.
- The launcher resolves only repo-relative, gitignored local environments. It does not read or write ExtState paths; all user settings are resolved by the shared, DAW-agnostic Python config layer.
- Import only `shared/reaper/NarrationUtils_Launcher.lua` into REAPER's Action list. It starts the non-blocking React/Python workspace (`shared/server`, opened in the user's default browser) and its file-session bridge for REAPER-only operations.
- For new work, carry REAPER project, track, item, and take GUIDs in the shared finding record; use project-time ranges only as fallbacks.
- All mutation actions must be explicitly triggered by the narrator, wrapped in REAPER undo blocks, and report failures without partially applying unrelated actions. Transcript Compare therefore inspects take markers after analysis and only writes its pending findings when the narrator selects **Export markers**.
- Before export, the REAPER adapter marks a finding as already marked when the same active take has a marker within 0.15 seconds with the same case-insensitive issue prefix (`MISREAD:`, `SKIPPED:`, or `EXTRA:`). Export rechecks immediately before every add and reports added and skipped counts.

## Settings layering

Every user setting is resolved through the same layered rules against the same on-disk JSON files, not REAPER ExtState - implemented once in Python (`shared/python/narration_common/config.py`), used directly by the Manuscript Guide and Transcript Compare tool backends for their own argparse defaults, and by `shared/server` (the settings window's host) - no separate port. Three tiers, most-specific first:

1. Project override - `<project folder>/narration-utils/settings.json` (see Project-sidecar rules below).
2. Per-user global - `%APPDATA%/narration-utils/global-settings.json`.
3. Repo default - `shared/config/defaults.json`, checked in.

REAPER never parses this JSON. The persistent server (`shared/server`) owns setting resolution and passes marker colors with the explicit marker-apply command.

## Project-sidecar rules

- Store generated, reviewable metadata beside the `.rpp` project in a tool-specific folder.
- Do not rewrite source media or make user choices in place. Keep analyzer output, decision state, and cache data distinct.
- Continue using `<project>/Manuscript.docx` as the common manuscript input until a deliberate migration is specified.
- A project's settings overrides live in one shared sidecar, `<project>/narration-utils/settings.json` (sectioned by tool name), separate from each tool's own generated-output folder - it holds user-set overrides, not analyzer output.

## Audacity boundary

- Audacity is a future adapter, not a Lua port. Its closest finding representation is a UTF-8 label track. The layered Python config module and React workspace are DAW-agnostic, so an Audacity adapter reuses them directly.
- Use its optional `mod-script-pipe` only from a local desktop process and only after the user has enabled it.
- First adapter scope: import findings as labels, navigate/export reviewed labels, and preserve the DAW-neutral finding data. Take management has no direct Audacity equivalent.

## Acceptance criteria

- A REAPER adapter can navigate, loop, and add an approved marker from a valid finding.
- Failure to resolve a stale GUID produces a reviewable warning and does not operate on an adjacent item.
- Audacity planning never requires REAPER ExtState or take-marker semantics.
