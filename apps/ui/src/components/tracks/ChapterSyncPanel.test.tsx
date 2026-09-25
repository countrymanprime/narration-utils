// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChapterSyncPreview } from '../../api/contracts/chapterSync';
import { ApiProvider } from '../../api/ApiContext';
import { createMockApi } from '../../api/mockApi';
import { ChapterSyncPanel } from './ChapterSyncPanel';

afterEach(cleanup);

// The default fixture's tracks (Chapter 1, Chapter 2, Click Track) never land in Needs you, so the Needs-you tests
// below override chapterSyncPreview directly to construct the ambiguous case the mockup depicts (chapterTrackSet is
// stubbed too, since 'g5a' names no real track in the fixture's tracks list).
const needsYouPreview = (): ChapterSyncPreview => ({
  project: 'ready',
  message: '',
  projectFile: 'Alice.rpp',
  savedAt: '2026-09-24T09:00:00Z',
  kept: [],
  autoLink: [],
  needsYou: [
    {
      chapterId: 'c5',
      chapterTitle: 'Chapter 5',
      reason: 'ambiguous',
      best: null,
      candidates: [
        { trackGuid: 'g5a', trackName: 'Chapter 5 part 1', trackIndex: 0, score: 1, source: 'track-name', region: null },
        { trackGuid: 'g5b', trackName: 'Chapter 5 part 2', trackIndex: 1, score: 1, source: 'track-name', region: null },
      ],
    },
  ],
  noTrack: [],
  unmatched: [],
  pickupTracks: [],
  new: [],
  changed: [],
  renamed: [],
  missing: [],
});

describe('ChapterSyncPanel', () => {
  it('renders nothing before consent is decided', async () => {
    const api = createMockApi({}, { chapterSync: 'ask' });
    const { container } = render(<ApiProvider api={api}>{<ChapterSyncPanel notify={() => {}} onChanged={() => {}} />}</ApiProvider>);
    await waitFor(() => expect(container.textContent).toBe(''));
  });

  it('offers Turn on when sync is off, and calls chapterSyncSetEnabled(true)', async () => {
    const api = createMockApi({}, { chapterSync: 'off' });
    const onChanged = vi.fn();
    render(<ApiProvider api={api}>{<ChapterSyncPanel notify={() => {}} onChanged={onChanged} />}</ApiProvider>);
    await screen.findByText('Chapter sync is off.');
    fireEvent.click(screen.getByRole('button', { name: 'Turn on' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    await screen.findByText(/On · last synced/);
  });

  it('shows the on summary and calls Turn off', async () => {
    const api = createMockApi({}, {});
    const onChanged = vi.fn();
    render(<ApiProvider api={api}>{<ChapterSyncPanel notify={() => {}} onChanged={onChanged} />}</ApiProvider>);
    await screen.findByText(/On · last synced/);
    fireEvent.click(screen.getByRole('button', { name: 'Turn off' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    await screen.findByText('Chapter sync is off.');
  });

  it('shows a Needs-you list with the reason and a preselected candidate, and Link calls chapterTrackSet', async () => {
    const chapterTrackSet = vi.fn().mockResolvedValue({ documentId: 'doc', link: {}, displaced: null, mappings: [] });
    const api = createMockApi({ chapterSyncPreview: async () => needsYouPreview(), chapterTrackSet }, {});
    const notify = vi.fn();
    render(<ApiProvider api={api}>{<ChapterSyncPanel notify={notify} onChanged={() => {}} />}</ApiProvider>);
    await screen.findByText('Needs you (1)');
    expect(screen.getByText(/“Chapter 5 part 1” and “Chapter 5 part 2” both look like it\./)).toBeTruthy();
    const select = screen.getByLabelText('Track for Chapter 5') as HTMLSelectElement;
    expect(select.value).toBe('g5a');
    fireEvent.click(screen.getByRole('button', { name: 'Link' }));
    await waitFor(() => expect(chapterTrackSet).toHaveBeenCalledWith('c5', 'g5a'));
    await waitFor(() => expect(notify).toHaveBeenCalledWith('Track linked.'));
  });
});
