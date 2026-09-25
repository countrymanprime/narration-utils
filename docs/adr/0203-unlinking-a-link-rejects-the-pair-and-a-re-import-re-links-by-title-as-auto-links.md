# 0203. Unlinking a link rejects the pair, and a re-import re-links the old links by title as auto-links

**Status:** Proposed
**Date:** 2026-09-25

## Context

ADR 0202 makes a confident two-way match an automatic link, with Undo recorded as a rejection so sync never makes the pair again. Two cases the owner's decisions (D25, `docs/prds/implementation-plan.md` section 6) do not settle came up while building the store (`docs/prds/daw-chapter-track-auto-sync.prd.md` Phase 2):

1. The narrator removes an auto-link some other way than Undo: the Home track-link control's Unlink (`ChapterTrackUnlink`, which calls `ClearChapter`), or the Tracks page's clear (`ChapterTrackMapClear`, which calls `Clear`). If that is not a rejection, the next sync links the same pair again at once, and Unlink does nothing the narrator can see.
2. A manuscript re-import renumbers every chapter id. ADR 0100 and Q9 of the evidence ledger PRD chose "cleared, then re-suggested from stored titles". `evidence.SuggestFromPrevious` was written for this, but nothing in production called it. With sync, re-suggesting can become re-linking, and the question is what those links are labelled.

## Decision

Recommended, and built in Phase 2, pending the owner's review:

- **Clearing a link records the rejection, as Undo does, whatever its origin.** `MappingStore.Clear` and `ClearChapter` add a (track GUID, chapter title) rejection for every link they remove. A manual link is included because its track's name may also match the chapter confidently, and then the next sync would re-link the pair the narrator just unlinked.
- **A re-import carries the old links forward, and sync re-links them as auto-links.** On a confirmed Replace manuscript, `manuscript.runCommit` reads the old mapping file (`evidence.ReadCarryOver`) before `resetDerived` deletes it. After the commit it writes the new document's mapping file with no links, the old links as `previous` and the old rejections kept (`MappingStore.Carry`). `chaptersync.Build` re-links a previous link first: when its remembered chapter title confidently names a chapter of the new manuscript, the track is still in the project and neither is linked, the link comes back with `origin: auto` and `match.kind: previous-link`. This happens even when the track's own name matches nothing. Clear (not Replace) carries nothing.
- **Re-linking waits for consent.** Until Phase 3 stores the project's sync decision, the carried links sit in `previous` and are not links. A project with sync off shows them as Needs you (Phase 3), not as links.

## Consequences

- An unlinked chapter stays unlinked across syncs. To get the same pair back, the narrator links it by hand, which also lifts the rejection.
- A link the narrator made by hand before a re-import comes back labelled Auto-linked. The alternative, keeping `manual`, would make sync the author of a link it then refuses to undo. The owner may prefer that. A later ADR can carry the origin across instead (`CarryOver.Links` keeps it).
- A rejection is keyed by chapter title, so it outlives a re-import. A rejection whose chapter was renamed simply stops matching anything.
- If the owner rejects this, a superseding ADR changes the `Clear`/`ClearChapter` rejection and the origin that `chaptersync.Build` writes for `previous-link` matches.
