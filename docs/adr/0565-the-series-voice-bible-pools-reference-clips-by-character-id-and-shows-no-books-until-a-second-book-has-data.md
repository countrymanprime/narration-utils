# 0565. The series voice bible pools reference clips by character id, and shows nothing until a second book has data

**Status:** Accepted
**Date:** 2026-09-28

## Context

`docs/prds/character-continuity-review.prd.md` Phase 11 needs a single view of a character's approved reference clips across every book of a series, each clip labeled by its source book, building on Phase 9's storage (`internal/series`, ADR 0450) and Phase 6's reference data (`internal/character`, ADR 0263). Owner decision D87 on #509 still benches the acoustic engine, so this is reference data only - no per-book drift evidence (Phase 10, also benched) has anywhere to attach.

Two things this phase settles that Phase 9 left open: how references from different books are grouped into "one character", and what a series with only one book so far should show (Phase 11's own success signal: an honest empty state, not an error).

## Decision

- **Grouping is by character id, with no new mapping table.** `manuscript_guide.py`'s `entity_id(name)` is a hash of the normalized name alone, with no per-project salt, so the same character name in two different books already produces the same id. `series.BuildVoiceBible` (`apps/desktop/internal/series/voicebible.go`) pools the current project's own references (`character.Service.References`) and every sibling's (`series.Siblings`, ADR 0450) into one `VoiceBibleCharacter` per id, sorted by clip approval time within a character and by name across characters.
- **A clip's `book` label is its source project folder's own base name** (`filepath.Base`), not a narrator-set title. Reading a nicer title would mean a new cross-project read of `project.Manifest` for no analytical benefit; the folder name is what a narrator already sees in the picker and is always available.
- **A character's display name** is resolved from Story Bible entities: the current project's own first (a new `guide.ReadOnlyNames`, see ADR 0568), then any sibling book's, first match wins in member order; a character with no Story Bible entry anywhere (should not happen in practice, but is not assumed) falls back to its own id rather than an empty label.
- **Nothing is fetched, and no character list is built, for a series of one.** `BuildVoiceBible` returns early - `InSeries: true, BookCount: 1` and no `Characters` - the moment `ForProject` resolves a series with only the caller's own project in it, before reading any sibling data at all. This is the same "no other books in this series yet" state whether the project is in no series or in a solitary one, matching Phase 11's own success signal, and it is a server-side decision, not a UI-side filter over data the host bothered to fetch.
- **An unreadable sibling is reported, not fatal:** `VoiceBible.UnreadableBooks` names (by book label) any member whose `references.json` exists but could not be decoded (`Siblings`' own `Unreadable`, ADR 0450); the rest of the view still renders.
- **Series ids are now 32 lowercase hex characters, not `"s-" + 32 hex characters`** (`internal/series.newSeriesID`, changed in this phase): the codebase's contract-stabilization convention (`internal/contractfile.Stabilize`) recognizes exactly a bare 32-hex-character string as a random id and replaces it with `id-1`, `id-2`, ... in a golden fixture; the `"s-"` prefix Phase 9 used would never be recognized, leaving a real random value baked into a committed golden. Phase 9 never put a series id on the wire, so this is a free, pre-release format fix, not a migration.

## Consequences

- The view is read-mostly: it never mutates a sibling's data, matching ADR 0450's read-only boundary. Approving or revoking a reference still only ever happens through the current project's own `character.Service`, from the entity's own reference section, not from the Series tab.
- Two characters that happen to normalize to the same name across unrelated books (a coincidence, not a shared character) would still be pooled together; this is the same identity assumption `entity_id` already makes within one book's rebuilds, extended across books rather than newly introduced here.
- If the acoustic engine is ever unbenched and Phase 10 lands, its findings would extend `VoiceBibleClip`, not replace this grouping - the pooling-by-id structure this ADR settles is what a later drift finding would still need.
