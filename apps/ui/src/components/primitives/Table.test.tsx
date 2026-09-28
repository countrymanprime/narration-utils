// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './Table';

afterEach(cleanup);

function renderTable({
  onActivate = () => undefined,
  onSort = () => undefined,
  sorted,
  selected = false,
}: {
  onActivate?: () => void;
  onSort?: () => void;
  sorted?: 'ascending' | 'descending';
  selected?: boolean;
} = {}) {
  render(
    <Table label="Discrepancies">
      <TableHead sticky>
        <TableRow>
          <TableHeader sorted={sorted} onSort={onSort}>
            Script
          </TableHeader>
          <TableHeader align="right">Time</TableHeader>
          <TableHeader hiddenLabel="Actions" />
        </TableRow>
      </TableHead>
      <TableBody>
        <TableRow onActivate={onActivate} selected={selected}>
          <TableCell>wonder</TableCell>
          <TableCell align="right">0:04</TableCell>
          <TableCell>
            <button type="button">Play</button>
          </TableCell>
        </TableRow>
        <TableRow>
          <TableCell colSpan={3}>Plain row</TableCell>
        </TableRow>
      </TableBody>
    </Table>,
  );
}

describe('Table', () => {
  it('is a named table with column headers, rows and cells', () => {
    renderTable();
    expect(screen.getByRole('table', { name: 'Discrepancies' })).toBeTruthy();
    expect(screen.getAllByRole('columnheader')).toHaveLength(3);
    expect(screen.getByRole('columnheader', { name: /^Script/ }).getAttribute('scope')).toBe('col');
    expect(screen.getAllByRole('row')).toHaveLength(3);
    expect(screen.getByRole('cell', { name: 'Plain row' }).getAttribute('colspan')).toBe('3');
  });

  it('announces the sort of a sortable column, and none for a column that is not sorted', () => {
    renderTable({ sorted: 'ascending' });
    expect(screen.getByRole('columnheader', { name: /^Script/ }).getAttribute('aria-sort')).toBe('ascending');
    expect(screen.getByRole('columnheader', { name: 'Time' }).getAttribute('aria-sort')).toBeNull();
    cleanup();
    renderTable({ sorted: 'descending' });
    expect(screen.getByRole('columnheader', { name: /^Script/ }).getAttribute('aria-sort')).toBe('descending');
    cleanup();
    renderTable();
    expect(screen.getByRole('columnheader', { name: /^Script/ }).getAttribute('aria-sort')).toBe('none');
  });

  it('names the sort button by the label alone and draws the direction beside it', async () => {
    const onSort = vi.fn();
    renderTable({ sorted: 'descending', onSort });
    const button = screen.getByRole('button', { name: 'Script' });
    expect(button.textContent).toContain('↓');
    await userEvent.setup().click(button);
    expect(onSort).toHaveBeenCalledTimes(1);
  });

  it('activates a pressable row by click, Enter and Space, and gives it a tab stop', async () => {
    const onActivate = vi.fn();
    const user = userEvent.setup();
    renderTable({ onActivate });
    const row = screen.getByRole('row', { name: /wonder/ });
    expect(row.getAttribute('tabindex')).toBe('0');
    expect(row.hasAttribute('data-row')).toBe(true);
    await user.click(screen.getByRole('cell', { name: 'wonder' }));
    row.focus();
    await user.keyboard('{Enter}');
    await user.keyboard(' ');
    expect(onActivate).toHaveBeenCalledTimes(3);
  });

  it('does not take a key press on a control inside the row as a press on the row', async () => {
    const onActivate = vi.fn();
    const user = userEvent.setup();
    renderTable({ onActivate });
    screen.getByRole('button', { name: 'Play' }).focus();
    await user.keyboard('{Enter}');
    await user.keyboard(' ');
    expect(onActivate).not.toHaveBeenCalled();
  });

  it('does not take a pointer press on a control inside the row, or on something inside that control, as a press on the row', async () => {
    const onActivate = vi.fn();
    const user = userEvent.setup();
    renderTable({ onActivate });
    await user.click(screen.getByRole('button', { name: 'Play' }));
    expect(onActivate).not.toHaveBeenCalled();
    await user.click(screen.getByRole('cell', { name: '0:04' }));
    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  it('names a column with no visible header for a screen reader', () => {
    renderTable();
    expect(screen.getByRole('columnheader', { name: 'Actions' })).toBeTruthy();
  });

  it('marks the selected row and leaves a plain row alone', () => {
    renderTable({ selected: true });
    expect(screen.getByRole('row', { name: /wonder/ }).getAttribute('aria-selected')).toBe('true');
    const plain = screen.getByRole('row', { name: 'Plain row' });
    expect(plain.getAttribute('tabindex')).toBeNull();
    expect(plain.hasAttribute('aria-selected')).toBe(false);
  });

  it('aligns a numeric column to the right in its header and its cells', () => {
    renderTable();
    expect(screen.getByRole('columnheader', { name: 'Time' }).className).toContain('text-right');
    expect(screen.getByRole('cell', { name: '0:04' }).className).toContain('text-right');
    expect(screen.getByRole('columnheader', { name: /^Script/ }).className).toContain('text-left');
  });

  it('is its own containing block, so a hidden label cannot escape it (app-shell-vertical-overflow.prd.md)', () => {
    renderTable();
    expect(screen.getByRole('columnheader', { name: 'Actions' }).className).toContain('relative');
  });
  // The mock fidelity spec (mock-fidelity-primitives-and-components.prd.md Phase 3, measured on benchmark mocks 01 and 05):
  // a 31 px header and 34 px rows, taken from the size tokens, with the label type the mocks draw.
  it('sizes the header row and the body rows from the row tokens', () => {
    renderTable();
    const header = screen.getByRole('columnheader', { name: 'Time' }).className;
    expect(header).toContain('h-[var(--header-row-height)]');
    expect(header).toContain('text-[length:var(--font-size-label)]');
    expect(header).toContain('tracking-[var(--tracking-label)]');
    expect(screen.getByRole('cell', { name: '0:04' }).className).toContain('h-[var(--row-height)]');
  });

  it('sits a cell in the middle of its row, and at the top on request for a multi-line cell', () => {
    render(
      <Table label="Cells">
        <TableBody>
          <TableRow>
            <TableCell>middle</TableCell>
            <TableCell valign="top">top</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    );
    expect(screen.getByRole('cell', { name: 'middle' }).className).toContain('align-middle');
    expect(screen.getByRole('cell', { name: 'top' }).className).toContain('align-top');
    expect(screen.getByRole('cell', { name: 'top' }).className).not.toContain('align-middle');
  });

  it('draws a numeric cell in mono, right-aligned and unbroken, and a muted cell smaller in the muted text colour', () => {
    render(
      <Table label="Cells">
        <TableBody>
          <TableRow>
            <TableCell numeric>12:05</TableCell>
            <TableCell muted>Proofer</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    );
    const numeric = screen.getByRole('cell', { name: '12:05' }).className;
    expect(numeric).toContain('IBM_Plex_Mono');
    expect(numeric).toContain('text-right');
    expect(numeric).toContain('whitespace-nowrap');
    const muted = screen.getByRole('cell', { name: 'Proofer' }).className;
    expect(muted).toContain('text-[var(--text-muted)]');
    expect(muted).toContain('text-[0.75rem]');
  });

  it('fills a selected row with the row-selected token, and draws the current row in bold without a fill', () => {
    render(
      <Table label="Rows">
        <TableBody>
          <TableRow onActivate={() => undefined} selected>
            <TableCell>picked</TableCell>
          </TableRow>
          <TableRow emphasis="current">
            <TableCell>now</TableCell>
          </TableRow>
          <TableRow emphasis="highlight">
            <TableCell>failing</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    );
    expect(screen.getByRole('row', { name: 'picked' }).className).toContain('bg-[var(--row-selected)]');
    const current = screen.getByRole('row', { name: 'now' });
    expect(current.className).toContain('font-semibold');
    expect(current.className).not.toContain('bg-');
    const highlight = screen.getByRole('row', { name: 'failing' });
    expect(highlight.className).toContain('bg-[var(--row-selected)]');
    // A highlight is the look alone: it is not a selection a screen reader should hear.
    expect(highlight.hasAttribute('aria-selected')).toBe(false);
  });

  it('sets the body text at 14 px, and a flush table reaches the edges of the panel it sits in', () => {
    render(
      <>
        <Table label="Inset">
          <TableBody>
            <TableRow>
              <TableCell>a</TableCell>
            </TableRow>
          </TableBody>
        </Table>
        <Table label="Flush" flush>
          <TableBody>
            <TableRow>
              <TableCell>b</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </>,
    );
    const inset = screen.getByRole('table', { name: 'Inset' }).className;
    expect(inset).toContain('text-[0.875rem]');
    expect(inset).not.toContain('-mx-');
    expect(screen.getByRole('table', { name: 'Flush' }).className).toContain('-mx-[1.1rem]');
  });
});
