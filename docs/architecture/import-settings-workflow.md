# Import heading and subtitle review

Two-line manuscript headings ("Chapter One / A New Beginning") are split into a title and a subtitle by a heuristic
that sometimes misreads. Delivered by the story-bible-and-import-ux-briefs PRD's I brief (phases 4-5): a documented
set of the heuristic's failure modes, then a per-heading override in the import review so the narrator can correct one
without hand-editing the manuscript. This page replaces that PRD (its Open Questions I1-I2 hold the decisions'
reasoning) now that it is deleted.

## Failure modes

`docs/research/import-heading-misreads.md` documents 23 constructed cases (5 controls, 18 misreads across 8 failure
modes), pinned as fixtures under `tests/fixtures/heading-misreads/` and checked by
`apps/desktop/internal/importer/heading_misreads_test.go`. The finding that shaped Phase 5: a per-heading line toggle
alone fixes only the two-line-title cases (failure mode F1); the rest (F2, F4-F8) are out of a line switch's reach and
are filed as follow-ups (#387; a dropped EPUB `<h2>` is a separate bug, #388).

## The override

- **The split itself:** `headingParts` in `apps/desktop/internal/importer/headings.go` separates a heading's title
  from its subtitle and repairs glued headings, called from both `docx.go` and `markdown.go`. The result lands in
  `Paragraph.ChapterSubtitle` (`model.go`).
- **The narrator's override:** a global default ("Read a heading's second line as its subtitle") plus a per-heading
  Subtitle checkbox in the import review list (`apps/ui/src/components/production/ImportReview.tsx`'s
  `TitleSubtitle`/`hasSubtitleChoice` rows). Turning a row's checkbox off joins its second line back into the title,
  or returns a plain-text line to the body, by where its line came from ([ADR 0135](../adr/0135-a-subtitle-turned-off-in-the-import-review-joins-the-title-or-returns-to-the-text-by-where-its-line-came-from.md)).
- **The commit path:** `ManuscriptImportCommit` takes a `subtitleOverrides` map keyed by section id (`hostAPIVersion`
  29); the review UI collects the narrator's per-row choices into it before commit.

## Tests

Go: `TestHeadingMisreadFixtures` (the 23 constructed cases stay pinned) and `TestHeadingMisreadOverrides` (the
override fixes the three F1 cases and the one F3 case from `cases.json`, and leaves every case unchanged with no
override set). Vitest: `ImportReview.test.tsx` covers the per-row checkbox and the global default. Visual:
`production/import-review-subtitles-off` and `production/import-review-text-subtitle` in the Playwright visual suite.
