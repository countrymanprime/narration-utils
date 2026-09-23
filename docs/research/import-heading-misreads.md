# Import heading misreads (story bible and import UX briefs, Phase 4)

**Status: complete, docs and test fixtures only.** This is the Phase 4 write-up `docs/prds/story-bible-and-import-ux-briefs.prd.md` asks for. The owner decided on 2026-09-23 (open question I1) to build the per-heading subtitle override without first collecting misread manuscripts, so this phase is not an evidence gate. It records where the importer's title/subtitle heuristic goes wrong, using constructed cases rather than real manuscripts, and leaves each case behind as a fixture for Phase 5 (the override).

Every result below comes from running the importer, not from reading the code. The 23 cases are small manuscripts in `tests/fixtures/heading-misreads/`, written by that folder's `generate.py` (standard library only). `cases.json` records, for each case, what the author meant and what the importer produced. `TestHeadingMisreadFixtures` (`apps/desktop/internal/importer/heading_misreads_test.go`) runs `BuildDraft` on every file and fails if the output drifts from `cases.json`, so this page stays true until someone changes the heuristic on purpose.

## Where the split lives

The split is not in `docx.go`. The removed `import-settings-workflow.md` brief said it was ("first line = title, remaining = subtitle unconditionally"), and that claim is stale. Today:

- `headingParts` (`apps/desktop/internal/importer/headings.go:90-97`) splits one heading's text. The first line is the title. Every later line, joined with spaces, is the subtitle. A heading with only one line goes to `splitGluedHeading` (`headings.go:52`), which repairs a title and subtitle that were stored with nothing between them ([ADR 0013](../adr/0013-import-preserves-structural-whitespace.md)).
- DOCX (`docx.go:440`), Markdown (`markdown.go:101`) and EPUB (`epub.go:278`, `:281`, `:303`) call `headingParts`. A "line" is a soft break (`<w:br/>`) or a tab in a Word heading, a `<br>` in a Markdown heading, and a `<br/>` in an EPUB heading.
- Plain text has no heading markup, so it uses `classifyTxtHeading` (`txt.go:296`) instead. A block of one line, or of two lines whose first line is a chapter marker, is a heading, and the second line becomes the subtitle. A block of three or more lines is never a heading (`txt.go:297`).
- The subtitle lands in `Paragraph.ChapterSubtitle` (`model.go:13`). The review shows it as the first paragraph's `DraftSection.Subtitle` ([the import review](../architecture/import-review.md)).

The heuristic only ever looks inside the heading. No importer treats a separate paragraph or block after the heading as its subtitle. Most of the failures below come from that one fact.

## Results

The 23 cases are 5 controls, which read correctly, and 18 misreads in 8 failure modes. Each case uses one chapter heading followed by the same two body paragraphs. "Toggle" means a per-heading "second line is subtitle" switch over the lines the importer already splits on (PRD I2).

| Mode | What goes wrong | Cases | Formats | Where the subtitle ends up | Toggle fixes it |
| --- | --- | --- | --- | --- | --- |
| F1 | A title that wraps onto two lines is split into title and subtitle | 3 | DOCX, MD, EPUB | Half the title becomes the subtitle | Yes (off: join the lines) |
| F2 | A three-line heading (part, chapter, title) is split after its first line | 1 | DOCX | The chapter line and the real subtitle are joined into the subtitle | No |
| F3 | An epigraph directly under a text heading, with no blank line, becomes the subtitle | 1 | TXT | The subtitle, and it is no longer narrated as body text | Yes (off: the line returns to the body) |
| F4 | A subtitle in its own paragraph (Word "Subtitle" style, `*emphasis*` line, own text block, `<p class="subtitle">`) is missed | 4 | DOCX, MD, TXT, EPUB | The first body paragraph, so it gets narrated | No |
| F5 | A subtitle set as a lower-level heading (Heading 2, `##`, `<h2>`) is missed | 3 | DOCX, MD, EPUB | DOCX: a second, separate chapter, leaving "Chapter One" empty. MD: the section name of every paragraph after it. EPUB: dropped completely | No |
| F6 | A glued title and subtitle that the repair does not recognise | 3 | DOCX | Glued onto the title ("CHAPTER ONETHE STORM") | No |
| F7 | A one-line heading with a separator ("Chapter One: The Storm") | 1 | DOCX | Kept in the title | No |
| F8 | A text heading with the title above the number, or with three lines, is not found at all | 2 | TXT | The whole file becomes one chapter named after the file, and the heading lines are narrated | No |

Controls, which read correctly: `docx-soft-break-subtitle`, `md-br-subtitle`, `txt-two-line-subtitle` and `epub-br-subtitle` (a two-line "Chapter One / The Storm" heading in each format), and `docx-epigraph-after-heading` (an epigraph in its own Word paragraph stays body text).

## The cases

The file names are in `tests/fixtures/heading-misreads/`. "Intended" is title / subtitle.

| Case | Mode | Intended | Importer read |
| --- | --- | --- | --- |
| `docx-two-line-title.docx` | F1 | The Girl Who Fell Through the Ice / (none) | The Girl Who / Fell Through the Ice |
| `md-two-line-title-br.md` | F1 | The Girl Who Fell Through the Ice / (none) | The Girl Who / Fell Through the Ice |
| `epub-two-line-title-br.epub` | F1 | The Girl Who Fell Through the Ice / (none) | The Girl Who / Fell Through the Ice |
| `docx-three-line-heading.docx` | F2 | Chapter One / The Storm (under Part One) | Part One / Chapter One The Storm |
| `txt-epigraph-under-heading.txt` | F3 | Chapter One / (none), epigraph in the body | Chapter One / "Water finds its level." |
| `docx-subtitle-style-paragraph.docx` | F4 | Chapter One / The Storm | Chapter One / (none), body starts "The Storm" |
| `md-subtitle-emphasis-line.md` | F4 | Chapter One / The Storm | Chapter One / (none), body starts "The Storm" |
| `txt-subtitle-own-block.txt` | F4 | Chapter One / The Storm | Chapter One / (none), body starts "The Storm" |
| `epub-subtitle-class-paragraph.epub` | F4 | Chapter One / The Storm | Chapter One / (none), body starts "The Storm" |
| `docx-subtitle-as-heading-2.docx` | F5 | Chapter One / The Storm | Two chapters: "Chapter One" (empty) and "The Storm" |
| `md-subtitle-as-h2.md` | F5 | Chapter One / The Storm | Chapter One / (none), section "The Storm" |
| `epub-subtitle-as-h2.epub` | F5 | Chapter One / The Storm | Chapter One / (none); "The Storm" is not imported |
| `docx-glued-all-caps.docx` | F6 | CHAPTER ONE / THE STORM | CHAPTER ONETHE STORM / (none), no repair notice |
| `docx-glued-one-letter-word.docx` | F6 | Chapter Two / A Night on the Levee | Chapter TwoA Night on the Levee / (none) |
| `docx-glued-two-word-number.docx` | F6 | Chapter Twenty One / The Storm | Chapter Twenty OneThe Storm / (none) |
| `docx-separator-one-line.docx` | F7 | Chapter One / The Storm | Chapter One: The Storm / (none) |
| `txt-title-above-number.txt` | F8 | Chapter One / The Storm | No heading; one chapter "txt-title-above-number" |
| `txt-three-line-heading.txt` | F8 | Chapter One / The Storm (under Part One) | No heading; one chapter "txt-three-line-heading" |

## Why each mode happens

- **F1, F2.** `headingParts` treats every line break inside a heading as "title, then subtitle". It cannot tell a subtitle from a title that the author broke by hand to make it look right on the page. It also has no idea of a part line above the chapter line.
- **F3.** `classifyTxtHeading` accepts any second line under a chapter marker as the subtitle. It does not check what the line looks like, so a quotation is accepted too.
- **F4.** No importer looks past the heading paragraph or block. The DOCX reader counts a paragraph as a heading only if its style name starts with "heading", or is "title" or "toc heading", or if it has an outline level (`docx.go:339`). Word's built-in "Subtitle" style is none of these, so the subtitle becomes an ordinary paragraph.
- **F5.** Every DOCX heading, at any level, starts a chapter (`docx.go:430-446`). A Markdown heading below the chapter level becomes a section name (`markdown.go:110`). An EPUB heading that is not a table-of-contents target is skipped as a heading, and it is not emitted as body text either (`epub.go:452`), so its words disappear from the import with no notice. This is the only mode that loses text.
- **F6.** `splitGluedHeading` splits only where a capital letter followed by a lowercase letter begins a word, straight after one complete number token (`headings.go:71`). That rules out an all-caps subtitle, a subtitle whose first word is a single letter ("A", "I"), and a number written as two words ("Twenty One"). No repair notice is shown in these cases, so the review gives no sign that anything is wrong.
- **F7.** No importer splits on ":" or a dash. This is by design today: `alice.docx` and `alice.md` rely on "Chapter I: Down the Rabbit-Hole" staying one title (`TestDocxFixtureRetainsTitleAndNarrativeChapters`, `TestMarkdownFixtureRetainsTitleAndNarrativeChapters`). It is listed here so that Phase 5 decides it deliberately, not as a defect to fix silently.
- **F8.** Plain text finds headings conservatively. A heading must start with its chapter marker and have at most two lines. A title above the number, or a part/chapter/title stack, is read as an ordinary paragraph. When nothing in the file is a heading, the whole file becomes one chapter ([import quirks](../architecture/docx-import-quirks.md) covers the DOCX side).

## What Phase 5 did

Phase 5 built the override ([ADR 0135](../adr/0135-a-subtitle-turned-off-in-the-import-review-joins-the-title-or-returns-to-the-text-by-where-its-line-came-from.md)). A section's subtitle turned off in the review joins the title when the line was inside a heading (F1) and returns to the body when it was the second line of a plain-text heading (F3); the host says which in the preview (`subtitleOff`). The four cases it fixes carry an `override` entry in `cases.json`, and `TestHeadingMisreadOverrides` applies it and expects `intended`; the same test checks that no override changes any case. F2 and F4 to F8 are unchanged and are listed in [#387](https://github.com/countrymanprime/narration-utils/issues/387); the EPUB `<h2>` that is dropped (F5) is its own bug, [#388](https://github.com/countrymanprime/narration-utils/issues/388).

## What this meant for Phase 5 (written before it)

- **The toggle as specified reaches only F1.** PRD I2 lists each multi-line heading with a per-heading "second line is subtitle" toggle, plus a global default. That fixes the 3 F1 cases, the only modes where the importer already has two lines and only the reading is wrong. The other 15 misreads have nothing for a line toggle to act on:
  - F4, F5 and F8: the subtitle never reaches the heading.
  - F6 and F7: the heading is one line.
  - F2: the right answer needs three roles, not two.
- **"Not a subtitle" means two different things.** For F1, it means "join the second line back into the title". For F3, it means "the second line is body text". Phase 5 has to choose one meaning, or offer both. If the toggle only joins lines, F3 becomes "Chapter One “Water finds its level.”", which is still wrong.
- **F5 in EPUB silently loses text.** Whatever Phase 5 decides about subtitles, a skipped `<h2>` never reaches the review, so no override can recover it. Emitting it as body text, or reporting it as a notice, is a separate importer fix. It may be worth doing on its own.
- **Controls stay put.** Phase 5's success signal ("importer fixtures unchanged for correct headings") can use the 5 controls directly. Their `observed` values in `cases.json` must not change when the override is off.
- **Using the fixtures.** Each case's `intended` value is the expected output after the override is applied. Each case's `observed` value is what the heuristic produces before the override. Phase 5 can run a table test over `cases.json`, applying an override and checking against `intended`, instead of building its own inputs. If a Phase 5 importer change moves an `observed` value, update `cases.json` and this page in the same change. Regenerate the files with `python generate.py` from the folder.

## Not covered

- Real manuscripts. None were supplied, and the owner chose not to wait for them (I1). A constructed case shows that a failure mode exists. It does not show how often real authors hit it.
- PDF. The Go PDF path does not import chapter structure reliably yet (`TestPDFFixtureIsRejectedUntilChapterBoundariesAreReliable`, `tests/fixtures/README.md`).
- The EPUB table-of-contents label path (`epub.go:281`). It is used only when the TOC target is not a heading block, and it goes through the same `headingParts`, so it adds no new mode.
