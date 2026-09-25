# 0101. EPUB import reads nav then NCX for chapters, caps entries, and refuses DRM

- **Status:** Accepted
- **Date:** 2026-09-22

## Context and problem

The txt-and-epub-import PRD's Phase 2 adds an EPUB (`.epub`) manuscript importer alongside DOCX, Markdown and TXT
(`apps/desktop/internal/importer/epub.go`, `epub_toc.go`, `epub_xhtml.go`). Its own Open Questions (E1-E5) already carried the
owner's recommended answers (`implementation-plan.md` D22: every open question without an explicit owner decision adopts the
PRD's stated recommendation), so this ADR records the resulting decisions and the implementation judgement calls that
recommendation still left open, rather than asking the owner to re-decide something already settled - the same pattern
ADR 0095 used for Phase 1's TXT importer.

No real EPUB was available to check against (PRD Open Question F1, still unsupplied; the PRD's own Evidence says so:
"EPUB facts below are not verified in this repo"). Phase 2 ships against a generated fixture (`tests/fixtures/alice.epub`,
`tests/fixtures/generate_alice.py`'s `write_epub`) built from the EPUB 3/EPUB 2 specifications as read, plus in-memory Go
fixtures (`epub_test.go`) for hostile and quirk shapes. The thresholds and fallbacks below should be revisited once a real,
owner-supplied EPUB is available.

## Decision drivers

- The PRD's recommended answers to its Open Questions (E1-E5) are adopted (`implementation-plan.md` D22) rather than re-decided.
- No real EPUB was available to check against (PRD Open Question F1); Phase 2 ships against a generated fixture.
- An EPUB is also a zip, so its reader must be capped, and a crafted `../../secret` href must not be read.
- The PRD's "No un-narratable import" success metric names EPUB explicitly.

## Considered options

1. Chapters from the nav, then the NCX, table of contents, with capped entries and DRM refused
2. A heading heuristic guessing at chapter boundaries, as DOCX and Markdown use

## Decision outcome

**Chosen option: chapters from the nav, then the NCX, table of contents, with capped entries and DRM refused**, because the PRD's recommended answers already settled this shape, and a real table of contents gives the chapters in the shape the author gave them.

- **Chapters come from the table of contents first (E1).** `epubWithProgress` reads the EPUB 3 nav document
  (`<nav epub:type="toc">`) when the package manifest has one, falling back to the EPUB 2 NCX (`toc.ncx`) when it does not or the
  nav yields no entries. A chapter is the run of blocks from one TOC target to the next, across spine files, matching the PRD's
  own recommendation (a). When neither TOC resolves to any block at all, each spine document whose own first block is an `h1` or
  `h2` starts a chapter instead, and a `Notices` line says so.
- **Every TOC depth starts a chapter (E2).** `epubChapterStarts` does not filter by nesting depth: a nested `Part > Chapter`
  entry starts its own chapter the same way a top-level one does, matching DOCX's existing "every heading is a chapter" shape and
  the PRD's own recommendation.
- **Emphasis is semantic tags only in Phase 2 (E3).** `collectInline` (`epub_xhtml.go`) maps `<i>`/`<em>` to italic,
  `<b>`/`<strong>` to bold and `<u>` to underline, and `<br>` to a line break within a block. CSS-class-driven emphasis
  (`<span class="italic">` styled from the book's own stylesheet) is out of scope for Phase 2 as the PRD's own recommendation
  states (Phase 3); text under such a span imports as plain text with no span, uncounted for now.
- **Footnotes and non-linear items are not yet handled (E4).** Phase 2 reads every spine item regardless of `linear="no"`, and
  does not yet drop `epub:type="noteref"` references. This is Phase 3 scope per the PRD's own phase table; Phase 2 does not
  implement it early because there is no `epub:type` classification pass yet to hang it on (Solution Detail's Classification
  paragraph).
- **Limits (E5).** A file over 64 MB on disk, any single zip entry over 16 MB decompressed, or more than 128 MB of decompressed
  text across the whole archive, is refused (`epubMaxFileSize`, `epubMaxEntrySize`, `epubMaxTotalText` in `epub.go`) - a capped
  reader in the same spirit as `docxEntry`'s own gap (Evidence, threat-model row 6a, issue #239), applied to a format that is
  also a zip. Every `href` (manifest, nav, NCX) is resolved against the directory it was found in, cleaned, and rejected if it
  would resolve outside the archive (`resolveEPUBHref`); nothing is ever extracted to disk, so zip-slip itself does not apply,
  but a crafted `../../secret` href must still not be read. These three numbers are an implementation judgement call within the
  PRD's own proposed shape, not a value the PRD or the owner measured against a real file - documented here rather than left as
  magic numbers in `epub.go`, the same way ADR 0095 documents its own TXT wrap-detection thresholds.
- **DRM (Solution Detail's DRM paragraph).** A `META-INF/encryption.xml` entry is accepted only when its algorithm is one of the
  two known font-obfuscation URIs (IDPF `http://www.idpf.org/2008/embedding`, Adobe `http://ns.adobe.com/pdf/enc#RC`); any other
  algorithm, or the presence of an Adobe `META-INF/rights.xml`, refuses the import with the PRD's proposed message ("This EPUB is
  copy-protected..."). No attempt is made to decrypt or work around either.
- **Chapterless fallback matches TXT's own T4 (not an open question, but a consistency decision).** An EPUB whose TOC and
  spine-heading fallback both find nothing becomes one `narration` chapter titled from the file name, with a notice - the same
  divergence from Word/Markdown's `opening`-only chapterless behavior that ADR 0095 records for TXT, required by the PRD's own
  Success Metrics ("No un-narratable import" names EPUB explicitly, not just TXT).

### Consequences

- **Good:** A well-formed EPUB 3 or EPUB 2 book with a real table of contents imports its chapters in the shape the author gave them,
  without a heading heuristic guessing at chapter boundaries the way DOCX and Markdown still do.
- **Bad:** The size limits and the semantic-emphasis-only scope are considered guesses, not measured ones (no real EPUB was available -
  PRD F1). A future change that tunes the limits, adds CSS-class emphasis, or adds `epub:type` classification (Phase 3) should
  supersede this ADR rather than edit `epub.go`'s constants or `collectInline`'s tag set silently.
- **Neutral:** Only the exposed formats list (`formats.go`) changes what the native picker, `BuildDraftProgress`'s error message and the UI
  union (`apps/ui/src/api/contracts/manuscript.ts`, `apps/ui/src/api/schemas/manuscript.ts`) accept; `manuscript.DetectSource`'s
  own extension list (the "found in your project folder" offer, ADR 0019) is unchanged by this ADR - offering `.epub`
  automatically is Phase 4's own, separate decision (F2).
- **Neutral:** `golang.org/x/net` moves from an indirect to a direct dependency of `apps/desktop/go.mod` (its `html` package parses XHTML
  content documents and the nav document); it is BSD-3, already in the module graph as an indirect requirement, and compatible
  with the AGPL-3.0-or-later relicense (D17) - no new dependency licence check was needed beyond confirming what the PRD's
  Evidence already established.

### Confirmation

Phase 2 is tested against a generated fixture (`tests/fixtures/alice.epub`, from `tests/fixtures/generate_alice.py`'s `write_epub`) and in-memory Go fixtures (`epub_test.go`) for hostile and quirk shapes; no real EPUB has been checked.

## Pros and cons of the options

### A heading heuristic

- Bad, because it guesses at chapter boundaries instead of importing them in the shape the author gave them.
