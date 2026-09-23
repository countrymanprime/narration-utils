// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { ChapterLinksTable } from './ChapterLinksTable';
import { ApiProvider } from '../../api/ApiContext';
import { createMockApi } from '../../api/mockApi';
import { WIRE_CHAPTERS, WIRE_TRACKS_PROJECT } from '../../api/mockFixtures';

afterEach(cleanup);

function renderTable() {
  const api = createMockApi();
  render(
    <ApiProvider api={api}>
      <ChapterLinksTable tracks={WIRE_TRACKS_PROJECT.tracks} />
    </ApiProvider>,
  );
  return api;
}

// A chapter's row, found by its first cell (the chapter title), not a bare text match: several track names in the
// fixture happen to equal chapter titles ("Chapter 1", "Chapter 2"), so `getByText` alone would match more than one
// element once a track name appears in the row too.
function chapterRow(table: HTMLElement, title: string): HTMLTableRowElement {
  const row = within(table)
    .getAllByRole('row')
    .find((candidate) => within(candidate).queryByRole('cell', { name: title }));
  if (!row) throw new Error(`No row found for chapter "${title}"`);
  return row as HTMLTableRowElement;
}

describe('ChapterLinksTable', () => {
  it('lists every narration chapter as not linked when nothing is confirmed', async () => {
    renderTable();

    const table = await screen.findByRole('table', { name: 'Chapter links' });
    const firstRow = chapterRow(table, WIRE_CHAPTERS[0].title);
    expect(within(firstRow).getByText('Not linked')).toBeTruthy();
  });

  it('confirms a link, then shows it as Linked with the track name', async () => {
    const user = userEvent.setup();
    renderTable();
    const table = await screen.findByRole('table', { name: 'Chapter links' });
    const firstRow = chapterRow(table, WIRE_CHAPTERS[0].title);

    await user.selectOptions(within(firstRow).getByRole('combobox'), WIRE_TRACKS_PROJECT.tracks[0].guid);
    await user.click(within(firstRow).getByRole('button', { name: 'Confirm' }));

    await waitFor(() => expect(within(firstRow).getByText('Linked')).toBeTruthy());
    expect(within(firstRow).getAllByText(WIRE_TRACKS_PROJECT.tracks[0].name).length).toBeGreaterThan(0);
  });

  it('clears a confirmed link back to Not linked', async () => {
    const user = userEvent.setup();
    renderTable();
    const table = await screen.findByRole('table', { name: 'Chapter links' });
    const firstRow = chapterRow(table, WIRE_CHAPTERS[0].title);
    await user.selectOptions(within(firstRow).getByRole('combobox'), WIRE_TRACKS_PROJECT.tracks[0].guid);
    await user.click(within(firstRow).getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(within(firstRow).getByText('Linked')).toBeTruthy());

    await user.click(within(firstRow).getByRole('button', { name: 'Clear' }));

    await waitFor(() => expect(within(firstRow).getByText('Not linked')).toBeTruthy());
  });

  it('shows a link to a track that no longer exists as Track missing', async () => {
    const api = createMockApi();
    await api.chapterTrackMapConfirm('{NOT-A-REAL-TRACK-GUID}', WIRE_CHAPTERS[0].id);
    render(
      <ApiProvider api={api}>
        <ChapterLinksTable tracks={WIRE_TRACKS_PROJECT.tracks} />
      </ApiProvider>,
    );

    const table = await screen.findByRole('table', { name: 'Chapter links' });
    const firstRow = chapterRow(table, WIRE_CHAPTERS[0].title);
    await waitFor(() => expect(within(firstRow).getByText('Track missing')).toBeTruthy());
    expect(within(firstRow).getByText('Linked track is missing from this project')).toBeTruthy();
  });
});
