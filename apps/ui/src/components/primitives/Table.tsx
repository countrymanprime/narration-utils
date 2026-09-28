import type { CSSProperties, KeyboardEvent, MouseEvent, ReactNode } from 'react';
import { TABLE_CELL_CLASS, TABLE_HEADER_CLASS, TABLE_TEXT_CLASS } from './tableStyles';
import { Tooltip } from './Tooltip';

// A presentational data table (ADR 0056). It replaces the `table.dtable` rules in components.css: the look lives here, in
// tokens, and the parts stay the browser's own table elements (`table`, `thead`, `tbody`, `tr`, `th`, `td`), so the table
// semantics, the column layout and the cell spanning are the platform's. It sorts, filters and selects nothing itself: the
// caller owns the rows and reports what the user did. TanStack Table stays the option if that ever grows. Its sizes and
// type are the mocks' (tableStyles.ts, ADR 0605).

// `label` names the table for a screen reader ("Chapters", "Aliases"). `flush` runs it to the side edges of the Panel it
// sits in, as the mocks draw a table in a card; the cells' own padding keeps the text off the card's border. It spans
// Panel's side padding (1.1rem) until Panel has a flush body (the PRD's Phase 4), which then takes this over.
export function Table({ label, flush = false, className = '', children }: { label: string; flush?: boolean; className?: string; children: ReactNode }) {
  return (
    <table aria-label={label} className={`border-collapse ${TABLE_TEXT_CLASS} ${flush ? '-mx-[1.1rem] w-[calc(100%+2.2rem)]' : 'w-full'} ${className}`}>
      {children}
    </table>
  );
}

// `sticky` keeps the header row on top of a scrolling list, on an opaque background.
export function TableHead({ sticky = false, children }: { sticky?: boolean; children: ReactNode }) {
  return <thead className={sticky ? 'sticky top-0 z-[2] bg-[var(--surface)]' : undefined}>{children}</thead>;
}

export function TableBody({ children }: { children: ReactNode }) {
  return <tbody>{children}</tbody>;
}

// How a row stands out without being selected: `current` is the row the work is on (bold, no fill: mock 01's current
// chapter), `highlight` is a row the page points at (the selected fill, not announced: mock 05's failing file).
const ROW_EMPHASIS = { current: 'font-semibold', highlight: 'bg-[var(--row-selected)]' } as const;

// A row. With `onActivate` it is a control: it takes a tab stop, Enter or Space on the row activates it (a press on a button
// or link inside it does not, by key or by pointer: that control acts on its own), the pointer shows it is pressable, and `selected` marks the
// current one (`aria-selected`) and fills it with `--row-selected`. Without `onActivate` it is a plain row. `data-row` marks a pressable row for the
// visual suite's drivers.
export function TableRow({
  onActivate,
  selected = false,
  emphasis,
  className = '',
  style,
  children,
}: {
  onActivate?: () => void;
  selected?: boolean;
  emphasis?: keyof typeof ROW_EMPHASIS;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const emphasisClass = emphasis ? ROW_EMPHASIS[emphasis] : '';
  if (!onActivate) {
    return (
      <tr className={`${emphasisClass} ${className}`} style={style}>
        {children}
      </tr>
    );
  }
  // A press that lands on a control inside the row (a button, a link) is that control's, not the row's.
  const onClick = (event: MouseEvent<HTMLTableRowElement>) => {
    const control = (event.target as Element).closest('button, a, input, select, textarea');
    if (control && event.currentTarget.contains(control)) return;
    onActivate();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTableRowElement>) => {
    if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return;
    event.preventDefault();
    onActivate();
  };
  return (
    <tr
      data-row=""
      tabIndex={0}
      aria-selected={selected}
      onClick={onClick}
      onKeyDown={onKeyDown}
      className={`cursor-pointer hover:*:bg-[var(--surface-2)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--accent)] ${selected ? 'bg-[var(--row-selected)]' : ''} ${emphasisClass} ${className}`}
      style={style}
    >
      {children}
    </tr>
  );
}

const CELL_ALIGN = { left: 'text-left', right: 'text-right' } as const;

// A column header, muted (4.5:1 or better on the panel and page backgrounds; the faint text token missed it). `align="right"` for a numeric column, and the cells under it say so too. With `onSort` it is a sortable
// column: a button sorts by it and the header announces its state (`aria-sort`, `sorted` says which way, and it is `none` when
// the table is sorted by another column). The arrow beside the label repeats it for the eye; the button is named by the label.
export function TableHeader({
  align = 'left',
  sorted,
  onSort,
  hiddenLabel,
  info,
  className = '',
  style,
  children,
}: {
  align?: keyof typeof CELL_ALIGN;
  sorted?: 'ascending' | 'descending';
  onSort?: () => void;
  // The name of a column with no visible header (a column of buttons), for a screen reader.
  hiddenLabel?: string;
  // Definition text for an "i" icon after the label (a non-obvious column, e.g. what it counts or as of when).
  info?: string;
  className?: string;
  style?: CSSProperties;
  children?: string;
}) {
  const arrow = sorted === 'ascending' ? '↑' : sorted === 'descending' ? '↓' : '';
  return (
    <th
      scope="col"
      aria-sort={onSort ? (sorted ?? 'none') : undefined}
      className={`relative ${TABLE_HEADER_CLASS} ${CELL_ALIGN[align]} ${className}`}
      style={style}
    >
      {onSort ? (
        <button
          type="button"
          aria-label={children}
          onClick={onSort}
          className={`inline-flex items-center gap-1 ${sorted ? 'text-[var(--accent-strong)]' : 'text-inherit'}`}
        >
          {children} {arrow}
        </button>
      ) : children ? (
        <>
          {children}
          {info && <Tooltip text={info} label={`About the ${children} column`} />}
        </>
      ) : (
        <span className="sr-only">{hiddenLabel}</span>
      )}
    </th>
  );
}

// A data cell. Content sits in the middle of the row; `valign="top"` for a cell of several lines beside one-line cells, so
// its first line stays level with theirs. `numeric` is a number, a time or a level: IBM Plex Mono at 13 px, right-aligned
// unless `align="left"` says otherwise (its header takes the same align) and never broken. `muted` is secondary text (the mocks' source column): 12 px in
// `--text-muted`, which meets 4.5:1 where the mocks' `--non-text` would not (ADR 0059).
export function TableCell({
  align,
  valign = 'middle',
  numeric = false,
  muted = false,
  colSpan,
  className = '',
  style,
  children,
}: {
  align?: keyof typeof CELL_ALIGN;
  valign?: 'middle' | 'top';
  numeric?: boolean;
  muted?: boolean;
  colSpan?: number;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}) {
  const right = align === 'right' || (numeric && align !== 'left');
  return (
    <td
      colSpan={colSpan}
      className={`${TABLE_CELL_CLASS} ${valign === 'top' ? 'align-top' : 'align-middle'} ${right ? CELL_ALIGN.right : ''} ${numeric ? "font-['IBM_Plex_Mono',ui-monospace,monospace] text-[0.8125rem] whitespace-nowrap" : ''} ${muted ? 'text-[0.75rem] text-[var(--text-muted)]' : ''} ${className}`}
      style={style}
    >
      {children}
    </td>
  );
}
