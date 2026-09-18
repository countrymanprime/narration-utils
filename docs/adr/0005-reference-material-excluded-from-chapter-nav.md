# 0005. Reference-material sections excluded from chapter navigation, retained in source data

**Status:** Accepted
**Date:** 2026-09-17

## Context

Sections classified as `contentKind: "reference"` (Characters, Contents, Glossary, etc.) were appearing as ordinary chapters in the Manuscript sidebar (`ChapterNav.tsx`), even though `AudiobookEstimatePanel.tsx` already excluded them from word-count/estimate totals. Users don't expect a "Characters" glossary to appear as a narratable chapter to record.

## Decision

A shared helper, `isListableChapter` (`shared/ui/src/state.ts`), filters out `contentKind: "reference"` chapters. It is applied at the **listing/navigation layer only** — `ChapterNav.tsx` uses it before rendering nav rows. The manuscript reader's continuous-scroll view and the backend (`shell/internal/manuscript/reader.go`, `manuscript.json` itself) are deliberately **not** filtered, so reference material stays readable in place and the underlying data stays complete. `AudiobookEstimatePanel.tsx` keeps its own, stricter `narration`-only filter (it also excludes `opening`/front-matter, which `isListableChapter` does not) — the two filters serve different purposes and should not be unified.

## Consequences

- Any new chapter-listing UI (a future chapter-count badge, a jump-to-chapter menu, etc.) should use `isListableChapter`, not reimplement the `contentKind !== 'reference'` check inline.
- Filtering must never move into the backend reader or `manuscript.json` canonicalization — that would break the reader view's ability to show reference material as plain text.
