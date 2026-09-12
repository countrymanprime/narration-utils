# DAW Integration Boundary

**Status: REAPER foundation implemented; unified adapter contract planned.**

## REAPER rules

- Keep business logic in Python backends under a tool's `core/` directory. Keep ReaScript UI, project discovery, and marker/take mutations under `daws/reaper/`.
- Continue resolving paths from the script location so checkouts remain relocatable.
- Use existing shared helpers for ExtState, file work, subprocess launch, and pipe-delimited legacy backend protocols.
- For new work, carry REAPER project, track, item, and take GUIDs in the shared finding record; use project-time ranges only as fallbacks.
- All mutation actions must be explicitly triggered by the narrator, wrapped in REAPER undo blocks, and report failures without partially applying unrelated actions.

## Project-sidecar rules

- Store generated, reviewable metadata beside the `.rpp` project in a tool-specific folder.
- Do not rewrite source media or make user choices in place. Keep analyzer output, decision state, and cache data distinct.
- Continue using `<project>/Manuscript.docx` as the common manuscript input until a deliberate migration is specified.

## Audacity boundary

- Audacity is a future adapter, not a Lua port. Its closest finding representation is a UTF-8 label track, and settings need a dedicated local store.
- Use its optional `mod-script-pipe` only from a local desktop process and only after the user has enabled it.
- First adapter scope: import findings as labels, navigate/export reviewed labels, and preserve the DAW-neutral finding data. Take management has no direct Audacity equivalent.

## Acceptance criteria

- A REAPER adapter can navigate, loop, and add an approved marker from a valid finding.
- Failure to resolve a stale GUID produces a reviewable warning and does not operate on an adjacent item.
- Audacity planning never requires REAPER ExtState or take-marker semantics.
