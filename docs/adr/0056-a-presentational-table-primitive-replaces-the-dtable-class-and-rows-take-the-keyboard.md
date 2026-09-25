# 0056. A presentational Table primitive replaces the dtable class, and pressable rows take the keyboard

- **Status:** Accepted
- **Date:** 2026-09-20
- **Deciders:** the owner
- **Related:** Supersedes the `table.dtable` exception of [ADR-0009](0009-complete-tailwind-migration.md) (the rest of ADR 0009 stands)

## Context and problem

Five tables (the audiobook estimate's chapter breakdown, the Proofing discrepancies, the Story Bible list, and the alias and relationship tables of an entry) shared one look through `table.dtable` rules in `components.css`, the one place [ADR 0009](0009-complete-tailwind-migration.md) kept a component class on purpose, saying that a future `Table` primitive would supersede exactly that part. They also shared three defects: a clickable row (`<tr onClick>`, `data-row`) was not reachable or operable by keyboard; a sortable column header was a bare button with the direction drawn as an arrow in its text and nothing announced (`aria-sort` was absent); and no table had a name. A fourth was hidden by the CSS: the rule `table.dtable th { text-align: left }` outranks the utilities, so the `text-right` on a numeric column's header never applied, and the header of every numeric column stood left of its numbers, against the design-system convention that a numeric column is right-aligned on both the header and the cells. The owner decided (the primitives PRD's L8) to build a presentational `Table` now, with row keyboard activation and `aria-sort`, and TanStack Table later if sorting, filtering and selection needs multiply.

## Decision drivers

- A clickable row was not reachable or operable by keyboard, a sortable header announced nothing, and no table had a name.
- The `table.dtable` header rule outranked the utilities, so numeric headers were never right-aligned, against the design-system convention.
- ADR 0009 said a future `Table` primitive would supersede exactly its `dtable` exception.

## Considered options

1. A presentational `Table` primitive with row keyboard activation and `aria-sort`
2. Keep the status quo: the `table.dtable` component class
3. TanStack Table

## Decision outcome

**Chosen option: a presentational `Table` primitive with row keyboard activation and `aria-sort`**, because the owner decided to build a presentational `Table` now, which fixes the defects the five tables shared in one place, and to take TanStack Table later only if sorting, filtering and selection needs multiply.

`Table` (`Table.tsx`, with `TableHead`, `TableBody`, `TableRow`, `TableHeader`, `TableCell`) is the one place the table look lives, in tokens, and the parts stay the browser's own `table`, `thead`, `tbody`, `tr`, `th` and `td`, so the column layout, spanning and table semantics are the platform's. It sorts, filters and selects nothing: the caller owns the rows and the state and the primitive reports what the user did.

- `Table` needs a `label` (its accessible name). `TableHead` is `sticky` on request (an opaque header over a scrolling list).
- `TableRow` with `onActivate` is a control: a tab stop, Enter or Space on the row activates it, a press on a button or link inside it (by key or pointer) does not (that control acts on its own), the pointer shows it is pressable, `selected` marks it (`aria-selected`) and tints it, and it keeps the `data-row` attribute the visual drivers select by. Without `onActivate` it is a plain row.
- `TableHeader` is a `th scope="col"`; `align="right"` for a numeric column; with `onSort` it holds a button named by the label, announces `aria-sort` (`ascending`, `descending`, or `none` when another column is sorted) and draws the direction as an arrow beside the label. `TableCell` is top-aligned, takes `align="right"` and `colSpan`.
- The `table.dtable` rules are deleted from `components.css`, and the five tables use the primitive. `rawNatives.test.ts` now allows no native `table`, `thead`, `tbody`, `tr`, `th` or `td` outside the primitives ([ADR 0053](0053-icon-buttons-text-fields-and-selects-wrap-the-native-controls.md)).
- The alias combobox in `GuideDetail.tsx` stays bespoke, as [ADR 0052](0052-toggle-menu-checkbox-collapsible-and-switch-replace-the-hand-rolled-widgets.md) decided; the primitives PRD's `Combobox` is not built. Its input is a `TextField` and its listbox is domain code (matching, an active index, the merge and review actions), which a Base UI Combobox does not replace cleanly.
- The other rules of ADR 0009 stand (the scrollbar-hiding and category-colour rules, the keyframes, the marker classes).

### Consequences

- **Good:** A clickable row and a sortable header are operable and announced, and every table is named. A screen reader reads a Story Bible row as selected when it is the open entry.
- **Neutral:** Header rows change in three ways, and nothing else does. Numeric column headers are right-aligned over their numbers (the convention in `design-system.md`), where before they sat left of them. Header text is `--text-muted`, not `--text-faint`, because faint reached 2.77:1 and the atlas's axe check failed the new stories (the debt list is at its cap and may only shrink). The sorted header is `--accent-strong`: its `text-[var(--accent)]` had always lost to a `text-inherit` beside it, so the arrow was the only cue, and `--accent` on the page background reaches only 3.98:1. 48 of 282 captures differ (16 states at three viewports: the Home chapter table, the Proofing results states and every Story Bible state that shows a table), all inside header rows; every cell and row is pixel-identical to before, because cells that asked for `align-middle` had always been top-aligned (the same specificity fight) and stay top-aligned.
- **Neutral:** A column with no visible header (a column of buttons) takes a `hiddenLabel` for a screen reader, which the atlas's `empty-table-header` rule asks for.
- **Neutral:** A sort button's name is the label alone (`aria-label`); the arrow is drawn beside it. A table wanting sort state per column must pass it: the primitive keeps none.
- **Neutral:** `components.css` loses 25 more lines, and the last class ADR 0009 kept for tables is gone. TanStack Table is the next step if a table needs more than one sort key, filtering or multi-selection.
- **Neutral:** To change any of this (grid roles, a data table on TanStack Table), write a new ADR that supersedes this one.

### Confirmation

`rawNatives.test.ts` allows no native `table`, `thead`, `tbody`, `tr`, `th` or `td` outside the primitives.

## Pros and cons of the options

### TanStack Table

- Good, because it covers a table that needs more than one sort key, filtering or multi-selection.
