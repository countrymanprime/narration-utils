# 0645. The Production board draws mock 01's cells, columns and layout, and the mock wins the open audit layout questions

**Status:** Proposed (Phase 11 of the [mock fidelity PRD](../prds/mock-fidelity-primitives-and-components.prd.md), stream F-P11 on [#509](https://github.com/countrymanprime/narration-utils/issues/509); the PR3, PR9 and PR12 answers below were taken from D91 and D22 and are for the owner to confirm on [#510](https://github.com/countrymanprime/narration-utils/issues/510))
**Date:** 2026-09-28
**Supersedes:** clause 2 of [ADR 0600](0600-every-pill-tag-and-status-dot-is-one-badge-primitive-with-a-pill-a-tag-and-a-booth-shape.md) (its three shapes) and, for the board cell only, its clause 6 (height is a minimum); StageGrid's 10 px cell side padding in [ADR 0605](0605-table-and-stage-grid-share-the-mocks-row-and-header-sizes-and-cells-sit-in-the-middle-of-the-row.md); the 16 px tile padding and the stacking below `sm` of [ADR 0615](0615-statstrip-is-a-new-primitive-drawing-the-benchmarks-one-card-kpi-row.md)

## Context

Production scored lowest of the benchmark pages in the baseline (83.24% against `01-production-home`). The owner named it specifically: its pills weren't uniform, its buttons were wrong, and its tables didn't look like the mock (D91 on #509). Phases 1 to 4 and 9 fixed the shared primitives. Phase 11 composes them on the page.

This phase measured benchmark mock 01 again, reading each edge as a change in a column or row of pixels:

- **Board cells.** Every cell is a flat block 58 px wide and 20 px tall on the 3 px tag radius, whatever it says ("✓", "–", "3 open", "proofer", "62%", "PASS"). Its label is Barlow Condensed at about 11 px in its own case. The columns repeat every 66 px.
- **Board columns.** The chapter names take 244 px from the card's edge and the length (FIN.) 112 px, in IBM Plex Mono. The stage columns follow, then the spare width. The mock truncates a long chapter name ("4 · The Rabbit Sends…"). The row-header column is headed CHAPTER, visibly.
- **Card.** The board is flush in its card under a 51 px header whose subtitle sits on the title's line. The rows start 10 px in from the card's edge.
- **Page.** The content fills the width beside the rail (1176 px at 1440). The six figures are one card 110 px tall. The board and Next up sit side by side, Next up in a 340 px column. The header's buttons line up with the foot of the title and its subtitle.
- **Figures.** In a tile, the label's capitals start 17 px below the top of the card. The value's are 21 px below those, and the hint's 29 px below those, on an 18 px line. The last line ends 17 px above the card's bottom.

The app drew each cell as a pill 22 px tall and as wide as its label ("NOT READY", "11:48"). Its columns spread across the whole card, and its figures sat in six cards. Next up sat above the board below 1600 px, and a 1152 px cap centred the page.

The visual audit left three Production layout questions to the owner: PR3 (the pace pill), PR9 (column order) and PR12 (Next up beside the board at 1440 px). None has been answered on #510. Since then, D91 made the approved mocks binding at a 90% pixel match, and the dispatch for this stream says to take the PRD's recommendation where a question is open (D22).

## Decision

**StatusBadge** gains a fourth shape, `cell`: 20 px tall and at least 58 px wide, on `--radius-tag`, its label centred in Barlow Condensed 600 at `--font-size-label` in its own case, never wrapped, and clipped inside the cell if it is longer, so it never draws over the next column. This is the one badge whose height is fixed, against ADR 0600's clause 6: a wrapped cell would break the rows the mock lines up, and a board keeps its labels short instead.

**StageGrid** takes mock 01's board:

- The row-header column is headed visibly (`rowHeader`, "Chapter" by default).
- Every badge cell is the `cell` shape, with 4 px either side (in place of Table's 10 px, ADR 0605), so badge columns repeat every 66 px. The row names and a figure column keep Table's 10 px.
- A cell with `look: 'text'` is a mono figure, Table's `numeric` type, instead of a badge. It is still a grid cell that can be activated.
- The table is laid out fixed. The row names take 15.25 rem (244 px), a figure column 7 rem and a badge column 4.125 rem. The last column takes the spare width, so a wide card lines its cells up as the mock does and a narrow one scrolls. A row name that doesn't fit ends in an ellipsis, and its full text stays in the cell (and in `title`), so a screen reader hears it whole.

**StatTile and StatStrip** take the measured line boxes. The label is on a 1.2 line and the value on a 1.35 line, 4 px below the label. The hint is on an 18 px line. The strip insets a tile 14 px at the top, 12 px at the bottom and 16 px at the sides (ADR 0615 had 16 px all round). That is 110 px for a tile with a two-line hint, as mock 01 draws.

**StatStrip wraps into full rows** instead of clipping. ADR 0615 kept every tile in one row from `sm` up, with `overflow-hidden` on the card, so at 1024 and 768 px Production's last figures were cut off. The strip is now a grid, sized by the width of its own card (a container query): every tile in one row from 64 rem, half of them a row from 36 rem, two from 22 rem and one below that. Each tile draws the rule on its left and top, and the card clips the rules on its own edges. So a rule runs between every two tiles in any arrangement, and a short last row leaves plain surface.

**The Production page** composes these:

- **Figures:** the six figures are one `StatStrip`. The finished-audio hint is one line ("6 of 12 chapters measured"); the "~" on the target already says it is an estimate.
- **Board card:** a flush `Panel`. Its header holds the subtitle "every cell opens that stage for the chapter" (the Recorded explanation moves to a tooltip), with the stage suggestion chips as the header's actions, where the mock draws its filter. A failed suggestion read or a project note sits in a strip under the header.
- **Board rows:** the chapter a timer runs on is the current row, in bold. The Recorded length is a mono figure.
- **Board labels** fit the 58 px cell: a stage whose evidence changed since it was confirmed reads "Changed" (the chip over the board says whose), and a recording check under way reads its percent ("70%"), as mock 01 draws a stage under way. The slide-overs keep the full wording.
- **PR9, column order:** the mock's order, Recorded then Prep, Record, Edit, Proof and Delivery. Moving Prep before Record was "a layout choice" in the audit; the mock's order is the pipeline's order.
- **PR12, side by side:** the board and Next up sit side by side from a 1280 px window, Next up in a 21.25 rem column. Below that they stack with Next up first, as before. #760's reason for stacking was that the board squeezed out Delivery at 1440 px. It no longer holds: the board's cells are 58 px, and its columns fit in 810 px.
- **Next up:** a Panel with the subtitle "ranked by deadline risk" (the order's explanation moves to a tooltip). Each item is two lines: the chapter's name in bold, then what to do and why, muted. The item's Start timer button is `size="sm"`.
- **Page width:** the content fills the width beside the rail up to 96 rem.
- **Header:** the actions line up with the foot of the title.
- **PR3, the pace pill:** not drawn. The reason #760 recorded still holds: a pace projection would mix logged hours with an estimated amount of work left ([ADR 0015](0015-real-progress-only.md), [ADR 0320](0320-pfh-and-the-effective-rate-come-only-from-logged-hours-and-measured-recorded-time.md)).

A `?mockFidelity=01` mock-backend fixture (`api/mockHost/mockFidelity.ts`) seeds mock 01's statuses, lengths, stage hours, rate, delivery date and running timer. The catalog row `production/mock-fidelity-01` shows it, and mock 01 is scored against that row (PRD Q5).

## Consequences

- Every board cell is the same block, so a column lines up whatever its cells say. That is the "pills aren't uniform" the owner named.
- A chapter name longer than 244 px is cut short on the board at every width. The full name is on hover, to a screen reader, and in the slide-overs.
- Between 1280 and 1600 px, Next up moves from above the board to beside it. Above 1600 px it is unchanged.
- StatTile's tighter line boxes shrink every StatStrip and stand-alone StatTile by about 6 px (Production, Proof's compare run, the recording check card).
- Mock 01 still scores under 90% (see the PR's Mockup check). The remaining difference is:
  - the shell's rail and header (Phase 8, F-P8b);
  - the features the mock draws that have no data yet: the burndown chart (PR14), This week (PR15), the Pickups, Master and QC columns and tiles (PR7, PR13), and the pace pill (PR3);
  - the mock's own sample text ("1 · Down the Rabbit-Hole" against [chapterName](../../apps/ui/src/chapterName.ts)'s "Chapter 1 — Down the Rabbit-Hole").
- To change the column widths or the cell size, write a new ADR that supersedes this one. If the owner answers PR3, PR9 or PR12 differently on #510, that answer supersedes the matching part of this ADR.
