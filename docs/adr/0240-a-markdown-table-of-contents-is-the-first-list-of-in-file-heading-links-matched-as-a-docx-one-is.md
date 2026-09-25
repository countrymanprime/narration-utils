# 0240. A Markdown table of contents is the first list of in-file heading links, matched as a docx one is

- **Status:** Proposed
- **Date:** 2026-09-25

## Context and problem

[ADR 0089](0089-a-docx-table-of-contents-becomes-the-authoritative-chapter-list-above-a-match-threshold.md) made a docx's own table of contents the chapter list once 80% of its entries match a heading, and left the Markdown TOC (a `[text](#slug)` link list, PRD priority "Should") for later. The Import Structure PRD's Phase 4 asked for it to be matched against the heading slugs, with the duplicate-suffix and punctuation rules. Markdown has no field or style that marks a TOC, and a manuscript may hold a list of in-file links for another reason.

## Decision drivers

- ADR 0089 left the Markdown TOC for later.
- The Import Structure PRD's Phase 4 asked for it to be matched against the heading slugs, with the duplicate-suffix and punctuation rules.
- Markdown has no field or style that marks a TOC, and a manuscript may hold a list of in-file links for another reason.

## Considered options

1. The first list of in-file heading links, matched as a docx table of contents is

No alternatives were recorded when this decision was made.

## Decision outcome

**Chosen option: the first list of in-file heading links, matched as a docx table of contents is**, because Markdown has no field or style that marks a table of contents, and ADR 0089 had left the Markdown one for later.

1. A Markdown TOC is the **first list with two or more items that are each exactly one link to an in-file anchor** (`- [Text](#anchor)`, `*`, `+`, `1.` or `1)` markers; blank lines between items allowed). The list ends at any other line or a heading. A single link, a link inside prose, or a link to another file is never a TOC entry. A nested list is read at its outermost level, so sections under a chapter are not entries. The anchor is percent-decoded (`%C3%A9` is `é`), without `net/url` (ADR 0032).
2. Each heading's anchor is the one GitHub gives it: lower-cased, every character other than a letter, a digit, a mark, a space, a hyphen or an underscore dropped, each space made a hyphen, and `-1`, `-2` added to a repeat in document order (`internal/importer/markdown_toc.go`).
3. The entries are matched and applied exactly as a docx's are, through one shared function (`applyTableOfContents`). The order is anchor (the slug, standing in for Word's bookmark), then normalised text, then position; the TOC wins at 80%. Only `chapterTitles` changes, never the sections, and the same notice is added when the counts differ. The TOC's lines stay in the manuscript as the Contents section's text.

### Consequences

- **Good:** A Markdown manuscript whose TOC links its chapters gets the book's own chapter list, without a book title heading or a Contents heading counted as chapters.
- **Neutral:** Pandoc's anchors differ from GitHub's for some headings (Pandoc drops leading numbers). Those entries then match by text or position, and a TOC that still falls short of 80% keeps the heading list, with the notice.
- **Neutral:** An explicit `{#id}` heading attribute is not read as an anchor; such an entry matches by text or position.
- **Neutral:** Superseding this needs a new ADR, for example to read Pandoc's identifiers or a `[TOC]` marker.

### Confirmation

Not recorded when this decision was made.
