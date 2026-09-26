# 0214. Credits track links reuse the chapter-track-link bindings through a fixed row title

**Status:** Proposed
**Date:** 2026-09-26

## Context

[Credits in the Chapter Table](../prds/credits-in-chapter-table.prd.md) Phase 3 (a "Could" item, deferred from Phase
2's disabled Check button, CT4 option (c)) wants the opening and closing credits rows to get a confirmed REAPER track
link the same way a manuscript chapter does, so that a later phase's recording check has a track to measure. The
PRD's own architecture note: "The track link reuses `evidence.MappingStore` with the credits id."

`evidence.MappingStore` (Confirm, SetChapter, ClearChapter, List) is already generic over any string chapter id: it
was never restricted to manuscript chapter ids. The only gate keeping a credits id out was `chapterTitle`
(`apps/desktop/mapping.go`), the helper `mappingConfirm`, `chapterTrackSet` and `chapterTrackUnlink` all call to
validate a chapter id and find the real title to store beside the link (so a re-import can re-suggest it by title,
per the analysis evidence ledger PRD's Q9). It looked up only `svc.manuscript.Chapters()`, so a credits id always
read as "not part of the current manuscript."

## Decision

1. `chapterTitle` first checks `creditsRowTitle(chapterID)`: a chapter id of the form `"credits-" + kind` resolves to
   the same fixed label `creditsScriptTitles` already gives that kind for the teleprompter (`"Opening credits"` /
   `"Closing credits"`, ADR 0150), before falling back to the real manuscript lookup. Only `opening` and `closing`
   resolve; `credits-chapter_announcement` and any other suffix do not, matching CT2's "opening and closing" scope
   for now.
2. This is the only change needed. The three existing bindings that already call `chapterTitle` -
   `ChapterTrackMapConfirm`, `ChapterTrackSet` and `ChapterTrackUnlink` - now accept a credits id for free, storing
   and returning the fixed label exactly as they do a chapter's real title. No new binding, no wire-contract change:
   every one of these bindings' JSON shapes is unchanged: only which `chapterId` values they accept is wider.
3. `ChapterTrackLinks` (the Tracks page's per-chapter table) is deliberately left untouched: it lists only
   `svc.manuscript.ChaptersUnmeasured()`'s narration chapters, so no credits row appears there. Whether and how a
   credits row should appear on that page, versus only on Home's chapter table (this PRD's own Phase 2 rows), is a
   UI design question this ADR does not answer; the host now supports either without needing to be asked again.

## Consequences

- Credits are still never chapters (ADR 0150): the id never reaches `manuscript.json`, `ChapterNav`, search, stages
  or coverage; only `evidence.MappingStore`'s file gains a row keyed by `"credits-opening"` or `"credits-closing"`.
- Not built here (deferred, Phase 3's own "Could" scope): a coverage basis from the rendered credits text (needs a
  Transcript Compare sidecar mode that reads a reference text instead of a manuscript chapter id - a `sidecars/**`
  change, lane B's file ownership under the delivery train's lane split, D41), and a dedicated track-name suggestion
  for "Opening credits"/"Closing credits" (nothing yet consumes it, so it is not added ahead of that demand, per the
  project's own no-speculative-code convention). The Check button (CT4) stays disabled with Phase 2's existing
  reason until the coverage basis exists.
