# 0235. One create_regions command serves chapter and credits regions and replaces create_chapter_regions

**Status:** Accepted
**Date:** 2026-09-25

## Context

Two PRDs need REAPER regions: the follow-through PRD's Phase 7 (a region per chapter from its matched track, RF-7) and [credits in the chapter table](../prds/credits-in-chapter-table.prd.md) Phase 4 (credits regions named like the chapter table's rows, so the `$region` render writes separate credits files). `create_chapter_regions` in `narration_line_identity.lua` already created regions from a `start|end|title` payload, idempotently, and was verified in a scripted REAPER 7.80 run, but no host code called it, and re-running it after a chapter was re-recorded added a second region with the same title.

## Decision

`create_chapter_regions` is replaced by one command, `create_regions(run, payloadPath, colour, update)`, in its own file, `integrations/reaper/narration_regions.lua`. It keeps the payload, the 0.01 s duplicate rule and the one undo block ("Narration Utils: create regions") of the command it replaces. New: with `update` 1, a row whose title exactly one region holds, with other bounds, moves that region (`SetProjectMarker4`, keeping its number and colour); a title several regions hold is left alone and counted `ambiguous`; a region REAPER refuses to add is counted `failed`. `REGIONS_CREATED` gains `updated`, `ambiguous` and `failed` as optional fields. Credits rows are rows like any other; the host names them. The Go client is `bridge.Actions.CreateRegions`, which writes the payload in the session folder and removes it afterwards; the command is experimental ([ADR 0230](0230-reaper-commands-built-before-the-verification-pass-are-refused-by-the-host-while-the-experimental-switch-is-off.md)) until the verification pass (row A9), because the update path is new.

## Consequences

- One command, one harness file (`regions_test.lua`), one set of mutation checks for both PRDs.
- An older script answers `Unsupported workspace command` to `create_regions`, which the client reports as `ErrScriptOutdated`; nothing sent the old name, so nothing breaks.
- A region the narrator renamed to a chapter's exact title can be moved by an update run; the update flag is off unless the host asks for it.
