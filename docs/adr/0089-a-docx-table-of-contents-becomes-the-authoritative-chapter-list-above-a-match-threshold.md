# 0089. A docx's own table of contents becomes the authoritative chapter list above a match threshold

- **Status:** Accepted
- **Date:** 2026-09-21

## Context and problem

The importer discovers chapters only by guessing at headings (`apps/desktop/internal/importer/docx.go`, `model.go`), even when the
manuscript already carries its own table of contents. The import-structure-toc-and-characters PRD's Open Question S6 asked how
strongly a docx's own TOC should override that heuristic, given that a stale or hand-typed TOC is common: "docx wins only when at
least a set fraction of entries match body headings (bookmark, then normalised text, then ordinal), otherwise fall back and
report" was the PRD's own recommendation, adopted by `implementation-plan.md` D22. No real user manuscript with a Word TOC field
was available while this stack ran (`tests/fixtures/alice.docx` has no `fldChar`, `instrText`, `w:hyperlink`, `bookmarkStart` or
`_Toc` bookmarks - confirmed in the PRD's Evidence section), so this decision and its implementation are verified against a
hand-built OOXML fixture with real `_Toc` bookmarks and an inert TOC field wrapper (`docx_test.go`), not a real manuscript.

## Decision drivers

- The importer discovers chapters only by guessing at headings, even when the manuscript already carries its own table of contents.
- A stale or hand-typed TOC is common.
- The PRD's own recommendation (docx wins only when a set fraction of entries match body headings, by bookmark, then normalised text, then ordinal; otherwise fall back and report) was adopted by `implementation-plan.md` D22.
- No real manuscript with a Word TOC field was available, so the decision is verified against a hand-built OOXML fixture.

## Considered options

1. The docx's TOC becomes the authoritative chapter list when at least 80% of its entries match, and a notice reports any difference
2. Keep the status quo: chapters come only from the heading heuristic

## Decision outcome

**Chosen option: the docx's TOC becomes the authoritative chapter list when at least 80% of its entries match, and a notice reports any difference**, because the importer otherwise only guesses at headings even when the manuscript carries its own table of contents, and a stale or hand-typed TOC is common, so the adopted PRD recommendation lets the docx win only above a match threshold.

- A docx's TOC entries are read from either a `"TOC N"`-styled paragraph (Word's cached table-of-contents lines) or a
  `w:hyperlink` whose `w:anchor` cites a `"_Toc"`-prefixed bookmark - the same mechanism Word itself uses to jump from a TOC
  entry to its heading. `fldChar`/`instrText` field-code runs are inert to the existing text extraction (only `<w:t>` populates
  visible text) and need no special-casing to avoid leaking into paragraph text.
- Entries are matched to the heading heuristic's own chapter titles in three passes, in order: by bookmark anchor, then by
  normalised heading text, then by position among whatever remains unmatched (the ordinal fallback pairs entries with titles
  positionally once the first two passes are exhausted, so even a mostly-unrelated TOC can accumulate more "matches" than the
  entries that actually name a real chapter - this is accepted as the PRD's own recommended tie-break, not a bug).
- The TOC becomes authoritative - its own order replaces the heuristic's `chapterTitles` - only when at least **80%** of its own
  entries matched something at all. Below that, the heuristic's chapter list is kept unchanged, and a notice
  ("The table of contents listed N entries; M matched a chapter in the manuscript.") is always added whenever the two counts
  differ, whether or not the TOC ends up authoritative.
- Only the exposed `chapterTitles` field is ever replaced. `Sections` and paragraph-to-chapter grouping are computed exactly as
  before and are never touched by TOC matching, so a document without a TOC (or whose TOC is below the threshold) is completely
  unaffected, and even an authoritative TOC changes only which titles are reported as "the chapters," not how the manuscript's
  own paragraphs are grouped. A book's own Title and a recognised Contents/TOC heading were never in the heuristic's title list
  to begin with, so they are excluded from an authoritative TOC's result automatically, without any special-casing either way.

### Consequences

- **Neutral:** The 80% threshold is an implementation judgement call within the PRD's own recommended shape ("at least a set fraction"), not a
  value the PRD or the owner specified; it is documented here rather than left as a magic number in `docx.go`. It can be revisited
  once a real manuscript's TOC is available to tune against (see the owner-only input the PRD Evidence and
  `implementation-plan.md` section 2 both name: "a real manuscript with a Word TOC field").
- **Neutral:** Markdown import does not yet read its own table of contents (a `[text](#slug)` link list); the PRD marks this "Should," not
  "Must," and it is deferred with a follow-up issue rather than built here.
- **Bad:** Nothing in this stack has been verified against a real Word-authored table of contents; the hand-built OOXML fixture proves the
  parsing and matching logic, not that real-world TOC fields always take this exact shape. Treat this as "awaiting a real
  manuscript" per the PRD's own Evidence section.

### Confirmation

The parsing and matching are verified against a hand-built OOXML fixture with real `_Toc` bookmarks and an inert TOC field wrapper (`docx_test.go`), not a real manuscript.
