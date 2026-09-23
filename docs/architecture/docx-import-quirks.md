# Manuscript import: formatting quirks and how they are handled

**Status: living catalogue.** Word, Markdown, plain-text and EPUB documents encode the same visible text in many ways. Several import regressions ("CHAPTER ONEBad Ideas Look Great in Neon", paragraphs that lost their line breaks) came from one of these encodings, were fixed, and came back because the reason was never written down. Each row below is a known hazard, what the document looks like, what the importer does, and where the test lives. Add a row (and a test) whenever a new one is found. The governing decision is [ADR-0013](../adr/0013-import-preserves-structural-whitespace.md); formatting spans are [ADR-0014](../adr/0014-inline-formatting-as-offset-spans.md); TXT and EPUB's own decisions are [ADR 0095](../adr/0095-txt-import-decodes-by-bom-utf-8-windows-1252-and-a-chapterless-file-becomes-one-narration-chapter.md), [ADR 0101](../adr/0101-epub-import-reads-nav-then-ncx-for-chapters-caps-entries-and-refuses-drm.md), [ADR 0102](../adr/0102-epub-content-kind-overrides-by-title-rather-than-canonical-title-renaming.md) and [ADR 0103](../adr/0103-txt-and-epub-are-accepted-import-formats-hand-rolled-drm-refused-and-offered-for-detection.md).

Code: `apps/desktop/internal/importer/` (`docx.go`, `markdown.go`, `markdown_inline.go`, `richtext.go`, `headings.go`, `txt.go`, `epub.go`, `epub_toc.go`, `epub_xhtml.go`, `epub_css.go`). Tests: `docx_test.go`, `markdown_test.go`, `txt_test.go`, `epub_test.go`, `epub_css_test.go`.

## DOCX

| Hazard | What Word stores | Handling | Test |
| --- | --- | --- | --- |
| Subtitle on a soft line break inside the heading | `<w:r><w:t>CHAPTER ONE</w:t></w:r><w:r><w:br/></w:r><w:r><w:t>Bad Ideas…</w:t></w:r>` — the break is an empty element, so text alone reads "CHAPTER ONEBad Ideas…" | `<w:br/>`/`<w:cr/>` become `\n`; the first line is the chapter title, the rest its subtitle | `TestDocxHeadingSoftBreakSplitsTitleAndSubtitle` |
| Title and subtitle separated by a tab | `<w:tab/>` between runs | Tab is a title/subtitle separator in headings, a single space in body text | `TestDocxHeadingTabSplitsTitleAndSubtitle`, `TestDocxBodyTabsBecomeSingleSpaces` |
| Number and title in adjacent runs with a style change but no space | `CHAPTER ONE` (bold run) then `Bad Ideas…` (regular run) | `splitGluedHeading` splits `<chapter\|part\|book> <number><Capitalized word>` at the capital and records a notice in `Draft.Notices` | `TestDocxGluedHeadingRunsAreSplitAndReported`, `TestSplitGluedHeading` |
| Heading that only looks glued | "Chapter Oneness", "Chapter Tension" | Not split: the number must be complete | `TestDocxPlainHeadingIsNotSplit` |
| Line breaks inside a body paragraph (verse, addresses) | `<w:br/>`, `<w:cr/>` | Preserved as a single `\n`, with no spaces beside it | `TestDocxBodySoftBreaksBecomeNewlines` |
| Tab stops declared in paragraph properties | `<w:pPr><w:tabs><w:tab …/>` | Ignored — only `<w:tab/>` inside a run is a tab | covered by run-scoped parsing |
| Emphasis, bold, underline | `<w:rPr><w:i/></w:rPr>`, `<w:b/>`, `<w:u w:val="single"/>`; `w:val="0"/"false"/"none"` turns it off | Recorded as UTF-16 `spans` over the normalized text | `TestDocxInlineFormattingBecomesUTF16Spans`, `TestDocxExplicitlyDisabledFormattingProducesNoSpans` |
| Emphasis via character styles | `<w:rStyle w:val="Emphasis"/>` / `Strong` | Mapped to italic / bold | `TestDocxCharacterStylesMapToFormatting` |
| Non-breaking / soft hyphens | `<w:noBreakHyphen/>`, `<w:softHyphen/>` | `-` / dropped | — |
| Deleted (tracked-change) text | `<w:delText>` | Ignored (only `<w:t>` counts) | — |
| Text boxes and shapes | nested `<w:p>` inside `<w:txbxContent>`, often duplicated in `mc:AlternateContent` | **Not supported**; may duplicate or drop text. Move the text into the body before importing | — |
| "TOC Heading" style, deliberately not an outline heading | Word's built-in style for the heading that introduces a table of contents, always `outlineLvl` 9 (which the importer otherwise reads as "not a heading at all") | Recognised by style name regardless of `outlineLvl`; the section it introduces is `contentKind: reference` like any other Contents heading | `TestDocxTOCHeadingStyleIsRecognizedDespiteItsOutlineLvl9` |
| A TOC before the first real chapter, or right after the book's Title | No heading paragraph precedes the TOC's own body, or a Title-styled paragraph does | The front-matter cutoff is the document's first heading of *any* kind, so the TOC's own entries stay attributed to it instead of falling into Cover/Front Matter or the Title "chapter" | `TestDocxTOCBeforeFirstChapterWithNoTitleIsNotSweptIntoFrontMatter`, `TestDocxTOCAfterTitleIsNotAbsorbedIntoTheTitleChapter` |
| Table-of-contents entry lines | `"TOC 1"`.."TOC 9"`-styled paragraphs, each usually a `w:hyperlink` whose `w:anchor` cites a `"_Toc"` bookmark Word opened around its target heading, plus an inert cached field (`fldChar`/`instrText`, ignored - only `<w:t>` is visible text) | Read as the document's own chapter list; see [Table of contents authority](#table-of-contents-authority) below | `TestDocxTOCWithBookmarksBecomesTheAuthoritativeChapterList` |
| An in-body cross-reference hyperlink | Word's "Insert cross-reference \> insert as hyperlink" reuses the target heading's existing `"_Toc"` bookmark rather than minting a `"_Ref"` one, so an ordinary sentence elsewhere in the manuscript can carry a `w:anchor` that looks exactly like a TOC entry's | Only a `"TOC N"`-styled paragraph counts as an entry; a hyperlink's anchor alone does not, so a stray cross-reference is never miscounted as one more (unmatched) TOC entry | `TestDocxAnOrdinaryCrossReferenceHyperlinkIsNotCountedAsATOCEntry` |

## Markdown

| Hazard | Source | Handling | Test |
| --- | --- | --- | --- |
| Wrapped source lines | one paragraph split over several lines | Joined with a single space | `TestMarkdownWrappedLinesJoinWithASpace` |
| Hard breaks | two trailing spaces, trailing `\`, or `<br>` | Preserved as `\n` | `TestMarkdownHardBreaksBecomeNewlines`, `TestMarkdownBrTagBecomesNewline` |
| Emphasis markers | `*i*`, `**b**`, `***bi***`, `<u>u</u>` | Markers removed; UTF-16 `spans` recorded | `TestMarkdownEmphasisBecomesSpansAndDropsMarkers` |
| Things that look like markers | `snake_case_name`, `2 * 3 * 4`, escaped `\*` | Left literal | `TestMarkdownIntrawordUnderscoresAndLoneAsterisksStayLiteral`, `TestMarkdownEscapedMarkersStayLiteral` |
| Subtitle in a heading | `# **CHAPTER ONE**<br>Bad Ideas…` | Markers stripped, `<br>` splits title/subtitle | `TestMarkdownHeadingBrSplitsSubtitleAndStripsMarkers` |
| Byte-order mark | leading `EF BB BF` | Stripped | `TestMarkdownByteOrderMarkIsStripped` |
| Number and title glued in one heading line | `# CHAPTER ONEBad Ideas…` (no separator at all) | `splitGluedHeading` repairs it, same as docx, and the split is now reported in `Draft.Notices` (previously discarded) | `TestMarkdownGluedHeadingSplitIsReportedAsANotice` |

## TXT

| Hazard | Source | Handling | Test |
| --- | --- | --- | --- |
| Encoding other than plain UTF-8 | A BOM (UTF-8, UTF-16 LE/BE) or a Windows-1252 export with no BOM at all | Decoded by BOM first, then valid UTF-8, then Windows-1252 with a `Notices` line naming the charset | `TestTxtUTF8BOMIsStripped`, `TestTxtUTF16LEAndBEDecode`, `TestTxtWindows1252FallbackIsReportedAsANotice`, `TestTxtValidUTF8NeedsNoNotice` |
| CRLF/CR line endings | A Windows or classic-Mac export | Normalized to `\n` before blocks are split | `TestTxtCRLFAndCRLineEndingsNormalize` |
| Chapter headings with no markup | A line (or two, the second a subtitle) matching `isNarrativeMarker` or a bare numeral/roman numeral/number word | Recognized conservatively; ALL-CAPS alone is never a heading | `TestTxtTwoLineHeadingHasSubtitle`, `TestTxtBareRomanNumeralIsAHeading`, `TestTxtBareNumberWordIsAHeading`, `TestTxtAllCapsAloneIsNotAHeading` |
| A `Contents` block | A block of many short lines listing every chapter | Read as reference text, never as a list of chapter headings | `TestTxtContentsBlockIsReferenceNotChapterList` |
| No chapter markup at all | A short story or excerpt with no heading line | One `narration` chapter titled from the file name, with a notice (ADR 0095) - diverges from Word/Markdown's `opening`-only chapterless behavior | `TestTxtChapterlessImportBecomesOneNarrationChapterWithNotice` |
| Hard-wrapped source lines | Gutenberg-style text wrapped at about 70 columns | Detected (45-100 character, 70%-majority band, ADR 0095) and joined with a space; short-line blocks (verse, addresses) and single long-line blocks with no blank lines keep their own line breaks | `TestTxtHardWrapDetectionJoinsWrappedLinesWithASpace`, `TestTxtShortLinesStayAsLineBreaksVerse`, `TestTxtNoBlankLinesAndLongLinesBecomeOneParagraphPerLine` |
| Gutenberg boilerplate | `*** START OF ... ***` / `*** END OF ... ***` markers | Stripped when both are present, reported in `Notices` | `TestTxtGutenbergBoilerplateIsStrippedAndReported` |
| Underscore italics | `_word_`, word-bounded | Becomes an italic span; `snake_case` and a lone underscore stay literal | `TestTxtUnderscoreItalicsBecomeSpans`, `TestTxtSnakeCaseAndLoneUnderscoresStayLiteral` |
| Glued heading | Same shape as DOCX/Markdown (`CHAPTER ONEBad Ideas`) | `splitGluedHeading` repairs it, reported in `Notices` | `TestTxtGluedHeadingIsSplitAndReported` |
| Empty file | Zero bytes | Rejected with an error, not imported as an empty manuscript | `TestTxtEmptyFileIsRejected` |

## EPUB

| Hazard | Source | Handling | Test |
| --- | --- | --- | --- |
| Chapters not in the spine order alone | A nav document (EPUB 3) or `toc.ncx` (EPUB 2) whose targets may point mid-file, or span several files | The TOC drives chapters (nav first, NCX fallback); a chapter runs from one target to the next across files, every depth | `TestEPUBNavTOCDrivesChapters`, `TestEPUBNCXFallbackWhenNoNav` |
| No usable TOC | Missing nav and NCX, or neither matches any spine document | Each spine document starting with its own `h1`/`h2` becomes a chapter instead, with a notice | `TestEPUBSpineFallbackWhenTOCIsMissing` |
| No chapter markup at all | No TOC and no headings | One `narration` chapter titled from the file name, with a notice - same T4 divergence as TXT | `TestEPUBNoTOCAndNoHeadingsBecomesOneChapter` |
| `epub:type` on a spine document's `<body>` | `cover`/`titlepage`/`frontmatter`/`dedication`/`epigraph`/`copyright-page`, `toc`/`acknowledgments`/`glossary`/`index`/`bibliography`/`endnotes`/`footnotes`/`backmatter`, `bodymatter`/`chapter`/`prologue`/`epilogue` | Forces the section's `contentKind` to `opening`/`reference`/`narration` respectively, overriding the title-text classifier (ADR 0102) | `TestEPUBBodyEpubTypeClassifiesDedicationAsOpening`, `TestEPUBBodyEpubTypeClassifiesEndnotesAsReference` |
| Glued heading | Same shape as DOCX/Markdown/TXT | `splitGluedHeading` repairs it and now reports the split in `Notices` (previously discarded) | `TestEPUBGluedHeadingIsSplitAndReported` |
| Non-linear spine items | `<itemref linear="no">` | Skipped, counted in a `Notices` line | `TestEPUBNonLinearItemIsSkippedAndReported` |
| Footnote reference markers | An inline `epub:type="noteref"` element | Its own text is dropped ("the end.1" reads "the end."); a note *body* is classified `reference` only when it occupies its own whole spine document | `TestEPUBNoteReferenceMarkerIsDropped` |
| Emphasis carried by a CSS class | `<span class="italic">` styled from an inline `<style>` or a linked stylesheet | A single-class, single-declaration `font-style`/`font-weight` rule maps to an italic/bold span, the same as `<em>`/`<strong>`; anything else counted, unstyled, in `Notices` | `TestEPUBCSSClassEmphasisFromInlineStyle`, `TestEPUBCSSClassEmphasisFromLinkedStylesheet`, `TestEPUBUnresolvedCSSClassIsCountedInNotices` |
| DRM | A `META-INF/encryption.xml` entry outside the two known font-obfuscation algorithms, or an Adobe `META-INF/rights.xml` | Import refused with a specific message; font obfuscation alone is accepted | `TestEPUBFontObfuscationIsAccepted`, `TestEPUBDRMIsRefused`, `TestEPUBAdobeRightsXMLIsRefused` |
| Hostile archive shapes | A `../` href leaving the archive, a missing `container.xml`, an oversized entry | Rejected before any content is read | `TestEPUBPathTraversalHrefIsRejected`, `TestEPUBMissingContainerIsRejected`, `TestEPUBOversizedEntryIsRejected` |

## Where the subtitle shows

A heading's subtitle is kept on every paragraph under it (`Paragraph.ChapterSubtitle`), and the import review lists it after the title ("Chapter One — Bad Ideas Look Great in Neon") so the narrator can confirm the split before anything is written. `DraftSection.Subtitle` is the subtitle of the first paragraph of the section, which is exactly what the written chapter gets (`manuscript.canonicalize` reads the paragraph that starts the chapter), so a repeated title (merged into one section) shows its first heading's subtitle and a heading with no text has none. Tests: `TestNewDraftSectionSubtitleIsTheFirstParagraphsSubtitleAsTheCommitReadsIt`, `TestDocxSoftBreakSubtitleReachesTheSectionForTheReview`, `TestMarkdownHeadingSubtitleReachesTheSectionForTheReview` and, across the host service, `TestPreviewSectionSubtitlesAreTheSubtitlesTheWrittenChaptersGet`. The field is additive (`subtitle`, omitted when empty), so `hostAPIVersion` is unchanged. Changing a wrong split from the review (the override) is a separate, evidence-gated piece of the briefs PRD. The review is described in [the import review](import-review.md).

## Table of contents authority

A docx's own table of contents can become the authoritative, ordered chapter list instead of the heading heuristic
([ADR 0089](../adr/0089-a-docx-table-of-contents-becomes-the-authoritative-chapter-list-above-a-match-threshold.md)). Entries are
read from `"TOC N"`-styled paragraphs; each is matched to a heading the heuristic already found, in order, by the `"_Toc"`
bookmark its own `w:hyperlink` cites, then by normalised heading text, then by position among whatever is left unmatched. Only
once **80%** or more of the TOC's own entries matched something does it win - and only the exposed `chapterTitles` changes when it
does; `Sections`/paragraph grouping are computed exactly as before and are never touched. Below the threshold, the heuristic's
chapter list is kept, and a notice ("The table of contents listed N entries; M matched a chapter in the manuscript.") is added
whenever the counts differ either way. No real user manuscript with a Word TOC field was available when this shipped; it is
verified against a hand-built OOXML fixture with real `_Toc` bookmarks (`docx_test.go`), not a real one - treat it as **awaiting a
real manuscript**. Markdown does not yet read its own table of contents (a `[text](#slug)` link list); chapters there still come
only from the heading structure.

## Adding a quirk

1. Reproduce it with a minimal in-test document (`docxFixture` builds a `.docx` from WordprocessingML; `importMarkdown` takes a string; TXT tests write a plain string to a temp file; `epubFixture` builds an in-memory EPUB from a name-to-content map).
2. Write the failing test, fix it in the importer, add the row above.
3. If the repair guesses (as glued-heading splitting does), report it in `Draft.Notices`: the import log and the review dialog's Repairs group tell the narrator ([the import review](import-review.md)).
