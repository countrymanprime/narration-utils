import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, fn, userEvent, within } from 'storybook/test';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './Table';

const ROWS = [
  { id: 'alice', name: 'Alice', occurrences: 54 },
  { id: 'hatter', name: 'Mad Hatter', occurrences: 28 },
  { id: 'queen', name: 'Queen of Hearts', occurrences: 19 },
];

type SortKey = 'name' | 'occurrences';

function EntryTable({ onSelect }: { onSelect: (id: string) => void }) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'name', dir: 'asc' });
  const [selectedId, setSelectedId] = useState<string>();
  const rows = [...ROWS].sort((a, b) => {
    const order = sort.key === 'name' ? a.name.localeCompare(b.name) : a.occurrences - b.occurrences;
    return sort.dir === 'asc' ? order : -order;
  });
  const toggle = (key: SortKey) => setSort((current) => (current.key === key ? { key, dir: current.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));
  const state = (key: SortKey) => (sort.key !== key ? undefined : sort.dir === 'asc' ? ('ascending' as const) : ('descending' as const));
  return (
    <div className="max-w-md">
      <Table label="Story Bible entries">
        <TableHead>
          <TableRow>
            <TableHeader sorted={state('name')} onSort={() => toggle('name')}>
              Name
            </TableHeader>
            <TableHeader align="right" sorted={state('occurrences')} onSort={() => toggle('occurrences')}>
              Occurrences
            </TableHeader>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row) => (
            <TableRow
              key={row.id}
              selected={selectedId === row.id}
              onActivate={() => {
                setSelectedId(row.id);
                onSelect(row.id);
              }}
            >
              <TableCell>{row.name}</TableCell>
              <TableCell align="right" className="font-['IBM_Plex_Mono',ui-monospace,monospace]">
                {row.occurrences}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

const meta = {
  title: 'Primitives/Table',
  component: Table,
  args: { label: 'Story Bible entries', children: null },
  render: () => <EntryTable onSelect={fn()} />,
} satisfies Meta<typeof Table>;

export default meta;
type Story = StoryObj<typeof meta>;

export const SortableRows: Story = {};

export const Plain: Story = {
  render: () => (
    <div className="max-w-md">
      <Table label="Chapters">
        <TableHead>
          <TableRow>
            <TableHeader>Chapter</TableHeader>
            <TableHeader align="right">Words</TableHeader>
            <TableHeader hiddenLabel="Status" />
          </TableRow>
        </TableHead>
        <TableBody>
          <TableRow>
            <TableCell>Chapter 1</TableCell>
            <TableCell align="right">2,140</TableCell>
            <TableCell>ok</TableCell>
          </TableRow>
          <TableRow>
            <TableCell colSpan={3} className="text-[var(--text-muted)]">
              No more chapters.
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
  ),
};

// The table has a name, its headers are column headers, and the sorted column announces its direction while the other
// sortable one says none.
export const AnnouncesTheSort: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('table', { name: 'Story Bible entries' })).toBeVisible();
    await expect(canvas.getByRole('columnheader', { name: /^Name/ })).toHaveAttribute('aria-sort', 'ascending');
    await expect(canvas.getByRole('columnheader', { name: /^Occurrences/ })).toHaveAttribute('aria-sort', 'none');
    await userEvent.click(canvas.getByRole('button', { name: 'Occurrences' }));
    await expect(canvas.getByRole('columnheader', { name: /^Occurrences/ })).toHaveAttribute('aria-sort', 'ascending');
    await expect(canvas.getByRole('columnheader', { name: /^Name/ })).toHaveAttribute('aria-sort', 'none');
    await userEvent.click(canvas.getByRole('button', { name: 'Occurrences' }));
    await expect(canvas.getByRole('columnheader', { name: /^Occurrences/ })).toHaveAttribute('aria-sort', 'descending');
  },
};

// A pressable row is reached by Tab and activated by Enter or Space, and the activated one is marked selected.
export const RowsActivateFromTheKeyboard: Story = {
  render: () => <EntryTable onSelect={fn()} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const [first, second] = canvas.getAllByRole('row').slice(1);
    await expect(first).toHaveAttribute('aria-selected', 'false');
    first.focus();
    await expect(first).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    await expect(first).toHaveAttribute('aria-selected', 'true');
    await userEvent.tab();
    await expect(second).toHaveFocus();
    await userEvent.keyboard(' ');
    await expect(second).toHaveAttribute('aria-selected', 'true');
    await expect(first).toHaveAttribute('aria-selected', 'false');
  },
};
