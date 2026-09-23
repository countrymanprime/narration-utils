# 0135. A subtitle turned off in the import review joins the title or returns to the text, by where its line came from

**Status:** Proposed
**Date:** 2026-09-23
**Supersedes:** (none; amends ADR-0086, which left changing a wrong split to the briefs PRD)

## Context

The importer's title/subtitle heuristic reads every line after a heading's first as its subtitle (`headingParts`, `apps/desktop/internal/importer/headings.go`), and the second line of a two-line plain-text heading block as its subtitle (`classifyTxtHeading`, `txt.go`). The owner chose to let the narrator correct it before the commit (story-bible-and-import-ux-briefs PRD, open questions I1 and I2, 2026-09-23): a global "second line is subtitle" default plus a per-heading override in the import review list, each row starting from the heuristic's guess.

Phase 4 of that PRD ([the heading misreads note](../research/import-heading-misreads.md), fixtures in `tests/fixtures/heading-misreads/`) found that "not a subtitle" means two different things:

- **F1**: a title the author wrapped by hand onto two lines inside the heading ("The Girl Who / Fell Through the Ice", Word, Markdown and EPUB). The line belongs to the title.
- **F3**: an epigraph on the line under a plain-text heading with no blank line between them. The line is body text, and while it is a subtitle it is not narrated.

A toggle that only joined lines would turn F3 into "Chapter One “Water finds its level.”", still wrong, and one that only returned lines to the text would turn F1 into a chapter called "The Girl Who" that starts with "Fell Through the Ice".

## Decision

- **The importer says, per section, where its subtitle goes when it is turned off**: `DraftSection.SubtitleOff` (`subtitleOff` on the wire), `"title"` or `"body"`, sent with every subtitle and omitted without one. A plain-text heading's second line (`Paragraph.SubtitleReturnsToBody`, never written to the manuscript) is `"body"`. Every other subtitle, a line inside a Word, Markdown or EPUB heading or the split of a glued heading, is `"title"`. The narrator sees one switch per row; the host already knows which of the two meanings it has, so the review does not ask.
- **The correction is applied in the commit, before canonicalization**: `importer.ApplySubtitleOverrides(draft, overrides)` returns a new draft in which each section mapped to `false` has no subtitle, and its line either joins the title (`"Title Line"`, in the section, its paragraphs and `ChapterTitles`) or becomes the section's first paragraph, in no subsection. `true`, a missing id, or `false` on a section with no subtitle changes nothing; an id the preview does not have fails the commit before anything is cleared or written. `manuscript.Service.Commit` and `StartCommit` take a `Choices` struct (section kinds and subtitle overrides).
- **`ManuscriptImportCommit` takes a fifth argument**, `subtitleOverrides map[string]bool`, on `h.services()`. `hostAPIVersion` is 29.
- **The review holds the default and the rows, and sends them resolved.** `ManuscriptImportSelection.subtitleDefault` ("Read a heading's second line as its subtitle" in the Import options group, on by default) is review state only; each row with a subtitle has a "Subtitle" checkbox (named "Subtitle — <the line>") whose value is the row set by hand, else the default. The commit sends `false` for every section whose subtitle is off (`subtitleOverridesToCommit`, `importReviewModel.ts`). A row set by hand keeps its answer when the default changes (owner decision I2: the default is the book's house style, the rows are its exceptions). The row shows the heading as it will be written: the joined title, or the title with "<line> is read as text".
- **Nothing else changes about the heuristic.** The cases a line switch cannot reach (F2 and F4 to F8, where the importer never produces the right second line) are left to a follow-up ([#387](https://github.com/countrymanprime/narration-utils/issues/387)).

## Consequences

- The three F1 cases and the F3 case are fixed from the review list, and `TestHeadingMisreadOverrides` proves it on the Phase 4 fixtures; with no override every fixture, the five controls included, is read exactly as before.
- The heading-level choice for Markdown still drops the narrator's choices, subtitles included, because the sections are new.
- A repeated heading is one section. Returned to the text, every one of its headings' lines comes back in front of the text under that heading (the importer marks the first paragraph under each plain-text heading), so no line is lost. Joined, the whole section takes the first heading's joined title, as the written chapter already takes only the first heading's subtitle. A joined title that equals another section's title is written as one chapter with it, the way a repeated heading already is.
- A Word or EPUB heading whose second line is really an epigraph can only be joined, not returned to the text. No constructed case shows it. Letting the narrator choose between the two meanings would change the override from a boolean to a value per section, and bump `hostAPIVersion` again.
- Superseding this means a new ADR that changes `subtitleOff`'s meaning or where the correction is applied.
