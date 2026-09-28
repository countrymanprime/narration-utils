// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChapterSyncPreview } from '../../api/contracts/chapterSync';
import { ApiProvider } from '../../api/ApiContext';
import { createMockApi } from '../../api/mockApi';
import { WIRE_TRACKS_PROJECT } from '../../api/mockFixtures';
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
    // The panel's own wording (mockup 02, D85 #13), not the consent dialog's.
    expect(screen.getByText('Two tracks match: “Chapter 5 part 1” and “Chapter 5 part 2”. A chapter is checked from one track.')).toBeTruthy();
    const select = screen.getByLabelText('Track for Chapter 5') as HTMLSelectElement;
    expect(select.value).toBe('g5a');
    fireEvent.click(screen.getByRole('button', { name: 'Link' }));
    await waitFor(() => expect(chapterTrackSet).toHaveBeenCalledWith('c5', 'g5a'));
    await waitFor(() => expect(notify).toHaveBeenCalledWith('Track linked.'));
  });

  it('names the saved file and splits automatic links from the narrator’s in the summary (mockup 02)', async () => {
    render(<ApiProvider api={createMockApi({}, { chapterSync: 'activity' })}>{<ChapterSyncPanel notify={() => {}} onChanged={() => {}} />}</ApiProvider>);
    await screen.findByText(/^On · last synced .+ from the saved Alice\.rpp · 1 chapter linked automatically, 1 by you$/);
  });

  it('lists the Sync activity, newest first, with Undo on a link sync made that still stands', async () => {
    const api = createMockApi({}, { chapterSync: 'activity' });
    const undo = vi.spyOn(api, 'chapterSyncUndo');
    const notify = vi.fn();
    const onChanged = vi.fn();
    render(<ApiProvider api={api}>{<ChapterSyncPanel notify={notify} onChanged={onChanged} />}</ApiProvider>);
    const heading = await screen.findByRole('heading', { name: 'Sync activity' });
    const lines = Array.from(heading.parentElement!.querySelectorAll('li')).map((item) => item.textContent);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatch(/ · Linked “Chapter 1” to .+ \(Undo\)$/);
    expect(lines[1]).toMatch(/ · New track “Room tone”, not a chapter$/);
    expect(lines[2]).toMatch(/ · First sync: 1 chapter linked$/);
    fireEvent.click(screen.getByRole('button', { name: /^Undo: Linked “Chapter 1”/ }));
    await waitFor(() => expect(undo).toHaveBeenCalledWith(WIRE_TRACKS_PROJECT.tracks[0].guid));
    await waitFor(() => expect(notify).toHaveBeenCalledWith('Link undone. Sync will not make it again.'));
    expect(onChanged).toHaveBeenCalled();
    // The link is gone, so its line no longer offers Undo.
    await waitFor(() => expect(screen.queryByRole('button', { name: /^Undo:/ })).toBeNull());
  });

  it('counts the tracks that are not chapters and says when REAPER holds unsaved changes', async () => {
    const preview = { ...needsYouPreview(), needsYou: [], unmatched: [{ guid: 'g1', name: 'Room tone', index: 5, marker: '' as const }] };
    render(
      <ApiProvider api={createMockApi({ chapterSyncPreview: async () => preview }, { chapterSync: 'unsaved' })}>
        {<ChapterSyncPanel notify={() => {}} onChanged={() => {}} />}
      </ApiProvider>,
    );
    await screen.findByText('Tracks that are not chapters (1)');
    expect(screen.getByText('Room tone')).toBeTruthy();
    expect(screen.getByText(/REAPER has changes that aren’t saved yet/)).toBeTruthy();
  });

  it('says why background checks wait, when they are on and something is blocking them (daw-chapter-track-auto-sync.prd.md Phase 7)', async () => {
    const base = await createMockApi({}, {}).chapterSyncState();
    const api = createMockApi({ chapterSyncState: async () => ({ ...base, background: { enabled: true, wait: 'recording' } }) }, {});
    render(<ApiProvider api={api}>{<ChapterSyncPanel notify={() => {}} onChanged={() => {}} />}</ApiProvider>);
    await screen.findByText(/REAPER is recording/);
  });

  it('says nothing about background checks when there is nothing to wait on', async () => {
    render(<ApiProvider api={createMockApi({}, {})}>{<ChapterSyncPanel notify={() => {}} onChanged={() => {}} />}</ApiProvider>);
    await screen.findByText(/On · last synced/);
    expect(screen.queryByText(/Background checks/)).toBeNull();
  });
});
