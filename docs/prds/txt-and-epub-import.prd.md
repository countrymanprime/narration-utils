# TXT and EPUB Manuscript Import

**Source:** user request of 2026-09-20 ("add a PRD to support TXT and EPUB imports"). Citations are `file:line` on branch `claude/reverent-dijkstra-d02b07` at 6c037d3f. Nothing here is built yet. Related: [import-structure-toc-and-characters.prd.md](import-structure-toc-and-characters.prd.md) (shares `model.go`; its Phase 4 reads a docx TOC, which an EPUB gives us structurally), [import-review-redesign.prd.md](import-review-redesign.prd.md) (the dialog and `Home.tsx`), verification-and-code-health-tooling.prd.md (PRD deleted, delivered) Phase 6 (fuzz targets).

## Problem Statement

The importer accepts only Word (`.docx`) and Markdown (`.md`, `.markdown`) manuscripts. A narrator who is handed a plain-text file (a Project Gutenberg download, a notes-app or "Download as .txt" export) or an EPUB (what most authors and publishers actually distribute) has to convert it to Word or Markdown by hand before the app will read it, and the conversion is where chapter breaks and italics get lost.

## Evidence

- **Two formats are supported and hard-wired in six places.** The format switch and its error string (`apps/desktop/internal/importer/importer.go:28,39`), the detection list (`apps/desktop/internal/manuscript/detect.go:12`), the file-picker filter (`apps/desktop/bindings.go:294`), the UI contract union `'docx' | 'markdown' | 'pdf'` (`apps/ui/src/api/contracts/manuscript.ts:68`), the Home copy "import a Word or Markdown manuscript" (`Home.tsx:135`), and the standalone CLI (`apps/desktop/cmd/manuscript-import/main.go:23`, a PDF special case). ADR 0019 even names `.txt` as an ignored, unsupported format.
- **Every importer ends in one seam.** A format produces `[]Paragraph` (`Chapter`, `ChapterSubtitle`, `Section`, `Text`, UTF-16 `Spans`, `SourceIndex`) plus chapter titles and calls `newDraft` (`model.go:146`), which groups, classifies `narration | opening | reference` and finds character candidates. Everything downstream (review dialog, `commit`, Story Bible, reader, teleprompter) reads the canonical JSON, never the source (`docs/architecture/daw-integration.md:32`), so a new format needs no change past `Draft`.
- **The DOCX and Markdown importers have no third-party parser.** DOCX is `archive/zip` plus `encoding/xml` (`docx.go:4-9`); Markdown is hand-written (`markdown.go`, `markdown_inline.go`). Only PDF used a library (`go.mod:6`), and it is quarantined behind a build tag until its chapter-boundary gate passes (`importer.go:32-36`, `pdf.go:1`).
- **The hazards TXT and EPUB will hit are ones this repo has already been bitten by.** Glued title and subtitle ("CHAPTER ONEBad Ideas") and lost line breaks are ADR 0013; inline formatting as UTF-16 spans is ADR 0014 (`richtext.go`); the fixes are `headingParts`/`splitGluedHeading` (`headings.go:52-97`) and `Draft.Notices`. Wrapped source lines join with a space in Markdown (`markdown_test.go:29`). All of it is reusable.
- **A chapterless import is silently un-narratable.** Text before the first chapter heading starts as `"Front Matter"` and `classifyPreHeading` relabels it `Cover` or `Front Matter` (`markdown.go:54,104-112`, `model.go:52-72`), both `opening`, which totals and sidecars exclude. A plain-text short story with no "Chapter" line would import with zero narratable words and no error. TXT has no heading markup, so this is the common case rather than an edge. (Read from the code, not run.)
- **Real plain text is hard-wrapped, blank-line-separated and Gutenberg-shaped.** `tests/fixtures/alice_raw.txt` (the source of the other Alice fixtures) wraps at about 70 columns (`:36-50`), opens with `*** START OF THE PROJECT GUTENBERG EBOOK 11 ***`, has a `Contents` block listing every chapter (`:14`), puts a subtitle on the line after `CHAPTER I.` (`:32`), and marks italics as `_very_` (`:48`). Curly quotes appear as UTF-8 here, but a Windows export can be Windows-1252 or UTF-16.
- **The commit path copies the source verbatim** into `narration-utils/manuscript/sources/<id>/` (`service.go:323-347`) and stores `importer.format`; nothing reads that string but the UI union, so `"txt"` and `"epub"` are additive.
- **No size cap exists on imports.** `docxEntry` reads a whole zip entry with `io.ReadAll` (`docx.go:26`); [docs-security-and-hygiene.prd.md](docs-security-and-hygiene.prd.md) already lists it as a gap. An EPUB is also a zip, so the same hazard applies from day one.
- **Dependencies are already in the module graph.** `golang.org/x/net v0.56.0` (an HTML parser) and `golang.org/x/text v0.39.0` (charset decoding) are indirect requirements (`go.mod:37-38`, hashes in `go.sum`), so promoting them to direct changes `go.mod` only. Both are BSD-3, compatible with the AGPL-3.0-or-later licence (ADR 0039).
- **EPUB facts below are not verified in this repo** (no EPUB has ever been opened here): container, OPF, spine, nav and NCX structure, `epub:type` semantics and the DRM markers come from the EPUB 3 specification as known to the author of this PRD. Phase 2 starts by checking them against real files.

## Proposed Solution

Two importers behind the existing seam, no new options and no binding change: **plain text** (decode, split into blocks, detect chapters heuristically, unwrap hard-wrapped lines) and **EPUB** (read the spine in order, take chapters from the book's own table of contents with a fallback, turn XHTML into the same paragraphs and spans, classify front and back matter from `epub:type`). Both are hand-written on the standard library plus `x/net/html` and `x/text`, like DOCX, and both report every guess in `Draft.Notices`. One accepted-formats list replaces the six hard-coded ones.

## Key Hypothesis

We believe that importing TXT and EPUB directly, with the same chapter, formatting and front-matter handling as Word and Markdown, will remove the manual conversion step for the manuscripts narrators actually receive. We'll know we're right when the Alice fixtures in TXT and EPUB import to the same chapters and paragraph text as `alice.md`, a Gutenberg-style file and a real EPUB import without hand repair, and no supported input can import as an all-`opening` manuscript without a notice.

## What We're NOT Building

- Removing or working around DRM. A copy-protected EPUB is refused with a clear message.
- Other formats: RTF, ODT, HTML, Pages, FB2, and Kindle files (MOBI, AZW3, KFX). PDF stays quarantined.
- OCR, or images as content: EPUB images, SVG, audio, video and scripts are ignored; alt text is not read.
- Fixed-layout or image-only EPUBs (comics, picture books): they produce "no readable text" through the existing error.
- Reading EPUB metadata (title, author, language) into the project. It is in the OPF and the credits PRD may want it; that is a later, separate change.
- New import options in the review dialog, or a change to the Markdown heading-level control.
- A general "TOC as authority" engine for DOCX (import-structure Phase 4), or repairs to the source file.
- Back-filling existing projects; re-import ("Replace manuscript") is the path.

## Success Metrics

| Metric | Target | How Measured |
| --- | --- | --- |
| Cross-format parity | `alice.txt` and `alice.epub` give the same chapter count and, after whitespace normalization, identical paragraph text as `alice.md` | Go table test over the three fixtures |
| Encodings | UTF-8 with and without BOM, UTF-16 LE and BE, and Windows-1252 fixtures decode to the same text as the UTF-8 baseline; a non-UTF-8 read is reported in `Notices` | Go tests |
| No un-narratable import | A TXT with no chapter line, and an EPUB with no TOC and no headings, import with at least one `narration` section and a notice | Go tests |
| Hazards | Every row in the new quirks tables has a passing test; glued and soft-break headings split as in ADR 0013 | Go tests, catalogue rows |
| Hostile input | Zip bomb, oversized entry, `..` hrefs, missing container, malformed OPF/XHTML and huge TXT fail or degrade with a message, never a crash or unbounded read | Go tests, fuzz targets |
| DRM | An EPUB with an encrypted content document is refused with the message below; font obfuscation alone is accepted | Go tests with a built `encryption.xml` |
| Speed | A 120,000-word novel (about 0.7 MB TXT, 1-2 MB EPUB) previews in under 2 s on the dev machine (target, to be measured) | Timed Go test, `Progress` stages |
| No regression | Existing DOCX and Markdown importer tests unchanged; UI contract tests updated; `pnpm check` and the visual suite green | `pnpm check`, `ui-visual` |

## Open Questions

- [ ] **F1. Scope and owner input.** TXT and EPUB only (recommended). Please supply two or three real files (a TXT you narrate from; EPUBs from the tools your authors use, for example Vellum, Atticus, Scrivener, Calibre conversions). Default until given: generated fixtures plus Gutenberg Alice; the EPUB hazards below are inferred, not observed.
- [ ] **F2. Offer detection for `manuscript.txt` and `manuscript.epub`?** This amends the extension list in ADR 0019 (immutable), so it needs a new ADR. Recommendation: yes, preferring `.docx`, `.epub`, `.md`, `.markdown`, `.txt`; still offer-only, never automatic.
- [ ] **F3. Options.** None in the first delivery, so `ManuscriptImportPreview` keeps its signature and `hostAPIVersion` does not bump. Reconsider only if a real file needs an override (for example "one line per paragraph"). Recommendation: none.
- [ ] **T1. Charset when the file is not UTF-8.** Order: BOM (UTF-8, UTF-16 LE/BE), valid UTF-8, then Windows-1252 with a notice. Recommendation: this order, no prompt.
- [ ] **T2. Hard-wrapped lines.** (a) Always join a block's lines with a space, as Markdown does; (b) detect: if most lines in the file are short and of similar length join them, otherwise keep line breaks (verse, addresses), and treat a file with no blank lines and long lines as one paragraph per line. Recommendation: (b), reported in `Notices`, because Gutenberg text and notes-app text differ.
- [ ] **T3. Chapter headings in plain text.** Recommendation: conservative. A block of one line, or two lines where the second is a subtitle, that matches `isNarrativeMarker` (chapter, part, book, prologue, epilogue, afterword) or is a bare numeral, roman numeral or number word. A `Contents` block is a reference paragraph, never a list of chapters. ALL-CAPS lines alone are not headings.
- [ ] **T4. Chapterless input.** Recommendation: one `narration` chapter titled from the file name, with a notice. This is the first case where a format diverges from Word and Markdown (whose chapterless files become `opening`); decide whether to fix those the same way in a later change. Record in the ADR.
- [ ] **T5. Gutenberg boilerplate and underscore italics.** Strip text outside `*** START OF ... ***` and `*** END OF ... ***` when both are present; turn word-bounded `_italic_` into an italic span (`alice_raw.txt:48`). Recommendation: both, each reported as a notice; `snake_case` and lone underscores stay literal (as `markdown_inline.go` already does).
- [ ] **E1. Where chapters come from.** (a) The EPUB nav/NCX table of contents, falling back to spine documents; (b) spine documents only; (c) `h1`/`h2` headings. Recommendation: (a). A TOC entry may point into the middle of a file, and a chapter may span several files, so a chapter is the run of blocks from one TOC target to the next, in reading order.
- [ ] **E2. TOC depth.** Every depth starts a chapter, in order (parity with DOCX, where every heading is a chapter today), or top level only. Recommendation: every depth; a `Part` entry with no body text is an empty group the model already tolerates.
- [ ] **E3. Emphasis carried by CSS classes.** Semantic `<i>`, `<em>`, `<b>`, `<strong>`, `<u>` map to spans. Exporters often write `<span class="italic">` and put the style in a stylesheet. Recommendation: semantic tags in Phase 2; single-class `font-style`/`font-weight` rules from the book's own stylesheets in Phase 3; anything else is text without a span and a count in `Notices`.
- [ ] **E4. Footnotes and non-linear items.** Drop note references (`epub:type="noteref"`) so "the end.1" never reaches the narrator; keep note bodies as `reference`. Skip spine items with `linear="no"` and say so. Recommendation: both.
- [ ] **E5. Limits.** Proposed: TXT at most 32 MB; EPUB at most 64 MB on disk, 16 MB per text entry and 128 MB of text in total when decompressed; images are never read. A shared capped reader that DOCX can adopt later. Recommendation: these numbers, revisited after the first real files.

## Users & Context

**Primary User**: a narrator or self-publisher who receives manuscripts as EPUB or plain text and imports them to record, proof and edit against.
**Current behavior**: opens the file in Word or a Markdown editor, converts, re-checks the chapter breaks and italics, saves, then imports.
**Trigger**: starting a project, or replacing a manuscript after the author sends a revision.
**Success state**: choose the `.epub` or `.txt`; the review dialog shows the book's real chapters, front matter and cast; nothing about the format is visible after that.
**Job to Be Done**: When an author sends me their book in the format they have, I want to import it as it is, so I spend time narrating instead of converting.
**Non-Users**: authors preparing a manuscript (Word or Markdown remain the authoring formats); anyone needing PDF, Kindle or DRM'd files.

## Solution Detail

| Priority | Capability | Phase |
| --- | --- | --- |
| Must | One accepted-formats list feeding `BuildDraftProgress`, its error, the picker filter, the CLI and the UI union; Home copy updated | 1 |
| Must | TXT: encoding detection (BOM, UTF-8, Windows-1252), CRLF/CR/LF, blocks on blank lines | 1 |
| Must | TXT: conservative chapter headings with subtitle, front-matter classification, chapterless fallback, notices | 1 |
| Should | TXT: hard-wrap detection, Gutenberg boilerplate strip, `_italic_` spans | 1 |
| Must | EPUB: container, OPF, spine order; nav (EPUB 3) and NCX (EPUB 2) TOC; chapters as runs from TOC targets, spine fallback | 2 |
| Must | EPUB: XHTML to paragraphs (block elements, `<br>` as `\n`, whitespace collapse) and semantic spans; DRM refusal; size and path limits | 2 |
| Must | EPUB: `epub:type` and landmarks classify cover, front matter, TOC and back matter; glued heading repair | 3 |
| Should | EPUB: CSS-class emphasis, note references dropped, non-linear items skipped, notices | 3 |
| Should | Offer `manuscript.txt` and `manuscript.epub` (F2); ADR; steady-state docs; fuzz targets | 4 |
| Could | Shared capped reader adopted by DOCX (a docs-security decision) | - |
| Won't | DRM removal, other formats, images, metadata capture, dialog options | - |

**User flow**: Home, Import manuscript, pick `book.epub`. The dialog reads "Read 31 chapters from the table of contents; front matter and 2 back-matter sections marked Reference", the log lists any repairs, the user reviews and imports exactly as for a Word file.

**DRM message (proposed):** "This EPUB is copy-protected, so its text can't be read. Import a DRM-free copy, or a Word or Markdown version."

## Technical Approach

**Feasibility**: Phase 1 HIGH; Phase 2 MEDIUM (real-world EPUB variety; spec details unverified here); Phase 3 MEDIUM; Phase 4 HIGH.

**Architecture notes**
- **Seam.** New files in `apps/desktop/internal/importer/`: `formats.go` (the list: name, extensions, detect rank, build function; `PickerPattern()`, `Extensions()`), `txt.go`, `epub.go` (container, OPF, spine, limits), `epub_xhtml.go` (XHTML to blocks and spans), `epub_toc.go` (nav and NCX), each with tests. Both formats call `newDraft("txt"|"epub", ...)`. No signature change: `BuildDraftProgress(path, headingLevel, progress)` ignores `headingLevel` for them, so no `hostAPIVersion` bump (F3). The picker pattern in `bindings.go:294` and `DetectSource` read the list.
- **TXT.** Decode with `golang.org/x/text/encoding/unicode` (BOM) and `charmap.Windows1252`; split on blank lines; reuse `richBuilder` (`richtext.go`) for whitespace and spans, `isNarrativeMarker`, `isChapterNumber`, `headingParts`/`splitGluedHeading`, `classifyPreHeading` and `isNonChapterHeading`. The `Contents` block is many lines, so it is never read as headings.
- **EPUB.** `archive/zip` opened read-only, entries read by name into memory through a capped reader; nothing is extracted, so zip-slip does not apply, but every `href` is resolved against the OPF directory, cleaned, and rejected if it leaves the archive. `encoding/xml` (strict) for `container.xml`, OPF and NCX. `golang.org/x/net/html` for content documents and `nav.xhtml`, because XHTML from EPUB 2 exporters uses named entities (`&nbsp;`) that a strict XML decoder rejects. External resources are never fetched. `epub:type` reaches the tokenizer as an attribute named `epub:type`; Phase 2 confirms that with a fixture.
- **Chapters.** Parse each spine document into a linear list of blocks carrying element ids; a TOC target `file#id` becomes a chapter start at that block; a chapter runs to the next start across files. Chapter title comes from the body heading at the target (so `headingParts` gives title and subtitle exactly as for DOCX), with the TOC label as the fallback. If the TOC is missing or matches none of the spine, each spine document that begins with `h1`/`h2` starts a chapter, and a notice says so. Heading paragraphs are not emitted as body paragraphs, as in the other importers.
- **Classification.** `epub:type` (`cover`, `titlepage`, `frontmatter`, `dedication`, `epigraph`, `copyright-page` to `opening`; `toc`, `acknowledgments`, `glossary`, `index`, `bibliography`, `endnotes`, `footnotes`, `backmatter` to `reference`; `bodymatter`, `chapter`, `prologue`, `epilogue` to `narration`) takes precedence over the heading-text classifiers in `model.go`, which remain the fallback. Sections are named for `newDraft`, which derives `contentKind` from the title, so Phase 3 either passes a kind through `Paragraph`/`Draft` or renames groups to titles the classifier already knows; decide in Phase 3 with `change-impact-scan` on `service.go:390`.
- **DRM.** `META-INF/encryption.xml` entries with the font-obfuscation algorithms are ignored; any encrypted content document, or an Adobe `rights.xml`, refuses the import.
- **UI.** Union to `'docx' | 'markdown' | 'txt' | 'epub' | 'pdf'` in `contracts/manuscript.ts:68` (and its schema if the boundary-validation PRD has landed), Home copy at `Home.tsx:135`, mock data. The heading-level control stays Markdown-only (`Home.tsx:217`).
- **Tests and fixtures.** `generate_alice.py` gains `alice.txt` (wrapped, Gutenberg-shaped) and `alice.epub` (hand-built with `zipfile`, EPUB 3 nav plus an EPUB 2 NCX variant; a fixture-generation tool only, not a dependency). Go tests build hostile and quirk files in memory, as `docxFixture` does. Fuzz targets for both entry points.

**Technical Risks**

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| Real EPUBs vary far more than a generated fixture (split chapters, layout `div`s, exporter classes) | High | Owner-supplied files (F1); TOC-first with a fallback that never fails an import; notices; a hazards catalogue that grows with each finding |
| Chapterless or mis-detected TXT imports as all `opening` | High | T4 fallback and a test; heuristics are conservative (T3) and reported |
| Zip bomb or oversized text | Medium | E5 caps, capped reader, hostile fixtures, fuzzing |
| `newDraft` classification changes under [import-structure](import-structure-toc-and-characters.prd.md) Phase 1 | Medium | Serialize the two PRDs' `model.go` edits; TXT's `Contents` test pins behavior either way |
| Encoding guess is wrong (Windows-1252 read of a Latin-2 file) | Low | Notice states the charset; re-save as UTF-8 is the documented remedy |
| DRM'd files look like a bug to the user | Medium | Specific refusal message; documented |
| Promoting `x/net` and `x/text` to direct changes `go.mod` and `go.sum` | Low | Land with the phase that first uses them; check `pnpm check` and the licence notices |

## Implementation Phases

| # | Phase | Description | Status | Parallel | Depends | PRP Plan |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Plain text import | Accepted-formats list, TXT importer, UI copy and union, fixtures, tests | pending | - | - | - |
| 2 | EPUB reading order and text | Container, OPF, spine, nav/NCX TOC, XHTML to paragraphs and spans, DRM, limits | pending | - | 1 | - |
| 3 | EPUB structure and repairs | `epub:type` classification, glued headings, CSS-class emphasis, notes, non-linear items | pending | - | 2 | - |
| 4 | Detection, ADR and documentation | Offer `.txt`/`.epub`, ADR, quirks catalogue, guides, fuzz targets, retire the PRD | pending | - | 1, 2, 3 | - |

**Phase 1 - Plain text import.** Goal: import a plain-text manuscript, and make the next format a one-line change. Scope: `formats.go`; `txt.go`; picker, CLI, error string, UI union and Home copy; `alice.txt`; encodings, wrap, heading, chapterless and Gutenberg tests. Success: TXT parity with `alice.md`; the metrics for encodings and chapterless input; existing tests unchanged.
**Phase 2 - EPUB reading order and text.** Goal: an EPUB imports its text in the right order with the book's chapters. Scope: `epub.go`, `epub_xhtml.go`, `epub_toc.go`; `alice.epub` (EPUB 3 and 2); limits and DRM tests. Success: EPUB parity with `alice.md`; hostile-input and DRM metrics; spec assumptions checked against real files if F1 supplied any.
**Phase 3 - EPUB structure and repairs.** Goal: front and back matter and formatting come through cleanly. Scope: classification table, glued-heading and note handling, stylesheet emphasis, notices, the `contentKind` pass-through decision. Success: a fixture with cover, title page, TOC, dedication, endnotes and a `Part` wrapper classifies as expected; every new hazard has a catalogue row and a test.
**Phase 4 - Detection, ADR and documentation.** Goal: the formats are discoverable and documented, and the PRD is retired. Scope: `detectableExtensions` from the list (F2), the ADR (accepted formats, hand-rolled parsers, DRM refusal, chapterless rule, amends the ADR 0019 list), TXT and EPUB sections in `docs/architecture/docx-import-quirks.md`, `docs/guides/using-the-app/manuscript.md:15`, `README.md:106`, `daw-integration.md:32`, `docs/utilities/manuscript-guide.md:7`, `tests/fixtures/README.md`, refreshed doc screenshots, fuzz targets. Success: the checklist above is clean and this PRD is deleted in the same PR.

**Parallelism Notes**: Phase 2 needs Phase 1's list but not its heuristics; a second session can start Phase 2 once `formats.go` has landed. Phases 2 and 3 both edit `epub*.go`, so serialize them.

**Parallel-session compatibility**

| Phase | Files and areas touched | Collision risk |
| --- | --- | --- |
| 1 | `apps/desktop/internal/importer/{importer,formats,txt}.go` and tests, `apps/desktop/bindings.go:294`, `apps/desktop/cmd/manuscript-import/main.go`, `apps/ui/src/api/contracts/manuscript.ts`, `Home.tsx:135`, `mockApi.ts`, `tests/fixtures/*`, `apps/desktop/go.mod` | [import-review-redesign](import-review-redesign.prd.md) Phase 1 (extracts the review body from `Home.tsx`; land it first or rebase), [import-structure](import-structure-toc-and-characters.prd.md) Phase 1 (`model.go`, `docx.go`, `markdown.go`), [wire contracts](../architecture/wire-contracts.md) (schema validation, delivered), Base UI foundation (`go.mod` is separate, `package.json` is not touched) |
| 2 | `epub*.go` and tests, `formats.go`, `tests/fixtures/generate_alice.py` | Phase 1 only |
| 3 | `epub*.go`, `model.go` and `service.go:390` if a kind is passed through | import-structure Phases 1-3 (`model.go`, contentKind consumers `app.go:596`, `state.ts:7`) |
| 4 | `detect.go`, `docs/**`, `docs/images/ui/*`, `docs/adr/`, `docs/prds/README.md` | ADR number and the README index; the Go fuzz targets of the delivered verification tooling ([Property tests and fuzzing](../operations/verification-tooling.md#property-tests-and-fuzzing); add the two fuzz targets there) |

Cross-cutting: no binding signature changes, so no `hostAPIVersion` bump; ADR number re-checked at merge; each phase follows `CLAUDE.md` (plan, `change-impact-scan`, TDD, `full-verification-gate`, `feature-cleanup`), `visual-catalog-sync` only if a page or state changes, `doc-screenshot-sync` because the Home copy is in the guide screenshots; a security review of the EPUB reader before Phase 2 merges (untrusted zip and markup). No Lua, no sidecar changes.

## Decisions Log

| Decision | Choice | Alternatives | Rationale |
| --- | --- | --- | --- |
| Import writes only through `Draft` and the canonical manuscript (prior, ADR 0019, `daw-integration.md:32`) | Kept | Format-specific downstream code | Runtime tools never parse sources |
| Structural whitespace and glued headings are content problems (prior, ADR 0013) | Reused for both formats | New rules per format | One catalogue of hazards |
| Inline formatting as UTF-16 spans (prior, ADR 0014) | Reused | Markup in text | Standing decision |
| Progress and notices reported honestly (prior, ADR 0015) | Every stage and repair reported | Silent heuristics | Standing decision |
| A format ships only when its chapter boundaries are reliable (prior, `importer.go:32-36`) | Alice parity test is the gate | Ship and iterate | The PDF precedent |
| Parsers | Hand-written on `archive/zip`, `encoding/xml`, `x/net/html`, `x/text` (proposed) | A Go EPUB library | See Research Summary |
| Options | None; `ManuscriptImportPreview` unchanged (proposed) | Options struct, `hostAPIVersion` bump | No evidence for an override; the briefs PRD excludes unmotivated settings |
| DRM | Refuse, do not circumvent (proposed) | Best-effort decryption | Out of scope and legally fraught |
| Detection offer for `.txt`, `.epub` (proposed) | Yes, new ADR | Leave ADR 0019 as is | Same offer-only rule, wider list |

## Research Summary

**Technical Context**: verified in code on this branch: the format switch, detection list, picker filter, UI union, `newDraft` and classification, the DOCX and Markdown importers, ADR 0013/0014/0019, the chapterless-import behavior (by reading `markdown.go` and `model.go`, not by running it), `alice_raw.txt`'s shape, and that `x/net` and `x/text` are indirect requirements.
**Prior art searched (GitHub, 2026-09-20, `gh search repos`, code not audited)**: Go EPUB parsers found are small or stale: `kapmahc/epub` (MIT, 75 stars, last push 2016), `timsims/pamphlet` (MIT, 5 stars, 2024), `mathieu-keller/epub-parser` (GPL-3.0, 5 stars, 2026). None has real adoption, each would add a dependency for a job the standard library nearly covers, and this repo already hand-rolls DOCX for the same reason. Rejected in favor of stdlib plus `x/net/html` and `x/text`.
**Not verified**: any real-world EPUB or TXT the owner works with (F1); EPUB container, OPF, nav, NCX, `epub:type` and DRM-marker details (from the EPUB 3 specification, not checked here); how `x/net/html` presents namespaced attributes; the proposed limits and speed target; whether Word and Markdown chapterless files should also change (T4).

---

*Generated: 2026-09-20*
*Status: DRAFT - needs validation*
