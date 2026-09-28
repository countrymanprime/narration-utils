import { describe, expect, it } from 'vitest';
import type { ChapterSyncBatch } from '../../api/contracts/chapterSync';
import { chapterSyncBatchToastText } from './chapterSyncToastText';

const batch = (linked: ChapterSyncBatch['linked']): ChapterSyncBatch => ({ at: '2026-09-25T10:00:00Z', trigger: 'daw-link', linked, newTracks: [] });

describe('chapterSyncBatchToastText', () => {
  it('names the track and the chapter for one link', () => {
    const text = chapterSyncBatchToastText(
      batch([{ trackGuid: 'g1', chapterId: 'c11', chapterTitle: 'Chapter 11', confirmedAt: '2026-09-25T10:00:00Z', origin: 'auto' }]),
      (guid) => (guid === 'g1' ? 'Ch. 11' : undefined),
    );
    expect(text).toBe('Linked track “Ch. 11” to Chapter 11.');
  });

  it('falls back to the chapter alone when the track name cannot be resolved', () => {
    const text = chapterSyncBatchToastText(
      batch([{ trackGuid: 'g1', chapterId: 'c11', chapterTitle: 'Chapter 11', confirmedAt: '2026-09-25T10:00:00Z', origin: 'auto' }]),
      () => undefined,
    );
    expect(text).toBe('Linked a track to Chapter 11.');
  });

  it('counts the tracks when a batch links more than one', () => {
    const text = chapterSyncBatchToastText(
      batch([
        { trackGuid: 'g1', chapterId: 'c1', chapterTitle: 'Chapter 1', confirmedAt: '2026-09-25T10:00:00Z', origin: 'auto' },
        { trackGuid: 'g2', chapterId: 'c2', chapterTitle: 'Chapter 2', confirmedAt: '2026-09-25T10:00:00Z', origin: 'auto' },
      ]),
      () => undefined,
    );
    expect(text).toBe('Linked 2 tracks to chapters.');
  });
});
