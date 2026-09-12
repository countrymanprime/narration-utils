# DAW Integration Boundary

**Status: REAPER foundation implemented; unified adapter contract planned.**

## REAPER rules

- Keep business logic in Python backends under a tool's `core/` directory. Keep ReaScript UI, project discovery, and marker/take mutations under `daws/reaper/`.
- Continue resolving paths from the script location so checkouts remain relocatable.
- Use existing shared helpers for ExtState, file work, subprocess launch, and pipe-delimited legacy backend protocols. ExtState itself is now scoped narrowly to the one thing that's genuinely REAPER/bootstrap-specific per tool (where `python.exe`/the backend script live) - every other setting is resolved through the shared, DAW-agnostic Python config layer (see below), reached from Lua via `shared/reaper/reaper_common_pyconfig.lua`.
- Import only `shared/reaper/NarrationUtils_Launcher.lua` into REAPER's Action list. It starts one centered Python/Tk Narration Utils workspace and a small file-session bridge for REAPER-only operations; users choose tools, manuscripts, and settings inside that workspace instead of a transient launcher menu.
- For new work, carry REAPER project, track, item, and take GUIDs in the shared finding record; use project-time ranges only as fallbacks.
- All mutation actions must be explicitly triggered by the narrator, wrapped in REAPER undo blocks, and report failures without partially applying unrelated actions.

## Settings layering

Every setting other than a tool's `python.exe`/backend-script bootstrap path is resolved through a shared, DAW-agnostic Python module (`shared/python/narration_common/config.py`), not REAPER ExtState - so the same storage and resolution logic (and the same settings window) will already work for a future non-REAPER adapter instead of needing its own. Three tiers, most-specific first:

1. Project override - `<project folder>/narration-utils/settings.json` (see Project-sidecar rules below).
2. Per-user global - `%APPDATA%/narration-utils/global-settings.json`.
3. Repo default - `shared/config/defaults.json`, checked in.

A DAW's scripting side never parses this JSON itself: it shells out to `shared/python/config_cli.py` for a value it needs directly (e.g. REAPER take-marker colors), while the persistent `shared/python/narration_hub.py` owns the user-facing settings view. It otherwise passes `--docx`/config-derived paths to analyzer backends, which are free to resolve their own settings the same way.

## Project-sidecar rules

- Store generated, reviewable metadata beside the `.rpp` project in a tool-specific folder.
- Do not rewrite source media or make user choices in place. Keep analyzer output, decision state, and cache data distinct.
- Continue using `<project>/Manuscript.docx` as the common manuscript input until a deliberate migration is specified.
- A project's settings overrides live in one shared sidecar, `<project>/narration-utils/settings.json` (sectioned by tool name), separate from each tool's own generated-output folder - it holds user-set overrides, not analyzer output.

## Audacity boundary

- Audacity is a future adapter, not a Lua port. Its closest finding representation is a UTF-8 label track. Settings no longer need a bespoke dedicated store per DAW: the layered Python config module and settings window above are already DAW-agnostic, so an Audacity adapter reuses them directly rather than porting REAPER's ExtState-based approach.
- Use its optional `mod-script-pipe` only from a local desktop process and only after the user has enabled it.
- First adapter scope: import findings as labels, navigate/export reviewed labels, and preserve the DAW-neutral finding data. Take management has no direct Audacity equivalent.

## Acceptance criteria

- A REAPER adapter can navigate, loop, and add an approved marker from a valid finding.
- Failure to resolve a stale GUID produces a reviewable warning and does not operate on an adjacent item.
- Audacity planning never requires REAPER ExtState or take-marker semantics.
