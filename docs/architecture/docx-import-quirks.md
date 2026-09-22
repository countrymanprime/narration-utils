# Manuscript import: formatting quirks and how they are handled

**Status: living catalogue.** Word and Markdown documents encode the same visible text in many ways. Several import regressions ("CHAPTER ONEBad Ideas Look Great in Neon", paragraphs that lost their line breaks) came from one of these encodings, were fixed, and came back because the reason was never written down. Each row below is a known hazard, what the document looks like, what the importer does, and where the test lives. Add a row (and a test) whenever a new one is found. The governing decision is [ADR-0013](../adr/0013-import-preserves-structural-whitespace.md); formatting spans are [ADR-0014](../adr/0014-inline-formatting-as-offset-spans.md).

Code: `apps/desktop/internal/importer/` (`docx.go`, `markdown.go`, `markdown_inline.go`, `richtext.go`, `headings.go`). Tests: `docx_test.go`, `markdown_test.go`.

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

## Markdown

| Hazard | Source | Handling | Test |
| --- | --- | --- | --- |
| Wrapped source lines | one paragraph split over several lines | Joined with a single space | `TestMarkdownWrappedLinesJoinWithASpace` |
| Hard breaks | two trailing spaces, trailing `\`, or `<br>` | Preserved as `\n` | `TestMarkdownHardBreaksBecomeNewlines`, `TestMarkdownBrTagBecomesNewline` |
| Emphasis markers | `*i*`, `**b**`, `***bi***`, `<u>u</u>` | Markers removed; UTF-16 `spans` recorded | `TestMarkdownEmphasisBecomesSpansAndDropsMarkers` |
| Things that look like markers | `snake_case_name`, `2 * 3 * 4`, escaped `\*` | Left literal | `TestMarkdownIntrawordUnderscoresAndLoneAsterisksStayLiteral`, `TestMarkdownEscapedMarkersStayLiteral` |
| Subtitle in a heading | `# **CHAPTER ONE**<br>Bad Ideas…` | Markers stripped, `<br>` splits title/subtitle | `TestMarkdownHeadingBrSplitsSubtitleAndStripsMarkers` |
| Byte-order mark | leading `EF BB BF` | Stripped | `TestMarkdownByteOrderMarkIsStripped` |

## Where the subtitle shows

A heading's subtitle is kept on every paragraph under it (`Paragraph.ChapterSubtitle`), and the import review lists it after the title ("Chapter One — Bad Ideas Look Great in Neon") so the narrator can confirm the split before anything is written. `DraftSection.Subtitle` is the subtitle of the first paragraph of the section, which is exactly what the written chapter gets (`manuscript.canonicalize` reads the paragraph that starts the chapter), so a repeated title (merged into one section) shows its first heading's subtitle and a heading with no text has none. Tests: `TestNewDraftSectionSubtitleIsTheFirstParagraphsSubtitleAsTheCommitReadsIt`, `TestDocxSoftBreakSubtitleReachesTheSectionForTheReview`, `TestMarkdownHeadingSubtitleReachesTheSectionForTheReview` and, across the host service, `TestPreviewSectionSubtitlesAreTheSubtitlesTheWrittenChaptersGet`. The field is additive (`subtitle`, omitted when empty), so `hostAPIVersion` is unchanged. Changing a wrong split from the review (the override) is a separate, evidence-gated piece of the briefs PRD. The review is described in [the import review](import-review.md).

## Adding a quirk

1. Reproduce it with a minimal in-test document (`docxFixture` builds a `.docx` from WordprocessingML; `importMarkdown` takes a string).
2. Write the failing test, fix it in the importer, add the row above.
3. If the repair guesses (as glued-heading splitting does), report it in `Draft.Notices`: the import log and the review dialog's Repairs group tell the narrator ([the import review](import-review.md)).
