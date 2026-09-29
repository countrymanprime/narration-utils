# 0605. Table and StageGrid share the mocks' row and header sizes, and cells sit in the middle of the row

**Status:** Proposed (Phase 3 of the mock fidelity PRD, stream F-P3 on [#509](https://github.com/countrymanprime/narration-utils/issues/509); StageGrid's badge cells take 4 px side padding, not 10, by [ADR 0645](0645-the-production-board-draws-mock-01s-cells-columns-and-layout-and-the-mock-wins-the-open-audit-layout-questions.md))
**Date:** 2026-09-28
**Supersedes:** [ADR 0056](0056-a-presentational-table-primitive-replaces-the-dtable-class-and-rows-take-the-keyboard.md)'s "`TableCell` is top-aligned" clause only (the rest of ADR 0056 stands)

## Context

The owner found that the merged pages don't match the approved mocks, and the tables most of all (D91 on #509). The mock fidelity PRD's Phase 3 gives the spec for `Table` and `StageGrid`, and [ADR 0590](0590-the-mock-fidelity-token-batch-fills-badges-with-opaque-soft-tokens-and-names-the-mocks-sizes-and-type.md) added the tokens it needs (`--row-height`, `--header-row-height`, `--row-selected`, `--font-size-label`, `--tracking-label`).

This phase measured the benchmark mocks again, finding each divider as a row of near-uniform pixels across the table:

- **Mock 05** (per-file checks): the card header's divider is at y 169 and the header rule at y 201, so the header row is 32 px including its rule. The six body rows are 34, 34, 34, 33, 34 and 34 px, divider included. The FAIL row is filled `#faf2ef` (the PRD says `#faf1ed`; both are within the WebP's error of `--row-selected`, the accent at 8% over the surface).
- **Mock 01** (chapter pipeline): the header row is 31 px (y 316 to 347). The body rows alternate 33 and 34 px (a mean of 33.4), because the mock is drawn on fractional pixels.
- In both, the first column's text starts 10 px inside the card's border, so the table runs to the card's edge and the cell's own padding keeps the text off it.
- **Mock 02** (pronunciations): rows of two and three lines hold a one-line cell in their middle, not at the top.

The app drew a 40 px header and 40.6 px rows, top-aligned cells at 13.76 px, and nine files had their own `MONO` constant to set numbers in Plex Mono.

## Decision

`Table` and `StageGrid` share one look, kept in `apps/ui/src/components/primitives/tableStyles.ts`:

- **Header row:** `--header-row-height` (31 px, rule included), no fill, Barlow Condensed at `--font-size-label` (11 px), weight 600, uppercase, `--tracking-label` (0.1 em), `--text-muted`.
- **Body row:** `--row-height` (34 px, divider included) as a cell's `height`, which in a table is the row's least height, so a cell of two lines or a pill still grows its row. The cells have 10 px side padding and 5 px above and below: with the 22 px status pill of today's `StageGrid`, 6 px made a 35 px row.
- **Body text:** IBM Plex Sans at 14 px.
- **Cells sit in the middle of the row.** `TableCell valign="top"` keeps a cell at the top, for a table whose rows run to several lines and whose first lines should stay level. This replaces ADR 0056's "`TableCell` is top-aligned". The prop is `valign`, not the PRD's `align="top"`, because `align` already sets the horizontal alignment and a cell may need both.
- **`TableCell numeric`:** IBM Plex Mono at 13 px, right-aligned and never broken; `align="left"` keeps a numeric cell left (a time column the mock draws on the left). It replaces the call sites' `MONO` constants.
- **`TableCell muted`:** secondary text at 12 px in `--text-muted`. The mock draws this text (mock 04's FROM column) in `--non-text`. `--non-text` is a 3:1 token for marks, and body text needs 4.5:1 ([ADR 0059](0059-text-colours-meet-wcag-aa-with-two-text-levels-a-non-text-token-and-derived-on-tint-text.md)), so the cell uses `--text-muted`.
- **Rows:** a `selected` row is filled with `--row-selected` (it was `--surface-2`). `TableRow emphasis="current"` sets the row in weight 600 with no fill (mock 01's current chapter). `emphasis="highlight"` gives a row the selected fill without `aria-selected` (mock 05's failing file), because the page points at the row but the user has not selected it. `StageGrid currentRow` bolds a chapter's row the same way.
- **`Table flush`** runs the table to the side edges of the `Panel` it sits in, by spanning Panel's 1.1 rem side padding with a negative margin. When Panel gets a flush body (the PRD's Phase 4), that body takes this over and `flush` stops using the margin.

Phase 3 migrates the call sites the PRD assigns it. The `MONO`, `text-sm` and `align-top` overrides on cells in `engine/*`, `master/{DiagnosticsTables,FileRulesPanel,DeliveryProfilePanel,MasterToSpecPanel}`, `production/RecordingCheckReport`, `proof/PreviewPanel`, `settings/DeliveryProfileEditor` and `storybible/{Guide,GuideDetail,PropertiesSection}` move onto the props. `MONO` constants that style spans inside a cell, rather than the cell itself, stay. Two tabular lists become tables:

- Production's milestones: the column headers name the fields, which are header-labelled `TextField`s.
- Settings' delivery profiles.

Two lists on the PRD's list are not converted here:

- **`master/BookChecklist`** is Phase 14's file (the PRD's ownership rule).
- **`storybible/PronunciationQueries`** sits in a 20 rem (320 px) slide-over, where each query stacks six facts (name, alias, IPA and its source, where it is in the book, the note, two actions). At that width a table would need a sideways scroll to show fewer of them. It stays a list, and the Script rail's pronunciation table (mock 02) is Phase 15's.

## Consequences

- Every table and the production grid inherit the mocks' sizes from the tokens, and the page phases (11 to 15) build on these props, not on local overrides. `ChapterBoard` (`StageGrid currentRow`), `PerFileChecks` (`numeric`, `emphasis="highlight"`), `FindingsList` (`numeric align="left"`, `muted`) and the Script rail are left to their phases, as the PRD's ownership rule says.
- Rows are shorter, so pages hold more of them and some captures change height. Multi-line tables whose call sites didn't ask for `align-top` now centre their one-line cells.
- A numeric cell never breaks, so a long value widens its column instead of wrapping. A table that can outgrow its container needs its own sideways scroll region, because the visual suite fails a page that overflows sideways.
- `flush` depends on Panel's padding until Phase 4. A change to that padding must change `flush` with it.
- To change the row sizes, change the tokens (a follow-up token batch, per [ADR 0360](0360-studio-primitives-land-as-flat-leaf-files-after-one-token-batch-and-capability-gating-is-a-primitive.md)). To change anything else here, write a new ADR that supersedes this one.
