# 0241. A subtitle set apart from its heading is read as the subtitle, and an EPUB heading that starts no chapter is kept as text

**Status:** Proposed
**Date:** 2026-09-25

## Context

The heading-misread fixtures (`docs/research/import-heading-misreads.md`, `tests/fixtures/heading-misreads/`) showed that the importer looked only inside a chapter heading for its subtitle.

- A subtitle authored apart from the heading was misread (F4, F5): a Word "Subtitle" paragraph, an EPUB `<p class="subtitle">`, or a deeper heading directly under the chapter heading.
  - In DOCX, the deeper heading became a second, empty chapter.
  - In Markdown, it became a section name.
  - In EPUB it was dropped from the import altogether, the one mode that lost text (#388).
- The glued-heading repair ([ADR 0013](0013-import-preserves-structural-whitespace.md)) missed a one-letter first word and a two-word number (F6).

Issue #387 left each mode to decide: an importer change, a review control, or leave it. The review's subtitle override ([ADR 0135](0135-a-subtitle-turned-off-in-the-import-review-joins-the-title-or-returns-to-the-text-by-where-its-line-came-from.md)) can correct a subtitle the importer reads, but not one it never reads.

## Decision

1. **A deeper heading under a chapter heading is its subtitle** in DOCX, Markdown and EPUB alike (`subtitleHeading`, `aloneAtItsLevel` in `apps/desktop/internal/importer/headings.go`), when all of these hold:
   - it comes before any of the chapter's text, and the chapter has no subtitle yet;
   - it is the only heading of its level before the next chapter heading, so a chapter whose scenes are headings of that level keeps them as scenes;
   - the chapter heading is level 1 or deeper (never a book title), not a Part or Book heading, and not a reference section (a Characters section's subheadings are its entries);
   - the heading itself names no chapter, part, book, prologue, epilogue or afterword.
2. **Explicit subtitle markup** directly under a chapter heading is its subtitle: a paragraph in Word's own "Subtitle" style, or an EPUB block whose class is `subtitle`. A Markdown emphasis line or a plain-text block under a heading is not: an epigraph looks the same.
3. **The override can undo it.** A subtitle read from a line apart from the heading is marked to return to the text when the narrator turns it off in the review (`SubtitleOffReturnsToBody`). Nothing the importer now reads as a subtitle can be lost.
4. **An EPUB heading that starts no chapter and is not a subtitle is kept as the chapter's text** (#388), not dropped.
5. **The glued-heading repair also splits two narrow shapes**, both reported with the existing notice:
   - a number of two words ("Chapter Twenty OneThe Storm");
   - an "A" or "I" glued to a number written in words, before more words ("Chapter TwoA Night").

   It never splits a lone letter after a roman numeral ("Chapter XI The Storm" is chapter eleven), nor all-caps glue.

## Consequences

- Seven of the eighteen constructed misreads now read as intended. `cases.json` marks them `fixedBy`, and the fixture test holds them to their intended reading.
- A chapter that opens with a single deeper heading that is really a scene name now shows it as the subtitle. The review shows this and "off" returns it to the text. Before, Markdown kept it as a section name and DOCX made it a chapter.
- EPUB scene headings inside a chapter are now narrated text. They were silently dropped before.
- Still open under #387: F2 (three-part headings), the ambiguous F4 shapes, the all-caps glue, F7 (by design) and F8 (plain-text heading shapes).
- Superseding this needs a new ADR, for example to add a three-part heading control (F2) or a dictionary for all-caps glue.
