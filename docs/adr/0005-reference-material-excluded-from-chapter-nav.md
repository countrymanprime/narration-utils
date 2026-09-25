# 0005. Reference-material sections excluded from chapter navigation, retained in source data

- **Status:** Accepted
- **Date:** 2026-09-17

## Context and problem

Sections classified as `contentKind: "reference"` (Characters, Contents, Glossary, etc.) were appearing as ordinary chapters in the Manuscript sidebar (`ChapterNav.tsx`), even though `AudiobookEstimatePanel.tsx` already excluded them from word-count/estimate totals. Users don't expect a "Characters" glossary to appear as a narratable chapter to record.

## Decision drivers

- Users don't expect a "Characters" glossary to appear as a narratable chapter to record.
- Reference material stays readable in place, and the underlying data stays complete.

## Considered options

1. Filter reference chapters at the listing/navigation layer only, with a shared `isListableChapter` helper
2. Keep the status quo: reference sections appear as ordinary chapters in the sidebar
3. Filter in the backend reader or in `manuscript.json` canonicalization

## Decision outcome

**Chosen option: filter reference chapters at the listing/navigation layer only, with a shared `isListableChapter` helper**, because users don't expect reference material to appear as narratable chapters, while leaving the reader and backend unfiltered keeps it readable in place and the data complete.

A shared helper, `isListableChapter` (`shared/ui/src/state.ts`), filters out `contentKind: "reference"` chapters. It is applied at the **listing/navigation layer only** — `ChapterNav.tsx` uses it before rendering nav rows. The manuscript reader's continuous-scroll view and the backend (`shell/internal/manuscript/reader.go`, `manuscript.json` itself) are deliberately **not** filtered, so reference material stays readable in place and the underlying data stays complete. `AudiobookEstimatePanel.tsx` keeps its own, stricter `narration`-only filter (it also excludes `opening`/front-matter, which `isListableChapter` does not) — the two filters serve different purposes and should not be unified.

### Consequences

- **Neutral:** Any new chapter-listing UI (a future chapter-count badge, a jump-to-chapter menu, etc.) should use `isListableChapter`, not reimplement the `contentKind !== 'reference'` check inline.
- **Neutral:** Filtering must never move into the backend reader or `manuscript.json` canonicalization — that would break the reader view's ability to show reference material as plain text.

### Confirmation

Not recorded when this decision was made.

## Pros and cons of the options

### Filter in the backend reader or in `manuscript.json` canonicalization

- Bad, because it would break the reader view's ability to show reference material as plain text.
