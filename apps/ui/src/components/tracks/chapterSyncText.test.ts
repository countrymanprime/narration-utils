import { describe, expect, it } from 'vitest';
import type { ChapterSyncNeedsYou, ChapterSyncPickupTrack, ChapterSyncTrackRef } from '../../api/contracts/chapterSync';
import { chapterSyncNotChaptersText, chapterSyncReasonText } from './chapterSyncText';

const candidate = (trackGuid: string, trackName: string) => ({ trackGuid, trackName, trackIndex: 0, score: 1, source: 'track-name' as const, region: null });

describe('chapterSyncReasonText', () => {
  it('names both candidates for an ambiguous tie', () => {
    const item: ChapterSyncNeedsYou = {
      chapterId: 'c5',
      chapterTitle: 'Chapter 5',
      reason: 'ambiguous',
      best: null,
      candidates: [candidate('g1', 'Chapter 5 part 1'), candidate('g2', 'Chapter 5 part 2')],
    };
    expect(chapterSyncReasonText(item)).toBe('“Chapter 5 part 1” and “Chapter 5 part 2” both look like it.');
  });

  it('names the best guess for an uncertain match', () => {
    const item: ChapterSyncNeedsYou = { chapterId: 'c6', chapterTitle: 'Chapter 6', reason: 'uncertain', best: candidate('g1', 'Chap 6'), candidates: [] };
    expect(chapterSyncReasonText(item)).toBe('“Chap 6” is close, but not a confident match.');
  });

  it('has plain text for a region-only, rejected or not-mutual match', () => {
    const base = { chapterId: 'c1', chapterTitle: 'Chapter 1', candidates: [] };
    expect(chapterSyncReasonText({ ...base, reason: 'region', best: null })).toMatch(/region/);
    expect(chapterSyncReasonText({ ...base, reason: 'rejected', best: null })).toMatch(/unlinked/);
    expect(chapterSyncReasonText({ ...base, reason: 'not-mutual', best: candidate('g1', 'Ch 2') })).toMatch(/“Ch 2”/);
  });
});

describe('chapterSyncNotChaptersText', () => {
  const track = (guid: string, name: string): ChapterSyncTrackRef => ({ guid, name, index: 0, marker: '' });
  const pickup = (guid: string, name: string, chapterTitle: string): ChapterSyncPickupTrack => ({
    trackGuid: guid,
    trackName: name,
    chapterId: 'c3',
    chapterTitle,
  });

  it('lists unmatched and pickup tracks together, noting pickups', () => {
    const result = chapterSyncNotChaptersText([track('g1', 'Room tone'), track('g2', 'Pickups')], [pickup('g3', 'Chapter 3 (pickups)', 'Chapter 3')]);
    expect(result.names).toBe('Room tone, Pickups, Chapter 3 (pickups)');
    expect(result.note).toBe("The last one is kept as Chapter 3's pickup track.");
  });

  it('says None with nothing unmatched', () => {
    expect(chapterSyncNotChaptersText([], [])).toEqual({ names: 'None.', note: '' });
  });

  it('notes several pickup tracks together', () => {
    const result = chapterSyncNotChaptersText([], [pickup('g1', 'Ch 1 pickups', 'Chapter 1'), pickup('g2', 'Ch 2 pickups', 'Chapter 2')]);
    expect(result.note).toBe('The last 2 are kept as their chapters’ pickup tracks.');
  });
});
