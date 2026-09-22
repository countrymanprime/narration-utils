# 0103. TXT and EPUB are accepted import formats, hand-rolled without a library, DRM is refused, and both are offered for detection

**Status:** Accepted
**Date:** 2026-09-22
**Amends:** the extension list of [ADR 0019](0019-detected-manuscript-is-offered-not-imported.md), which named `.docx`, `.md` and `.markdown` only and explicitly called `.txt` unsupported

## Context

The txt-and-epub-import PRD's Phase 4 is "Detection, ADR and documentation... retire the PRD." Phases 1-3 shipped the TXT and EPUB
importers and recorded their own implementation-level decisions in [ADR 0095](0095-txt-import-decodes-by-bom-utf-8-windows-1252-and-a-chapterless-file-becomes-one-narration-chapter.md)
(TXT charset order and chapterless fallback), [ADR 0101](0101-epub-import-reads-nav-then-ncx-for-chapters-caps-entries-and-refuses-drm.md)
(EPUB chapter source, limits, DRM refusal) and [ADR 0102](0102-epub-content-kind-overrides-by-title-rather-than-canonical-title-renaming.md)
(the `epub:type` override mechanism). Four decisions from the PRD's own Decisions Log were left as "(proposed)" rows with no ADR of
their own, because each is a standing project-wide stance rather than one format's implementation detail:

- **Parsers.** Hand-written on `archive/zip`, `encoding/xml`, `x/net/html` and `x/text`, over adopting a third-party Go EPUB
  library (Research Summary: `kapmahc/epub`, `timsims/pamphlet`, `mathieu-keller/epub-parser` are each small, stale or copyleft
  in a way that adds nothing the standard library plus two already-indirect dependencies doesn't already cover).
- **Options.** None in the first delivery; `ManuscriptImportPreview`'s signature is unchanged, so `hostAPIVersion` does not bump
  (F3, adopted in Phase 1).
- **DRM.** An encrypted content document, or an Adobe `rights.xml`, refuses the import outright; the app never attempts
  decryption or a workaround.
- **Detection offer (F2).** `manuscript.DetectSource` (ADR 0019) should offer a `manuscript.txt` or `manuscript.epub` sitting in
  the project folder, the same as it already offers `.docx`/`.md`/`.markdown` - still an offer the user must accept, never an
  automatic import.

F2 needed its own ADR because it changes ADR 0019's Decision text directly (an extension list an Accepted ADR names verbatim),
and ADR 0019 is immutable once accepted (`docs/adr/README.md` rule 1): a changed decision gets a new ADR, not an edit.

## Decision

- **TXT and EPUB are accepted manuscript formats**, alongside DOCX and Markdown, through the same seam every format already
  used (`newDraft`, `Draft.Notices`, no source is read again after import) - the PRD's central premise, now built in full
  (Phases 1-3) and given its own top-level record here rather than left implicit across three narrower ADRs.
- **Both parsers are hand-written** on the standard library (`archive/zip`, `encoding/xml`) plus `golang.org/x/net/html` (XHTML
  and nav, tolerant of named entities a strict XML decoder rejects) and `golang.org/x/text` (BOM and Windows-1252 decoding),
  matching the existing DOCX/Markdown precedent rather than adding a third-party EPUB dependency.
- **No import options ship with either format.** `ManuscriptImportPreview(jobId, options)` is unchanged; `markdownHeadingLevel`
  is accepted and ignored for `txt`/`epub`, as it already is for `docx`.
- **DRM is refused, never circumvented.** `epub.go` treats any `META-INF/encryption.xml` entry outside the two known
  font-obfuscation algorithms, or an Adobe `META-INF/rights.xml`, as a hard refusal with the PRD's proposed message ("This EPUB
  is copy-protected, so its text can't be read. Import a DRM-free copy, or a Word or Markdown version.").
- **`manuscript.DetectSource`'s extension list gains `.epub` and `.txt`, and its preference order becomes `.docx`, `.epub`,
  `.md`, `.markdown`, `.txt`** (`apps/desktop/internal/manuscript/detect.go`'s `detectableExtensions`), exactly the PRD's own F2
  recommendation. This is still offer-only: `Bootstrap.manuscriptCandidate` names the file, `Home.tsx` asks "Import
  manuscript?", and nothing is read until the user agrees - ADR 0019's actual mechanism (the offer/accept flow, the
  session-only decline, `BeginDetected`'s exact-path check) is untouched and stays in force.

## Consequences

- ADR 0019's own file keeps its Decision text (ADRs are immutable once accepted); its `Status` line is updated to point here for
  the one bullet this ADR supersedes (the extension list), the same "amends" pattern ADR 0016/ADR 0017 used for ADR 0009.
- A project folder holding both a `manuscript.epub` and a `manuscript.md` (for example, a DRM-free EPUB export kept alongside
  notes) now offers the EPUB first, ahead of both Markdown variants and TXT, matching the same "richest format wins" ordering
  the original three extensions used.
- The four decisions above (parsers, options, DRM, detection) were already built during Phases 1-3; this ADR records them
  without changing any code beyond `detectableExtensions` (Phase 4's own scope) and closes the "(proposed)" rows the PRD's
  Decisions Log carried with no ADR link.
- Nothing here changes `hostAPIVersion`: `manuscriptCandidate`'s shape is unchanged, only which extensions can appear in it.
