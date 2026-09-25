// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChapterSyncPreview } from '../../api/contracts/chapterSync';
import { ChapterSyncConsentDialog } from './ChapterSyncConsentDialog';

afterEach(cleanup);

const preview: ChapterSyncPreview = {
  project: 'ready',
  message: '',
  projectFile: 'Alice.rpp',
  savedAt: '2026-09-24T09:00:00Z',
  kept: [],
  autoLink: [
    { trackGuid: 'g1', trackName: 'CHAPTER ONE', chapterId: 'c1', chapterTitle: 'Chapter 1', match: { score: 1, kind: 'exact' } },
    { trackGuid: 'g3', trackName: 'Ch 3', chapterId: 'c3', chapterTitle: 'Chapter 3', match: { score: 1, kind: 'contained' } },
  ],
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
  noTrack: [
    { chapterId: 'c11', chapterTitle: 'Chapter 11' },
    { chapterId: 'c12', chapterTitle: 'Chapter 12' },
  ],
  unmatched: [{ guid: 'g10', name: 'Room tone', index: 10, marker: '' }],
  pickupTracks: [],
  new: [],
  changed: [],
  renamed: [],
  missing: [],
};

describe('ChapterSyncConsentDialog', () => {
  it('shows a loading state before the preview arrives', () => {
    render(<ChapterSyncConsentDialog projectFile="Alice.rpp" preview={undefined} busy={false} onSync={() => {}} onNotNow={() => {}} />);
    expect(screen.getByText('Reading the saved project…')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sync chapters' })).toHaveProperty('disabled', true);
  });

  it('lists what will be linked, needs you and no-track chapters, and names the count on Sync', () => {
    render(<ChapterSyncConsentDialog projectFile="Alice.rpp" preview={preview} busy={false} onSync={() => {}} onNotNow={() => {}} />);
    expect(screen.getByText(/Alice\.rpp is now linked/)).toBeTruthy();
    expect(screen.getByText('CHAPTER ONE → Chapter 1')).toBeTruthy();
    expect(screen.getByText('Ch 3 → Chapter 3')).toBeTruthy();
    expect(screen.getByText(/“Chapter 5 part 1” and “Chapter 5 part 2” both look like it\./)).toBeTruthy();
    expect(screen.getByText('Chapter 11, Chapter 12')).toBeTruthy();
    expect(screen.getByText('Room tone')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sync 2 chapters' })).toBeTruthy();
  });

  it('calls onSync and onNotNow from their buttons', () => {
    const onSync = vi.fn();
    const onNotNow = vi.fn();
    render(<ChapterSyncConsentDialog projectFile="Alice.rpp" preview={preview} busy={false} onSync={onSync} onNotNow={onNotNow} />);
    fireEvent.click(screen.getByRole('button', { name: 'Sync 2 chapters' }));
    expect(onSync).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(onNotNow).toHaveBeenCalledOnce();
  });

  it('disables Not now while busy and refuses to close', () => {
    const onNotNow = vi.fn();
    render(<ChapterSyncConsentDialog projectFile="Alice.rpp" preview={preview} busy={true} onSync={() => {}} onNotNow={onNotNow} />);
    expect(screen.getByRole('button', { name: 'Not now' })).toHaveProperty('disabled', true);
  });
});
