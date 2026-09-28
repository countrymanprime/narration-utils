import { useRef, useState, type KeyboardEvent } from 'react';
import { StatusBadge, type StatusTone } from './StatusBadge';
import { TABLE_CELL_CLASS, TABLE_HEADER_CLASS, TABLE_TEXT_CLASS } from './tableStyles';

// A figure cell: Table's `numeric` type (IBM Plex Mono at 13 px, never broken).
const TEXT_CELL_CLASS = "font-['IBM_Plex_Mono',ui-monospace,monospace] text-[0.8125rem] whitespace-nowrap";

/** One cell. `look: 'text'` draws the label as a mono figure rather than a badge: mock 01's FIN. column, a length. */
export type StageGridCell = { tone: StatusTone; label: string; look?: 'badge' | 'text'; onActivate?: () => void };

// Mock 01's columns (ADR 0645), measured at 1440 px: the row names 244 px, a figure column 112 px, and a badge column its
// 58 px cell and 4 px either side (the 66 px pitch), its header starting where the cells do. The columns sit at these widths
// from the left and the last takes whatever the card has spare, so a wide card lines its cells up as the mock does and a
// narrow one scrolls.
const STAGE_PAD = 'px-1';
const WIDTH_REM = { rowHeader: 15.25, text: 7, badge: 4.125 };

// A chapter x stage production grid (studio-ui-primitives.prd.md Phase 8, mock 01): rows are chapters, columns are
// stages, every cell a `StatusBadge`. Follows the WAI-ARIA grid pattern: one tab stop (roving tabindex, on the last
// focused cell), arrow keys move focus cell to cell, Home/End move to the current row's ends, Ctrl+Home/End to the
// grid's corners, Enter or Space activates the focused cell. `rows` and `columns` name the row and column headers
// (the browser's own `scope`), so a screen reader hears "<chapter>, <stage>, <status>" without this primitive
// writing that name itself. Its header and rows are Table's (tableStyles.ts, ADR 0605); `currentRow` draws the chapter the
// work is on in bold, as mock 01 does. Mock 01 names the row-header column (`rowHeader`, "Chapter"), draws each cell as the
// board-cell badge and a length as a mono figure (ADR 0645).
export function StageGrid({
  label,
  rows,
  columns,
  cell,
  currentRow,
  rowHeader = 'Chapter',
  className = '',
}: {
  label: string;
  /** The row-header column's heading. */
  rowHeader?: string;
  rows: string[];
  columns: string[];
  cell: (row: number, col: number) => StageGridCell;
  currentRow?: number;
  className?: string;
}) {
  const [active, setActive] = useState({ row: 0, col: 0 });
  const cellRefs = useRef<(HTMLTableCellElement | null)[][]>([]);
  const lastRow = rows.length - 1;
  const lastCol = columns.length - 1;

  const focusCell = (row: number, col: number) => {
    setActive({ row, col });
    cellRefs.current[row]?.[col]?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTableCellElement>, row: number, col: number) => {
    switch (event.key) {
      case 'ArrowRight':
        if (col < lastCol) {
          event.preventDefault();
          focusCell(row, col + 1);
        }
        return;
      case 'ArrowLeft':
        if (col > 0) {
          event.preventDefault();
          focusCell(row, col - 1);
        }
        return;
      case 'ArrowDown':
        if (row < lastRow) {
          event.preventDefault();
          focusCell(row + 1, col);
        }
        return;
      case 'ArrowUp':
        if (row > 0) {
          event.preventDefault();
          focusCell(row - 1, col);
        }
        return;
      case 'Home':
        event.preventDefault();
        focusCell(event.ctrlKey ? 0 : row, 0);
        return;
      case 'End':
        event.preventDefault();
        focusCell(event.ctrlKey ? lastRow : row, lastCol);
        return;
      case 'Enter':
      case ' ':
        event.preventDefault();
        cell(row, col).onActivate?.();
        return;
    }
  };

  const onCellClick = (row: number, col: number) => {
    focusCell(row, col);
    cell(row, col).onActivate?.();
  };

  // A column's look is its first row's (a length column is text all the way down).
  const looks = columns.map((_, col) => (rows.length === 0 ? 'badge' : (cell(0, col).look ?? 'badge')));
  const widths = looks.map((look) => (look === 'text' ? WIDTH_REM.text : WIDTH_REM.badge));
  const minWidth = WIDTH_REM.rowHeader + widths.reduce((sum, width) => sum + width, 0);
  const pad = (col: number) => (looks[col] === 'text' ? '' : STAGE_PAD);

  return (
    <table
      role="grid"
      aria-label={label}
      className={`w-full table-fixed border-collapse ${TABLE_TEXT_CLASS} ${className}`}
      style={{ minWidth: `${minWidth}rem` }}
    >
      <colgroup>
        <col style={{ width: `${WIDTH_REM.rowHeader}rem` }} />
        {widths.map((width, col) => (
          <col key={col} style={col === lastCol ? undefined : { width: `${width}rem` }} />
        ))}
      </colgroup>
      <thead>
        <tr role="row">
          <th role="columnheader" scope="col" className={`${TABLE_HEADER_CLASS} text-left`}>
            {rowHeader}
          </th>
          {columns.map((column, col) => (
            <th key={column} role="columnheader" scope="col" className={`${TABLE_HEADER_CLASS} text-left ${pad(col)}`}>
              {column}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((rowLabel, row) => (
          <tr role="row" key={rowLabel} className={row === currentRow ? 'font-semibold' : undefined}>
            <th
              role="rowheader"
              scope="row"
              title={rowLabel}
              className={`${TABLE_CELL_CLASS} truncate text-left align-middle ${row === currentRow ? 'font-semibold' : 'font-normal'}`}
            >
              {rowLabel}
            </th>
            {columns.map((_, col) => {
              const { tone, label: cellLabel, look = 'badge', onActivate } = cell(row, col);
              const isActive = active.row === row && active.col === col;
              return (
                <td
                  key={col}
                  role="gridcell"
                  ref={(el) => {
                    if (!cellRefs.current[row]) cellRefs.current[row] = [];
                    cellRefs.current[row][col] = el;
                  }}
                  tabIndex={isActive ? 0 : -1}
                  onKeyDown={(event) => onKeyDown(event, row, col)}
                  onClick={() => onCellClick(row, col)}
                  onFocus={() => setActive({ row, col })}
                  className={`${TABLE_CELL_CLASS} align-middle focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--accent)] ${pad(col)} whitespace-nowrap ${onActivate ? 'cursor-pointer hover:bg-[var(--surface-2)]' : ''}`}
                >
                  {look === 'text' ? <span className={TEXT_CELL_CLASS}>{cellLabel}</span> : <StatusBadge tone={tone} label={cellLabel} shape="cell" />}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
