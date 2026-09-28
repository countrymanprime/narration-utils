import { useRef, useState, type KeyboardEvent } from 'react';
import { StatusBadge, type StatusTone } from './StatusBadge';
import { TABLE_CELL_CLASS, TABLE_HEADER_CLASS, TABLE_TEXT_CLASS } from './tableStyles';

export type StageGridCell = { tone: StatusTone; label: string; onActivate?: () => void };

// A chapter x stage production grid (studio-ui-primitives.prd.md Phase 8, mock 01): rows are chapters, columns are
// stages, every cell a `StatusBadge`. Follows the WAI-ARIA grid pattern: one tab stop (roving tabindex, on the last
// focused cell), arrow keys move focus cell to cell, Home/End move to the current row's ends, Ctrl+Home/End to the
// grid's corners, Enter or Space activates the focused cell. `rows` and `columns` name the row and column headers
// (the browser's own `scope`), so a screen reader hears "<chapter>, <stage>, <status>" without this primitive
// writing that name itself. Its header and rows are Table's (tableStyles.ts, ADR 0605); `currentRow` draws the chapter the
// work is on in bold, as mock 01 does.
export function StageGrid({
  label,
  rows,
  columns,
  cell,
  currentRow,
  className = '',
}: {
  label: string;
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

  return (
    <table role="grid" aria-label={label} className={`border-collapse ${TABLE_TEXT_CLASS} ${className}`}>
      <thead>
        <tr role="row">
          <th role="columnheader" scope="col" className={TABLE_HEADER_CLASS}>
            <span className="sr-only">Chapter</span>
          </th>
          {columns.map((column) => (
            <th key={column} role="columnheader" scope="col" className={TABLE_HEADER_CLASS}>
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
              className={`${TABLE_CELL_CLASS} text-left align-middle whitespace-nowrap ${row === currentRow ? 'font-semibold' : 'font-normal'}`}
            >
              {rowLabel}
            </th>
            {columns.map((_, col) => {
              const { tone, label: cellLabel, onActivate } = cell(row, col);
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
                  className={`${TABLE_CELL_CLASS} align-middle focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--accent)] ${onActivate ? 'cursor-pointer hover:bg-[var(--surface-2)]' : ''}`}
                >
                  <StatusBadge tone={tone} label={cellLabel} />
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
