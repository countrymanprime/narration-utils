import type { CSSProperties, KeyboardEvent, MouseEvent, ReactNode } from 'react';
import { Tooltip } from './Tooltip';

// A presentational data table (ADR 0056). It replaces the `table.dtable` rules in components.css: the look lives here, in
// tokens, and the parts stay the browser's own table elements (`table`, `thead`, `tbody`, `tr`, `th`, `td`), so the table
// semantics, the column layout and the cell spanning are the platform's. It sorts, filters and selects nothing itself: the
// caller owns the rows and reports what the user did. TanStack Table stays the option if that ever grows.

// `label` names the table for a screen reader ("Chapters", "Aliases").
export function Table({ label, className = '', children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <table aria-label={label} className={`w-full border-collapse text-[0.86rem] ${className}`}>
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

// A row. With `onActivate` it is a control: it takes a tab stop, Enter or Space on the row activates it (a press on a button
// or link inside it does not, by key or by pointer: that control acts on its own), the pointer shows it is pressable, and `selected` marks the
// current one (`aria-selected`) and tints it. Without `onActivate` it is a plain row. `data-row` marks a pressable row for the
// visual suite's drivers.
export function TableRow({
  onActivate,
  selected = false,
  className = '',
  style,
  children,
}: {
  onActivate?: () => void;
  selected?: boolean;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  if (!onActivate) {
    return (
      <tr className={className} style={style}>
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
      className={`cursor-pointer hover:*:bg-[var(--surface-2)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--accent)] ${selected ? 'bg-[var(--surface-2)]' : ''} ${className}`}
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
      className={`border-b border-[var(--border)] px-[0.7rem] py-2 font-['Barlow_Condensed',sans-serif] text-[0.72rem] font-semibold tracking-[0.05em] text-[var(--text-muted)] uppercase ${CELL_ALIGN[align]} ${className}`}
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

// A data cell. Content sits at the top of the cell.
export function TableCell({
  align = 'left',
  colSpan,
  className = '',
  style,
  children,
}: {
  align?: keyof typeof CELL_ALIGN;
  colSpan?: number;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}) {
  return (
    <td
      colSpan={colSpan}
      className={`border-b border-[var(--border)] px-[0.7rem] py-[0.55rem] align-top ${align === 'right' ? CELL_ALIGN.right : ''} ${className}`}
      style={style}
    >
      {children}
    </td>
  );
}
