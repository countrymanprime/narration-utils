# 0650. Proof's notes card composes Table flush, StatusBadge and Panel's header, and the filters move behind a popover

**Status:** Proposed (Phase 12 of the mock fidelity PRD, stream F-P12 on [#509](https://github.com/countrymanprime/narration-utils/issues/509))
**Date:** 2026-09-28
**Supersedes:** none. It draws [ADR 0470](0470-proof-follows-mock-04-pickup-edit-waived-are-words-over-the-stored-status-and-the-chapter-view-leads-with-its-notes.md)'s notes header and table with the primitives [ADR 0600](0600-every-pill-tag-and-status-dot-is-one-badge-primitive-with-a-pill-a-tag-and-a-booth-shape.md), [ADR 0605](0605-table-and-stage-grid-share-the-mocks-row-and-header-sizes-and-cells-sit-in-the-middle-of-the-row.md) and [ADR 0640](0640-panel-draws-the-mocks-card-header-with-a-divider-and-a-padded-or-flush-body-and-the-eyebrow-and-inset-card-are-primitives.md) delivered, and keeps everything else ADR 0470 decided (the words, the Sources line, Play ±3 s).

## Context

The mock fidelity PRD's Phase 12 gives Proof's book level (`proof/default`, scored against `stage-navigation-and-page-replacement/04-proof-pickups-concept.webp`, "mock 04") its own spec row: a flush table, `StatusBadge`'s two shapes for the TYPE and RESOLUTION columns, the notes header composed from Panel's own header row, and no filter row (the mock draws none). At the baseline (2026-09-28, `main` at `6677fec`) the state scored 89.55%, with the difference named as "Filter row of selects above the notes (mock: none); notes table inset in a padded card (mock: flush) with 40 px rows (mock 38); type badges round (mock 16 px tags radius 3); no waveform header card."

`FindingsList.tsx` already built its notes table on `Table`, `StatusBadge` and `Panel` (ADR 0470), but ahead of the primitives this PRD's earlier phases delivered: it drew the section as a hand-rolled bordered `div` with its own padding (not `Panel`'s frame), the table without `flush`, and every chip as a `pill` (no `tag` shape existed yet). `NotesHeader.tsx` drew its own `h2` and flex row rather than `Panel`'s header. `ReviewFilters.tsx` sat above the table on every load, a row of five selects and two switches the mock never draws.

## Decision

1. **`FindingsList`** wraps its section in `panelStyles.ts`'s `PANEL_FRAME_CLASS` (the same frame `Panel` itself draws) instead of a hand-rolled `rounded-lg border` copy, and its body sets `--panel-pad: 0` so `Table flush` spans the full card width, as [ADR 0640](0640-panel-draws-the-mocks-card-header-with-a-divider-and-a-padded-or-flush-body-and-the-eyebrow-and-inset-card-are-primitives.md) intended. The TYPE column's chip takes `shape="tag"` (16 px, radius 3, the mock's badge); RESOLUTION keeps the default `pill` (22 px), since the mock draws Pickup/Edit/Waived as pills, not tags.
2. **`NotesHeader`** draws its title, resolution chips and Import/Export buttons through `PanelHeader` (exported from `Panel.tsx` for exactly this case: a card that is not a `Panel`-rendered `section` of its own). The chips sit in the `subtitle` slot, on the title's line; the buttons are the header's `actions`. The row errors and import/export messages move below the header row, inside the card's own padding, rather than inside the header's fixed-height row.
3. **The filters move behind a control.** The mock's page header draws only the title, the Sources chip and (this app's own addition, kept) the chapter picker and Find pickups; it never draws a filter row. `ReviewFilters` now renders inside a `Popover` (ADR 0047) triggered by an `IconButton` labelled "Filters" (or "Filters (some are hidden)" while a filter narrows the list, so the state is still discoverable without opening it), beside "Find pickups and duplicates…". The trigger is skipped only while the page has no findings at all (`nothingYet`), the same condition that already hid `ReviewFilters` before this phase.

No card, badge or filter primitive changed: every part composed here was already built and measured by an earlier phase of this PRD. This phase is the page wiring those phases' work was for.

## Consequences

- Proof's notes card matches the mock's card frame, divider and flush table, and its chips take the mock's two shapes.
- A narrator filtering the list now opens a popover to do it, rather than seeing five selects and two switches on every visit; `ProofPage.test.tsx` and the two take-review/take-comparison tests open it (`openFilters`) before reading a filter's value, since it renders only while the popover is open.
- Clicking a control inside the notes table (Clear filters) is an outside click and closes the popover, matching `Popover`'s existing behaviour everywhere else it is used (the mic and settings popovers of the read-aloud control bar); a caller that needs the popover open after such a click reopens it, as the "clear filters" test now does.
- The waveform header and the exact row-count in the mock's own sample data are Phase 12's other two items; see [0651](0651-proofs-book-level-draws-no-waveform-header-because-its-notes-span-more-than-one-chapter.md) for the waveform.
- To change the notes card's composition, edit `FindingsList.tsx` or `NotesHeader.tsx` directly (they are Proof's own files, not primitives); to change a primitive this phase used, write an ADR that supersedes the primitive's own.
