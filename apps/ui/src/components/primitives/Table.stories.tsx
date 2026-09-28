import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, fn, userEvent, within } from 'storybook/test';
import { Panel } from './Panel';
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
              <TableCell numeric>{row.occurrences}</TableCell>
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
            <TableCell valign="top">Chapter 2</TableCell>
            <TableCell numeric valign="top">
              3,412
            </TableCell>
            <TableCell valign="top">
              Two queries open: &ldquo;Tulgey&rdquo; and &ldquo;Mome raths&rdquo;, sent to the author on Sep 22 and not answered yet.
            </TableCell>
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

// Shaped like mock 05's per-file checks (mock-fidelity-primitives-and-components.prd.md Phase 3): flush to the card's
// edges, a 31 px header and 34 px rows, the numbers in mono, a muted secondary column, the failing file highlighted, the
// chapter the work is on in bold, and a note spanning the measure columns of a file that is not measured yet.
const FILES = [
  { name: '00 Opening credits', length: '0:12', rms: '−20.1', peak: '−3.4', source: 'Rendered', verdict: 'PASS' },
  { name: '01 Down the Rabbit-Hole', length: '11:48', rms: '−19.6', peak: '−3.2', source: 'Rendered', verdict: 'PASS' },
  { name: '04 The Rabbit Sends…', length: '13:10', rms: '−20.4', peak: '−3.6', source: 'Proofer', verdict: 'FAIL' },
  { name: '05 Advice from a Caterpillar', length: '12:40', rms: '−19.9', peak: '−3.1', source: 'Rendered', verdict: 'PASS' },
];

function PerFileChecks() {
  // A narrow window scrolls the card sideways, as the pages' wide tables do, so the header stays one line.
  return (
    <div tabIndex={0} role="region" aria-label="Per-file checks, scrolls sideways" className="max-w-2xl overflow-x-auto">
      <div className="min-w-[40rem]">
        <Panel title="Per-file checks" subtitle="measured on the rendered files · true peak (EBU R128)" flush>
          <Table label="Per-file checks" flush>
            <TableHead>
              <TableRow>
                <TableHeader>File</TableHeader>
                <TableHeader align="right">Length</TableHeader>
                <TableHeader align="right">RMS</TableHeader>
                <TableHeader align="right">True peak</TableHeader>
                <TableHeader>Source</TableHeader>
                <TableHeader align="right">Result</TableHeader>
              </TableRow>
            </TableHead>
            <TableBody>
              {FILES.map((file) => (
                <TableRow key={file.name} emphasis={file.verdict === 'FAIL' ? 'highlight' : file.name.startsWith('05') ? 'current' : undefined}>
                  <TableCell className="whitespace-nowrap">{file.name}</TableCell>
                  <TableCell numeric>{file.length}</TableCell>
                  <TableCell numeric>{file.rms}</TableCell>
                  <TableCell numeric>{file.peak}</TableCell>
                  <TableCell muted>{file.source}</TableCell>
                  <TableCell align="right" className={file.verdict === 'FAIL' ? 'font-semibold text-[var(--danger-text)]' : 'text-[var(--ok-text)]'}>
                    {file.verdict}
                  </TableCell>
                </TableRow>
              ))}
              <TableRow>
                <TableCell>Retail sample</TableCell>
                <TableCell numeric>4:40</TableCell>
                <TableCell colSpan={4} muted>
                  Waiting on 3 pickups — not mastered
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </Panel>
      </div>
    </div>
  );
}

export const InACard: Story = {
  render: () => <PerFileChecks />,
};

// The sizes are the mock's: a 31 px header row, 34 px rows, 14 px body text and 13 px mono numbers; the table runs to the
// card's border; the highlighted row is filled and the current one is bold.
export const MatchesTheMock: Story = {
  render: () => <PerFileChecks />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const table = canvas.getByRole('table', { name: 'Per-file checks' });
    const failing = canvas.getByRole('row', { name: /04 The Rabbit Sends/ });
    // A highlight is the look alone: a screen reader does not hear it as selected.
    await expect(failing).not.toHaveAttribute('aria-selected');
    // The sizes need layout: the atlas's browser has it, the stories' jsdom run (stories.test.tsx) lays nothing out.
    if (canvasElement.getBoundingClientRect().width === 0) return;
    // Measured once the web fonts are in: a fallback face sets different line boxes.
    await document.fonts.ready;
    const [header, first] = within(table).getAllByRole('row');
    await expect(Math.round(header.getBoundingClientRect().height)).toBe(31);
    await expect(Math.round(first.getBoundingClientRect().height)).toBe(34);
    await expect(getComputedStyle(canvas.getByRole('cell', { name: '00 Opening credits' })).fontSize).toBe('14px');
    const length = canvas.getByRole('cell', { name: '11:48' });
    await expect(getComputedStyle(length).fontSize).toBe('13px');
    await expect(getComputedStyle(length).textAlign).toBe('right');
    const card = canvasElement.querySelector('section') as HTMLElement;
    await expect(Math.round(table.getBoundingClientRect().left)).toBe(Math.round(card.getBoundingClientRect().left + 1));
    await expect(Math.round(table.getBoundingClientRect().right)).toBe(Math.round(card.getBoundingClientRect().right - 1));
    await expect(getComputedStyle(failing).backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
    await expect(getComputedStyle(canvas.getByRole('row', { name: /05 Advice/ })).fontWeight).toBe('600');
  },
};
