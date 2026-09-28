// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StageGrid, type StageGridCell } from './StageGrid';

afterEach(cleanup);

const ROWS = ['Chapter 1', 'Chapter 2', 'Chapter 3'];
const COLUMNS = ['Prep', 'Record', 'Edit'];

function grid(onActivate: (row: number, col: number) => void = () => undefined) {
  const cell = (row: number, col: number): StageGridCell => ({
    tone: 'progress',
    label: `${ROWS[row]} ${COLUMNS[col]}`,
    onActivate: () => onActivate(row, col),
  });
  return <StageGrid label="Production board" rows={ROWS} columns={COLUMNS} cell={cell} />;
}

function focusedCell() {
  return document.activeElement as HTMLElement;
}

describe('StageGrid', () => {
  it('is a named grid with row and column headers, and every cell a StatusBadge', () => {
    render(grid());
    const table = screen.getByRole('grid', { name: 'Production board' });
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((header) => header.textContent),
    ).toEqual(['Chapter', 'Prep', 'Record', 'Edit']);
    expect(
      within(table)
        .getAllByRole('rowheader')
        .map((header) => header.textContent),
    ).toEqual(ROWS);
    expect(within(table).getAllByRole('gridcell')).toHaveLength(ROWS.length * COLUMNS.length);
    expect(within(table).getByText('Chapter 1 Prep')).toBeTruthy();
  });

  it('starts with one tab stop: only the first cell is in the tab order', () => {
    render(grid());
    const cells = screen.getAllByRole('gridcell');
    expect(cells.map((cellEl) => cellEl.getAttribute('tabindex'))).toEqual(['0', '-1', '-1', '-1', '-1', '-1', '-1', '-1', '-1']);
  });

  it('moves focus cell to cell with the arrow keys, keeping one tab stop', async () => {
    const user = userEvent.setup();
    render(grid());
    await user.tab();
    expect(focusedCell().textContent).toBe('Chapter 1 Prep');

    await user.keyboard('{ArrowRight}');
    expect(focusedCell().textContent).toBe('Chapter 1 Record');

    await user.keyboard('{ArrowDown}');
    expect(focusedCell().textContent).toBe('Chapter 2 Record');

    await user.keyboard('{ArrowLeft}');
    expect(focusedCell().textContent).toBe('Chapter 2 Prep');

    await user.keyboard('{ArrowUp}');
    expect(focusedCell().textContent).toBe('Chapter 1 Prep');

    const cells = screen.getAllByRole('gridcell');
    expect(cells.filter((cellEl) => cellEl.getAttribute('tabindex') === '0')).toHaveLength(1);
  });

  it('does not move past the grid edges', async () => {
    const user = userEvent.setup();
    render(grid());
    await user.tab();
    await user.keyboard('{ArrowUp}{ArrowLeft}');
    expect(focusedCell().textContent).toBe('Chapter 1 Prep');

    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowRight}{ArrowRight}{ArrowDown}{ArrowRight}');
    expect(focusedCell().textContent).toBe('Chapter 3 Edit');
  });

  it('Home and End move to the current row bounds', async () => {
    const user = userEvent.setup();
    render(grid());
    await user.tab();
    await user.keyboard('{ArrowDown}{ArrowRight}');
    expect(focusedCell().textContent).toBe('Chapter 2 Record');

    await user.keyboard('{End}');
    expect(focusedCell().textContent).toBe('Chapter 2 Edit');

    await user.keyboard('{Home}');
    expect(focusedCell().textContent).toBe('Chapter 2 Prep');
  });

  it('Ctrl+Home and Ctrl+End move to the grid corners', async () => {
    const user = userEvent.setup();
    render(grid());
    await user.tab();
    await user.keyboard('{ArrowDown}{ArrowRight}');

    await user.keyboard('{Control>}{End}{/Control}');
    expect(focusedCell().textContent).toBe('Chapter 3 Edit');

    await user.keyboard('{Control>}{Home}{/Control}');
    expect(focusedCell().textContent).toBe('Chapter 1 Prep');
  });

  it('activates the focused cell with Enter or Space, and only that cell', async () => {
    const onActivate = vi.fn();
    const user = userEvent.setup();
    render(grid(onActivate));
    await user.tab();
    await user.keyboard('{ArrowRight}{Enter}');
    expect(onActivate).toHaveBeenCalledWith(0, 1);
    expect(onActivate).toHaveBeenCalledTimes(1);

    await user.keyboard('{ArrowDown}{ }');
    expect(onActivate).toHaveBeenLastCalledWith(1, 1);
    expect(onActivate).toHaveBeenCalledTimes(2);
  });

  it('activates a cell by click and moves the roving tab stop to it', async () => {
    const onActivate = vi.fn();
    const user = userEvent.setup();
    render(grid(onActivate));
    await user.click(screen.getByText('Chapter 3 Edit'));
    expect(onActivate).toHaveBeenCalledWith(2, 2);
    expect(document.activeElement?.textContent).toBe('Chapter 3 Edit');
    expect(screen.getByText('Chapter 3 Edit').closest('[role="gridcell"]')?.getAttribute('tabindex')).toBe('0');
  });

  it('does not throw when a cell has no onActivate', async () => {
    const user = userEvent.setup();
    render(<StageGrid label="Production board" rows={ROWS} columns={COLUMNS} cell={() => ({ tone: 'neutral', label: 'Not started' })} />);
    await user.tab();
    await expect(user.keyboard('{Enter}')).resolves.not.toThrow();
  });
  // It shares Table's header and row look (mock-fidelity-primitives-and-components.prd.md Phase 3).
  it('sizes its header and rows from the row tokens, as Table does, with the cells in the middle of the row', () => {
    render(grid());
    const header = screen.getByRole('columnheader', { name: 'Prep' }).className;
    expect(header).toContain('h-[var(--header-row-height)]');
    expect(header).toContain('tracking-[var(--tracking-label)]');
    const rowHeader = screen.getByRole('rowheader', { name: 'Chapter 1' }).className;
    expect(rowHeader).toContain('h-[var(--row-height)]');
    const cell = screen.getAllByRole('gridcell')[0].className;
    expect(cell).toContain('h-[var(--row-height)]');
    expect(cell).toContain('align-middle');
  });

  it('draws the current row in bold, and only that row', () => {
    const cell = (row: number, col: number): StageGridCell => ({ tone: 'progress', label: `${ROWS[row]} ${COLUMNS[col]}` });
    render(<StageGrid label="Production board" rows={ROWS} columns={COLUMNS} cell={cell} currentRow={1} />);
    expect(screen.getAllByRole('row')[2].className).toContain('font-semibold');
    expect(screen.getAllByRole('row')[1].className).not.toContain('font-semibold');
  });
});
