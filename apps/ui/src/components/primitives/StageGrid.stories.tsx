import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { StageGrid, type StageGridCell } from './StageGrid';
import type { StatusTone } from './StatusBadge';

// Shaped like the production home concept mock (studio-ui-primitives.prd.md mock 01): chapters down, stages across,
// every cell a `StatusBadge` reached by grid keyboard navigation rather than one tab stop per cell. Chapter 2 is the current
// row, drawn in bold as the mock draws the chapter the work is on.
const CHAPTERS = ['Chapter 1', 'Chapter 2', 'Chapter 3', 'Chapter 4'];
const STAGES = ['Prep', 'Record', 'Edit', 'Proof', 'QC'];

const BOARD: Record<string, StageGridCell> = {
  'Chapter 1:Prep': { tone: 'success', label: 'PASS' },
  'Chapter 1:Record': { tone: 'success', label: 'PASS' },
  'Chapter 1:Edit': { tone: 'success', label: 'PASS' },
  'Chapter 1:Proof': { tone: 'success', label: 'PASS' },
  'Chapter 1:QC': { tone: 'success', label: 'PASS' },
  'Chapter 2:Prep': { tone: 'success', label: 'PASS' },
  'Chapter 2:Record': { tone: 'success', label: 'PASS' },
  'Chapter 2:Edit': { tone: 'progress', label: '41%' },
  'Chapter 2:Proof': { tone: 'neutral', label: 'Not started' },
  'Chapter 2:QC': { tone: 'neutral', label: 'Not started' },
  'Chapter 3:Prep': { tone: 'success', label: 'PASS' },
  'Chapter 3:Record': { tone: 'warning', label: '3 open' },
  'Chapter 3:Edit': { tone: 'neutral', label: 'Not started' },
  'Chapter 3:Proof': { tone: 'neutral', label: 'Not started' },
  'Chapter 3:QC': { tone: 'neutral', label: 'Not started' },
  'Chapter 4:Prep': { tone: 'danger', label: 'FLOOR' },
  'Chapter 4:Record': { tone: 'neutral', label: 'Not started' },
  'Chapter 4:Edit': { tone: 'neutral', label: 'Not started' },
  'Chapter 4:Proof': { tone: 'neutral', label: 'Not started' },
  'Chapter 4:QC': { tone: 'neutral', label: 'Not started' },
};

function ProductionBoard() {
  const onActivate = fn();
  const cell = (row: number, col: number): StageGridCell => {
    const found = BOARD[`${CHAPTERS[row]}:${STAGES[col]}`] ?? { tone: 'neutral' as StatusTone, label: 'Not started' };
    return { ...found, onActivate: () => onActivate(CHAPTERS[row], STAGES[col]) };
  };
  return <StageGrid label="Production board" rows={CHAPTERS} columns={STAGES} cell={cell} currentRow={1} />;
}

const meta = {
  title: 'Primitives/StageGrid',
  component: StageGrid,
  args: { label: 'Production board', rows: CHAPTERS, columns: STAGES, cell: () => ({ tone: 'neutral', label: 'Not started' }) },
  render: () => <ProductionBoard />,
} satisfies Meta<typeof StageGrid>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ProductionHome: Story = {};

export const Small: Story = {
  render: () => (
    <StageGrid
      label="Production board"
      rows={['Chapter 1', 'Chapter 2']}
      columns={['Prep', 'Record']}
      cell={(row, col) => ({ tone: 'progress', label: `${row}-${col}`, onActivate: fn() })}
    />
  ),
};

// One tab stop, moved by the arrow keys, Home/End to the row's ends and Ctrl+Home/End to the grid's corners, WAI-ARIA
// grid pattern (studio-ui-primitives.prd.md Phase 8).
export const KeyboardNavigation: Story = {
  render: () => <ProductionBoard />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const grid = canvas.getByRole('grid', { name: 'Production board' });
    const cells = within(grid).getAllByRole('gridcell');

    await expect(cells[0]).toHaveAttribute('tabindex', '0');
    await expect(cells.filter((cellEl) => cellEl.getAttribute('tabindex') === '0')).toHaveLength(1);

    await userEvent.tab();
    await expect(document.activeElement).toBe(cells[0]);

    await userEvent.keyboard('{ArrowDown}{ArrowRight}{ArrowRight}');
    await expect(document.activeElement).toHaveTextContent('41%');

    await userEvent.keyboard('{ArrowDown}');
    await expect(document.activeElement).toHaveTextContent('Not started');

    await userEvent.keyboard('{Home}');
    await expect(document.activeElement).toHaveTextContent('PASS');

    await userEvent.keyboard('{Control>}{End}{/Control}');
    await expect(document.activeElement).toHaveTextContent('Not started');

    await userEvent.keyboard('{Control>}{Home}{/Control}');
    await expect(document.activeElement).toBe(cells[0]);

    await userEvent.keyboard('{Enter}');
    // Only one cell may hold the tab stop after every move.
    await expect(
      within(grid)
        .getAllByRole('gridcell')
        .filter((cellEl) => cellEl.getAttribute('tabindex') === '0'),
    ).toHaveLength(1);
  },
};

export const NamesRowsAndColumns: Story = {
  render: () => <ProductionBoard />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const grid = canvas.getByRole('grid', { name: 'Production board' });
    await expect(
      within(grid)
        .getAllByRole('columnheader')
        .map((header) => header.textContent),
    ).toEqual(['Chapter', ...STAGES]);
    await expect(
      within(grid)
        .getAllByRole('rowheader')
        .map((header) => header.textContent),
    ).toEqual(CHAPTERS);
  },
};

// The header and rows are Table's, measured on mock 01 (mock-fidelity-primitives-and-components.prd.md Phase 3): a 31 px
// header row and 34 px body rows.
export const RowsMatchTheMock: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('rowheader', { name: 'Chapter 2' }).className).toContain('font-semibold');
    await expect(canvas.getByRole('rowheader', { name: 'Chapter 1' }).className).toContain('font-normal');
    // The sizes need layout: the atlas's browser has it, the stories' jsdom run (stories.test.tsx) lays nothing out.
    if (canvasElement.getBoundingClientRect().width === 0) return;
    // Measured once the web fonts are in: a fallback face sets different line boxes.
    await document.fonts.ready;
    const [header, first] = canvas.getAllByRole('row');
    await expect(Math.round(header.getBoundingClientRect().height)).toBe(31);
    await expect(Math.round(first.getBoundingClientRect().height)).toBe(34);
    await expect(getComputedStyle(canvas.getByRole('rowheader', { name: 'Chapter 2' })).fontWeight).toBe('600');
    await expect(getComputedStyle(canvas.getByRole('rowheader', { name: 'Chapter 1' })).fontWeight).toBe('400');
  },
};
