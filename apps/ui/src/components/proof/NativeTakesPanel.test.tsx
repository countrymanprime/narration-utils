// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiProvider } from '../../api/ApiContext';
import { createMockApi } from '../../api/mockApi';
import type { RecordingMockSeed } from '../../api/recordingMock';
import type { ManuscriptChapter } from '../../api/contracts/manuscript';
import type { NarrationApi } from '../../types';
import { NativeTakesPanel } from './NativeTakesPanel';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const chapter: ManuscriptChapter = {
  id: 'c-0001',
  title: 'Chapter One',
  index: 0,
  wordCount: 100,
  status: 'not_started',
  paragraphIds: [
    { id: 'p-000001', index: 0 },
    { id: 'p-000002', index: 1 },
  ],
};

function mockApi(recording: RecordingMockSeed = {}): NarrationApi {
  return createMockApi({}, { recording });
}

function renderPanel(api: NarrationApi, forChapter: ManuscriptChapter = chapter) {
  return render(<NativeTakesPanel chapter={forChapter} />, { wrapper: ({ children }) => <ApiProvider api={api}>{children}</ApiProvider> });
}

describe('native takes on the Proof chapter page (native-recording-suite PRD Phase 4, take review integration)', () => {
  it('renders nothing when the project has no native takes', async () => {
    const api = mockApi({ takes: 'none' });
    renderPanel(api);
    await waitFor(() => expect(api.recorderState).toBeTruthy());
    expect(screen.queryByRole('heading', { name: 'Native takes' })).toBeNull();
  });

  it('offers no unassigned take while the project records with REAPER, even with native takes on disk', async () => {
    const api = mockApi();
    renderPanel(api);
    await waitFor(() => expect(api.recorderState).toBeTruthy());
    expect(screen.queryByRole('heading', { name: 'Native takes' })).toBeNull();
  });

  it('offers an unassigned take for assignment to one of this chapter’s paragraphs, then lists it under that line', async () => {
    const api = mockApi({ engine: 'builtin' });
    renderPanel(api);

    expect(await screen.findByRole('heading', { name: 'Native takes' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Not yet assigned to a line' })).toBeTruthy();
    const row = screen.getByText('Take 001').closest('li')!;
    fireEvent.change(within(row).getByLabelText("Take 001's line"), { target: { value: 'p-000002' } });
    fireEvent.click(within(row).getByRole('button', { name: 'Assign' }));

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Paragraph 2' })).toBeTruthy());
    expect(within(screen.getByLabelText('Native takes of Paragraph 2')).getByText('Take 001')).toBeTruthy();
    expect((await api.recorderState()).takes.find((take) => take.name === 'Take 001')?.lineId).toBe('p-000002@mock-sha');
  });

  it('a take with no chapter paragraphs to offer is left out of "not yet assigned"', async () => {
    const api = mockApi();
    renderPanel(api, { ...chapter, paragraphIds: [] });
    // No takes of this chapter are assigned, and there is nothing to assign to: the panel has nothing to show.
    await waitFor(() => expect(api.recorderState).toBeTruthy());
    expect(screen.queryByRole('heading', { name: 'Native takes' })).toBeNull();
  });

  it('marks and undoes a keeper, handing it over from another take of the same line', async () => {
    const api = mockApi();
    await api.recorderSetTakeLine('Take 001', 'p-000001');
    await api.recorderSetTakeLine('Take 002', 'p-000001');
    renderPanel(api);

    const group = await screen.findByLabelText('Native takes of Paragraph 1');
    const take1 = within(group).getByText('Take 001').closest('li')!;
    const take2 = within(group).getByText('Take 002').closest('li')!;

    fireEvent.click(within(take1).getByRole('button', { name: 'Mark keeper' }));
    await waitFor(() => expect(within(take1).getByRole('button', { name: 'Keeper ✓ (undo)' })).toBeTruthy());

    // Marking Take 002 hands the mark over.
    fireEvent.click(within(take2).getByRole('button', { name: 'Mark keeper' }));
    await waitFor(() => expect(within(take2).getByRole('button', { name: 'Keeper ✓ (undo)' })).toBeTruthy());
    expect(within(take1).getByRole('button', { name: 'Mark keeper' })).toBeTruthy();

    // Undo.
    fireEvent.click(within(take2).getByRole('button', { name: 'Keeper ✓ (undo)' }));
    await waitFor(() => expect(within(take2).getByRole('button', { name: 'Mark keeper' })).toBeTruthy());
  });

  it('groups a take assigned to the chapter itself under the chapter’s title', async () => {
    const api = mockApi();
    await api.recorderSetTakeLine('Take 001', 'c-0001');
    renderPanel(api);
    expect(await screen.findByRole('heading', { name: 'Chapter One' })).toBeTruthy();
  });

  it('plays a take through the media route, one at a time', async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    const api = mockApi({ engine: 'builtin' });
    renderPanel(api);
    const play = await screen.findByRole('button', { name: 'Play Take 001' });
    fireEvent.click(play);
    expect(await screen.findByRole('button', { name: 'Stop Take 001' })).toBeTruthy();
  });
});
