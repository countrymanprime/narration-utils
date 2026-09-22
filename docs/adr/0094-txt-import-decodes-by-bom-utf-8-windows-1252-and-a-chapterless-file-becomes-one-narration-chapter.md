# 0094. TXT import decodes by BOM/UTF-8/Windows-1252, and a chapterless file becomes one narration chapter

**Status:** Accepted
**Date:** 2026-09-22

## Context

The txt-and-epub-import PRD's Phase 1 adds a plain-text (`.txt`) manuscript importer alongside DOCX and Markdown
(`apps/desktop/internal/importer/txt.go`). Its own Open Questions (T1, T2, T4) already carried the owner's recommended answers
(`implementation-plan.md` D22: every open question without an explicit owner decision adopts the PRD's stated recommendation), so
this ADR records the resulting decisions and the implementation judgement calls that recommendation still left open, rather than
asking the owner to re-decide something already settled.

Plain text has no chapter markup at all, which the PRD's Evidence names as the common case, not an edge case: "A chapterless
import is silently un-narratable" today for Word and Markdown (their chapterless files become `opening`, which totals and
sidecars exclude), and TXT would hit this far more often. Plain text also carries no declared encoding, and real Gutenberg-style
text is hard-wrapped at a fixed column width with structural line breaks in some places (verse, addresses) and none in others
(ordinary prose).

## Decision

- **Charset (T1).** `decodeTxt` (`txt.go`) tries, in order: a UTF-8, UTF-16 LE or UTF-16 BE byte-order mark (decides the encoding
  outright); otherwise text that is already valid UTF-8 (trusted as is); otherwise Windows-1252 (decoded and reported as a
  `Notices` line). No prompt is shown; the notice names the guess so a wrong one is visible and re-saving as UTF-8 is the
  documented remedy.
- **Hard-wrap detection (T2).** `prepareTxtBlocks` decides per file, not per block: for every block with more than one line, every
  line except the block's own last line is a "candidate." A candidate is judged short-and-wrapped when its length is 45-100
  characters; the file is treated as hard-wrapped when at least 70% of all candidates fall in that band, and its blocks are then
  joined with a space (as Markdown already does for its own wrapped lines). Below that share, line breaks are kept as structural
  (verse, an address). A file with no blank lines at all (one block) and an average line length over 55 characters is not folded
  into one giant paragraph: each line becomes its own paragraph instead, per the PRD's own final clause on this question. The
  45-100/70%/55 numbers are an implementation judgement call within the PRD's recommended shape ("if most lines... are short and
  of similar length"), not a value the PRD or the owner specified - documented here rather than left as magic numbers in `txt.go`,
  the same way ADR 0089 documents its own 80% TOC-match threshold. They can be revisited once real narrator-supplied TXT files are
  available (PRD Open Question F1, still unanswered - no files were supplied).
- **Chapter headings (T3).** `classifyTxtHeading` reads a block of one line, or two lines where the second is a subtitle, as a
  chapter heading when the first line matches `isNarrativeMarker` (chapter/part/book/prologue/epilogue/afterword) or is itself a
  bare numeral, roman numeral or number word; a glued heading ("CHAPTER ONEBad Ideas") is split the same way DOCX and Markdown
  already do (`splitGluedHeading`), tried before the narrative-marker check so the glued case is not swallowed by it. A
  multi-line block (a `Contents` list) is never read as a heading, and an ALL-CAPS line alone that matches none of the above stays
  ordinary body text.
- **Chapterless fallback (T4).** When a plain-text file has no chapter headings anywhere, its paragraphs become one `narration`
  chapter titled from the file's own name, with a `Notices` line saying so - diverging from Word's and Markdown's own chapterless
  behavior (which stays `opening`, silently un-narratable). This divergence is deliberate and scoped to TXT only: whether Word's
  and Markdown's chapterless behavior should change the same way is left open, not decided by this ADR or this PRD.
- **Gutenberg boilerplate and underscore italics (T5, `Should`).** Text outside a `*** START OF ... ***` / `*** END OF ... ***`
  marker pair is dropped when both are present, reported as a notice. A word-bounded `_italic_` run becomes an italic span,
  including one that crosses a hard-wrapped line boundary (the whole block's joined text is scanned once, not each physical line
  independently, so a span like Gutenberg's own `_took a watch out of its waistcoat-pocket_` is not broken by the line it happens
  to wrap on); `snake_case_name` and a lone underscore stay literal text, mirroring the Markdown importer's own underscore rule.

## Consequences

- TXT is the first importer whose chapterless behavior differs from the other two; a narrator who imports a short story with no
  "Chapter" line gets a single real, narratable chapter instead of a silently empty one. Word and Markdown are unchanged.
- The wrap-detection thresholds are a considered guess, not a measured one (no real TXT files were available - PRD F1). A future
  change that tunes them, or that makes the decision per-block instead of per-file, should supersede this ADR rather than edit
  `txt.go`'s constants silently.
- Only the exposed formats list (`formats.go`) changes what the native picker, `BuildDraftProgress`'s error message and the UI
  union accept; `manuscript.DetectSource`'s own extension list (the "found in your project folder" offer, ADR 0019) is
  unchanged by this ADR - offering `.txt` automatically is Phase 4's own, separate decision.
