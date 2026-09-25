# 0090. The page-flip reader hides reference chapters, superseding the reader half of ADR 0005

- **Status:** Accepted
- **Date:** 2026-09-21
- **Related:** Supersedes the reader-view clause of [ADR-0005](0005-reference-material-excluded-from-chapter-nav.md) (its navigation-panel clause stands unchanged)

## Context and problem

[ADR 0005](0005-reference-material-excluded-from-chapter-nav.md) filtered `contentKind: "reference"` chapters (Contents,
Characters, Glossary) out of the Manuscript page's chapter-navigation panel only, and deliberately left the continuous page-flip
reader (`Manuscript.tsx`) and the backend unfiltered, so reference material stayed readable in place. That was a narrower fix for
a narrower bug at the time. `manuscript-reader-search-and-controls.prd.md` R13 (adopted by `implementation-plan.md` D22, and
`docs/prds/README.md`'s "Accepted ADRs reversed by PRDs" note) asks the reader itself to stop showing reference material too,
since none of it is ever recorded: a narrator paging through the manuscript still meets Contents and Characters as ordinary
readable chapters today, with no purpose in that view. [ADR 0088](0088-contents-and-characters-stay-reference-hidden-by-the-reader.md)
(stack S19c) already settled the storage-side half of this - both stay `contentKind: "reference"`, nothing is dropped or
reclassified - and explicitly left this reader-side reversal to this PRD's own Phase 5, which owns `Manuscript.tsx`.

## Decision drivers

- None of the reference material is ever recorded, so a narrator paging through the manuscript meets Contents and Characters as ordinary readable chapters with no purpose in that view.
- `manuscript-reader-search-and-controls.prd.md` R13 (adopted by `implementation-plan.md` D22) asks the reader itself to stop showing reference material.
- ADR-0088 already settled the storage side and left this reader-side reversal to the PRD's own Phase 5.
- Projects imported before this phase must be covered too (R14).

## Considered options

1. The reader renders only `isListableChapter` chapters, and a link into reference material is a no-op with a message
2. Keep the status quo (ADR-0005): reference chapters stay readable in the page-flip reader
3. Redirect such a link to the reference chapter's own view
4. A second `isRecordedChapter` helper for the reader

## Decision outcome

**Chosen option: the reader renders only `isListableChapter` chapters, and a link into reference material is a no-op with a message**, because none of the reference material is ever recorded, so it has no purpose in the reader, and the reader has no per-chapter reference view a link could be redirected to.

- `Manuscript.tsx`'s continuous reader renders only chapters that pass the existing `isListableChapter` predicate
  (`apps/ui/src/state.ts`: `contentKind !== 'reference'`) - the same predicate `ChapterNav.tsx` already used for the panel, reused
  rather than duplicated as a second `isRecordedChapter` helper, since the two checks are the same rule (R13: hide **every**
  reference section, not only Contents).
- **Default open chapter.** The reader opens on the first chapter that passes `isListableChapter`, not simply `chapters[0]`, both
  on first load and when a previously saved reader state points at a chapter that no longer passes the filter (R14: this also
  covers a manuscript imported before this phase landed, since the check keys on `contentKind`, not a migration flag or an
  import-time timestamp).
- **Expand all.** Expands only the listable chapters; a reference chapter is never requested from `manuscriptParagraphs` and never
  gets a manual expand/collapse control, since it has no rendered chapter row to click.
- **`#p<n>` and `#c<id>` deep links** (chapter-nav search hits, the Home audiobook-estimate table, Story Bible "Go to line", any
  future caller) that resolve to a reference chapter are a no-op that tells the narrator instead of landing on a hidden chapter or
  silently doing nothing: `notify("That link points to reference material, which isn't shown in the manuscript reader.")`. The
  simpler no-op-with-a-message option was taken over redirecting to "the reference chapter's own view," because the reader has no
  such per-chapter reference view to redirect to - Contents and Characters have no standalone page outside the reader that a link
  could land on instead.
- The chapter-navigation panel's own filter (ADR 0005) is unchanged; this ADR only extends the same predicate to the reader body,
  the default chapter, "Expand all," and hash resolution. The backend (`reader.go`, `manuscript.json`) still never filters, per
  ADR 0005's own consequence and this PRD's "What We're NOT Building."
- `AudiobookEstimatePanel.tsx` already filters to `contentKind === 'narration'` (stricter than `isListableChapter`, which also
  excludes only `reference`) for its totals and its own chapter links, so audiobook totals and its own "go to chapter" links are
  unaffected by this change and needed no edit.

### Consequences

- **Good:** A narrator can no longer open the manuscript on "Contents" or page into "Characters" as if they were narratable chapters; both
  stay in `manuscript.json` and the Story Bible (Characters' readable form, per ADR 0088) but never appear as reader pages.
- **Good:** Existing projects imported before this ADR need no re-import or migration step: the filter is computed from `contentKind` at
  render time on every load.
- **Neutral:** A future page-listing surface (a jump-to-chapter menu, a chapter-count badge, and so on) should keep using `isListableChapter`
  rather than reimplementing the `contentKind !== 'reference'` check inline, per ADR 0005's own consequence, now also true of the
  reader body.
- **Neutral:** A future change that wants a real "reference chapter view" (for example, if Contents ever became independently readable outside
  the panel) would need its own ADR: this one records only the no-op-with-a-message choice for the reader's current shape.

### Confirmation

Not recorded when this decision was made.

## Pros and cons of the options

### Keep the status quo: reference chapters readable in the reader

- Bad, because a narrator paging through the manuscript still meets Contents and Characters as ordinary readable chapters, with no purpose in that view.

### Redirect the link to the reference chapter's own view

- Bad, because the reader has no such per-chapter reference view to redirect to: Contents and Characters have no standalone page outside the reader.

### A second `isRecordedChapter` helper

- Bad, because the two checks are the same rule (R13: hide every reference section, not only Contents).
