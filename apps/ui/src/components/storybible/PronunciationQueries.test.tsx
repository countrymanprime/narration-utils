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
  const batch = vi.spyOn(api, 'pronunciationOnlineLookupBatch');
  void api.pronunciationOnlineKeySet('0b5c1a3e-7d2f-4e6a-9c8b-2f1e0d9c8b7a');
  const notify = vi.fn();
  const onChanged = vi.fn();
  render(
    <ApiProvider api={api}>
      <PronunciationQueries open onClose={vi.fn()} onChanged={onChanged} notify={notify} />
    </ApiProvider>,
  );
  return { list, setStatus, csv, batch, importCsv, notify, onChanged };
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

// Q11 (prep-depth P9): a batch online lookup is opt-in with a notice naming how many names it sends, once per batch.
describe('looking every query up online', () => {
  const rows = [
    query({}),
    query({ entityId: 'e2', name: 'wren' }),
    query({ entityId: 'e3', name: 'Alice' }),
    query({ entityId: 'e4', name: 'a very long name here' }),
  ];

  it('asks once, naming the count, and sends nothing when declined', async () => {
    const { batch } = renderPanel(rows);
    await userEvent.click(await screen.findByRole('button', { name: 'Look up online…' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Look up 2 names online?' });
    expect(within(dialog).getByText(/sent each of these 2 names on its own/)).toBeTruthy();
    expect(within(dialog).getByText(/1 name is longer than three words or has symbols/)).toBeTruthy();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(batch).not.toHaveBeenCalled();
  });

  it('sends the distinct names with the confirmed count, and reports what happened', async () => {
    const { batch, notify } = renderPanel(rows);
    await userEvent.click(await screen.findByRole('button', { name: 'Look up online…' }));
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Look up 2' }));
    await waitFor(() => expect(batch).toHaveBeenCalledTimes(1));
    expect(batch).toHaveBeenCalledWith(['Wren', 'Alice'], 2);
    await waitFor(() =>
      expect(notify).toHaveBeenCalledWith(expect.stringMatching(/^Merriam-Webster: 2 looked up, 0 already on this computer, 0 not in the dictionary/)),
    );
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
});
