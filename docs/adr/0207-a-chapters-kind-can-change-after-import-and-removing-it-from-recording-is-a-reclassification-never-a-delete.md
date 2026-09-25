# 0207. A chapter's kind can change after import, and removing it from recording is a reclassification, never a delete

**Status:** Accepted
**Date:** 2026-09-25

## Context

`docs/prds/chapter-track-link-control.prd.md` asks for a way to take a wrongly imported chapter out of the book's numbers without Replace manuscript. Replace manuscript clears every status, note, finding, link and check result. Before this, `manuscript.json` was written once per import, and nothing could change a chapter afterwards. The owner settled the approach on 2026-09-24. D31 (TL2) says to reclassify a chapter as reference material and never delete it. D32 (TL3) says a chapter has exactly one track. D39 takes the PRD's recommendation for TL5 (clear a removed chapter's links) and TL6 (a confirm, then a "Removed from recording" list with Restore). The alternatives were a hard delete, a separate `excluded` flag, and a merge into the previous chapter. A hard delete breaks the ids that fourteen host packages read and leaves gaps in the global paragraph index. A flag would need every consumer to learn a second filter. A merge rewrites paragraph `chapterId`s and invalidates findings and results. This builds on ADR 0005, 0088 and 0090 and supersedes none.

## Decision

- **One binding reclassifies.** `ManuscriptSetChapterKind(chapterID, kind)` (`apps/desktop/chapterkind.go`, over `manuscript.Service.SetChapterKind`) accepts `narration`, `reference` or `opening`. `reference` is "Not a chapter", `opening` is "Front matter", and `narration` is Restore. It rewrites only that chapter's `contentKind` in `manuscript.json`, through a temporary file and a rename, under the service's lock. The document id, every chapter and paragraph id, the paragraphs and `importedAt` stay the same. So the statuses, notes, bookmarks, findings and check results of every chapter stay valid, and a restored chapter comes back with its status.
- **What it records.** The first change records `importedKind`, the kind the chapter was imported as. Each change records `kindChangedAt`. The chapter list sends `kindChangedAt` and, while a chapter imported as narration is another kind, `removedFromRecording: true`. The UI lists those chapters under "Removed from recording" with Restore. Asking for the kind a chapter already has writes nothing.
- **What it refuses.** It refuses while any import job is open, for a chapter that is not in the manuscript, and for the last narration chapter.
- **A removal clears the chapter's links** (TL5 A) through `MappingStore.ClearChapter`, which records each pair as rejected (ADR 0203). The track is then free for another chapter, and no hidden chapter holds a track that the matcher treats as taken. The answer lists the cleared links. Restore does not re-link: the narrator links again, or sync does for a pair not rejected.
- **Consumers keep their own filter.** The Home table, `narratableManuscriptStats`, the reader, the teleprompter's chapter script, stages, coverage, the retail sample and the links read (`ChapterTrackLinks` rows) already keep only narration chapters (a missing kind counts as narration), so none changed. The matcher's candidate pool deliberately stays every chapter. `ChapterTrackLinks` matches against all chapters and lists only narration rows. Chapter sync (daw-chapter-track-auto-sync PRD Phase 3) must therefore link narration chapters only.

## Consequences

- A mis-imported heading leaves the counts in one step and comes back in one. Nothing that keys on a chapter id is disturbed.
- Replace manuscript still asks for kinds again in the import review (TL9 A). A removal is not remembered across a re-import.
- The Story Bible guide's mention counts were built with the chapter included, and they stay so until the guide is rebuilt.
- An older app version reads the extra `importedKind` and `kindChangedAt` fields as unknown and keeps them. Python's `validate` ignores extra chapter fields.
