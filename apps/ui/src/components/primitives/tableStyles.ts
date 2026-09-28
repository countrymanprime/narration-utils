// The look Table and StageGrid share (mock-fidelity-primitives-and-components.prd.md Phase 3, ADR 0605), measured on
// benchmark mocks 01 and 05: a 31 px header row and 34 px body rows (the size tokens, rule and divider included), the
// label type over the columns, 10 px side padding and content in the middle of the row. A cell's `height` is the row's
// least height in a table, so a cell holding two lines, or a pill, still grows its row.

// A column header: Barlow Condensed at the label size and tracking, muted, no fill.
export const TABLE_HEADER_CLASS =
  "h-[var(--header-row-height)] border-b border-[var(--border)] px-2.5 py-0 align-middle font-['Barlow_Condensed',sans-serif] text-[length:var(--font-size-label)] font-semibold tracking-[var(--tracking-label)] text-[var(--text-muted)] uppercase";

// A body cell (a `td`, or a row's `th`). The row token sets the height; the 5 px above and below keep a 22 px status
// pill (StageGrid's cells) inside it too, where 6 px made a pill row 35 px.
export const TABLE_CELL_CLASS = 'h-[var(--row-height)] border-b border-[var(--border)] px-2.5 py-[0.3125rem]';

// The body text: IBM Plex Sans (the page's own face) at 14 px.
export const TABLE_TEXT_CLASS = 'text-[0.875rem]';
