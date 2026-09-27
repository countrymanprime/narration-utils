// @vitest-environment jsdom
// The pronunciation queries panel (prep-depth P3): the host's list in reading order, a filter, Export CSV as a download, and Mark sent /
// Mark answered, after which the list is loaded again and an answered row is gone.
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiProvider } from '../../api/ApiContext';
import { createMockApi } from '../../api/mockApi';
import type { PronunciationQuery } from '../../types';
import { PronunciationQueries } from './PronunciationQueries';

afterEach(() => cleanup());

const query = (fields: Partial<PronunciationQuery>): PronunciationQuery => ({
  entityId: 'entity-wren',
  aliasIndex: null,
  name: 'Wren',
  entry: 'Wren',
  category: 'Character',
  ipa: 'wɹɛn',
  source: 'user',
  status: 'researched',
  note: '',
  chapter: 'Chapter 1',
  excerpt: '…met Wren…',
  ...fields,
});

const ROWS = [
  query({}),
  query({ aliasIndex: 0, name: 'the Sparrow', status: 'query_sent', note: 'Asked by email.', source: 'CMU dictionary', chapter: '', excerpt: '' }),
];

function csvFile(text: string): File {
  return new File([text], 'answers.csv', { type: 'text/csv' });
}

function renderPanel(rows = ROWS) {
  const api = createMockApi();
  let current = rows;
  const list = vi.spyOn(api, 'guidePronunciationQueries').mockImplementation(async () => current);
  const setStatus = vi.spyOn(api, 'guidePronunciationSetStatus').mockImplementation(async (id, status, _note, aliasIndex) => {
    if (status === 'author_confirmed') current = current.filter((row) => !(row.entityId === id && (row.aliasIndex ?? undefined) === aliasIndex));
  });
  const csv = vi.spyOn(api, 'guidePronunciationQueriesCsv').mockResolvedValue({ csv: 'word\nWren\n', count: 1 });
  const importCsv = vi.spyOn(api, 'guidePronunciationImportQueriesCsv').mockImplementation(async () => {
    current = current.filter((row) => row.entityId !== 'entity-wren' || row.aliasIndex !== null);
    return { applied: 1, issues: [] };
  });
  const notify = vi.fn();
  const onChanged = vi.fn();
  render(
    <ApiProvider api={api}>
      <PronunciationQueries open onClose={vi.fn()} onChanged={onChanged} notify={notify} />
    </ApiProvider>,
  );
  return { list, setStatus, csv, importCsv, notify, onChanged };
}

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:queries');
  URL.revokeObjectURL = vi.fn();
});

describe('the pronunciation queries panel', () => {
  it('lists each query with its status, pronunciation, where it is first used and its note', async () => {
    renderPanel();
    const list = await screen.findByRole('list', { name: 'Pronunciation queries' });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(within(items[0]).getByText('Researched')).toBeTruthy();
    expect(within(items[0]).getByText(/Yours/)).toBeTruthy();
    expect(within(items[0]).getByText('Chapter 1: …met Wren…')).toBeTruthy();
    expect(within(items[1]).getByText('alias of Wren')).toBeTruthy();
    expect(within(items[1]).getByText('Query sent')).toBeTruthy();
    expect(within(items[1]).getByText('Not found in the manuscript.')).toBeTruthy();
    expect(within(items[1]).getByText('Asked by email.')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('2 open · 1 sent');
  });

  it('filters by status', async () => {
    const user = userEvent.setup();
    renderPanel();
    await screen.findByRole('list', { name: 'Pronunciation queries' });
    await user.selectOptions(screen.getByRole('combobox', { name: 'Show queries' }), 'query_sent');
    expect(within(screen.getByRole('list', { name: 'Pronunciation queries' })).getAllByRole('listitem')).toHaveLength(1);
  });

  it('offers Mark sent only on a researched row, and marks it', async () => {
    const user = userEvent.setup();
    const { setStatus, onChanged } = renderPanel();
    await screen.findByRole('list', { name: 'Pronunciation queries' });
    expect(screen.queryByRole('button', { name: 'Mark the Sparrow as sent' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Mark Wren as sent' }));
    await waitFor(() => expect(setStatus).toHaveBeenCalledWith('entity-wren', 'query_sent', undefined, undefined));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it('marks an alias answered by its index, and the row leaves the list', async () => {
    const user = userEvent.setup();
    const { setStatus } = renderPanel();
    await screen.findByRole('list', { name: 'Pronunciation queries' });
    await user.click(screen.getByRole('button', { name: 'Mark the Sparrow as answered' }));
    await waitFor(() => expect(setStatus).toHaveBeenCalledWith('entity-wren', 'author_confirmed', undefined, 0));
    await waitFor(() => expect(screen.queryByText('the Sparrow')).toBeNull());
  });

  it('exports the CSV as a download and says how many rows', async () => {
    const user = userEvent.setup();
    const { csv, notify } = renderPanel();
    await screen.findByRole('list', { name: 'Pronunciation queries' });
    await user.click(screen.getByRole('button', { name: 'Export CSV' }));
    await waitFor(() => expect(csv).toHaveBeenCalled());
    expect(URL.createObjectURL).toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith('1 query exported.');
  });

  it('imports an answered file, applies a row, reloads the list and says how many were used', async () => {
    const user = userEvent.setup();
    const { importCsv, notify, onChanged } = renderPanel();
    await screen.findByRole('list', { name: 'Pronunciation queries' });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, csvFile('word,entry_id,status\nWren,entity-wren,author_confirmed\n'));
    await waitFor(() => expect(importCsv).toHaveBeenCalledWith('word,entry_id,status\nWren,entity-wren,author_confirmed\n'));
    expect(notify).toHaveBeenCalledWith('1 query applied.');
    await waitFor(() => expect(screen.queryByText('Wren')).toBeNull());
    expect(onChanged).toHaveBeenCalled();
  });

  it('lists a row the import could not use', async () => {
    const user = userEvent.setup();
    const api = createMockApi();
    vi.spyOn(api, 'guidePronunciationQueries').mockResolvedValue(ROWS);
    vi.spyOn(api, 'guidePronunciationImportQueriesCsv').mockResolvedValue({ applied: 0, issues: ['line 2: "Ghost" is no longer in the Story Bible'] });
    render(
      <ApiProvider api={api}>
        <PronunciationQueries open onClose={vi.fn()} onChanged={vi.fn()} notify={vi.fn()} />
      </ApiProvider>,
    );
    await screen.findByRole('list', { name: 'Pronunciation queries' });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, csvFile('word,entry_id\nGhost,gone\n'));
    expect(await screen.findByText('line 2: "Ghost" is no longer in the Story Bible')).toBeTruthy();
  });

  it('says there is nothing to ask when every pronunciation is confirmed, and Export is off', async () => {
    renderPanel([]);
    expect(await screen.findByText('Every pronunciation is confirmed by the author. Nothing to ask.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Export CSV' }).hasAttribute('disabled')).toBe(true);
  });
});
