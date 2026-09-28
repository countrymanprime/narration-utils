import { describe, expect, it } from 'vitest';
import type { ChapterSyncNeedsYou, ChapterSyncPickupTrack, ChapterSyncTrackRef } from '../../api/contracts/chapterSync';
import {
  chapterSyncActivityRows,
  chapterSyncBackgroundWaitText,
  chapterSyncNotChaptersText,
  chapterSyncPanelNotChaptersText,
  chapterSyncPanelReasonText,
  chapterSyncReasonText,
  chapterSyncSummaryText,
  chapterSyncTimeLabel,
} from './chapterSyncText';

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

describe('chapterSyncBackgroundWaitText (daw-chapter-track-auto-sync.prd.md Phase 7, ADR 0211)', () => {
  it('says nothing while background checks are off, regardless of wait', () => {
    expect(chapterSyncBackgroundWaitText({ enabled: false, wait: 'recording' })).toBe('');
  });

  it('names REAPER recording, the reason this stream landed', () => {
    expect(chapterSyncBackgroundWaitText({ enabled: true, wait: 'recording' })).toMatch(/REAPER is recording/);
  });

  it('names battery, quiet and model', () => {
    expect(chapterSyncBackgroundWaitText({ enabled: true, wait: 'battery' })).toMatch(/mains power/);
    expect(chapterSyncBackgroundWaitText({ enabled: true, wait: 'quiet' })).toMatch(/settle/);
    expect(chapterSyncBackgroundWaitText({ enabled: true, wait: 'model' })).toMatch(/Whisper model/);
  });

  it('says nothing for off, busy, nothing or an unlooked-at empty wait: none of those need a line', () => {
    for (const wait of ['', 'off', 'busy', 'nothing'] as const) {
      expect(chapterSyncBackgroundWaitText({ enabled: true, wait })).toBe('');
    }
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

describe('the engine panel wording (mockup 02, D85 #13: the panel keeps the mock’s own wording, not the dialog’s)', () => {
  const candidate2 = (trackGuid: string, trackName: string) => ({ trackGuid, trackName, trackIndex: 0, score: 1, source: 'track-name' as const, region: null });

  it('says two tracks match and that a chapter is checked from one', () => {
    const item: ChapterSyncNeedsYou = {
      chapterId: 'c5',
      chapterTitle: 'Chapter 5',
      reason: 'ambiguous',
      best: null,
      candidates: [candidate2('g1', 'Chapter 5 part 1'), candidate2('g2', 'Chapter 5 part 2')],
    };
    expect(chapterSyncPanelReasonText(item)).toBe('Two tracks match: “Chapter 5 part 1” and “Chapter 5 part 2”. A chapter is checked from one track.');
    expect(chapterSyncPanelReasonText({ ...item, candidates: [...item.candidates, candidate2('g3', 'Ch 5 alt')] })).toBe(
      'Three tracks match: “Chapter 5 part 1”, “Chapter 5 part 2” and “Ch 5 alt”. A chapter is checked from one track.',
    );
  });

  it('says why an uncertain match was not linked on its own', () => {
    const item: ChapterSyncNeedsYou = { chapterId: 'c6', chapterTitle: 'Chapter 6', reason: 'uncertain', best: candidate2('g1', 'Chap 6'), candidates: [] };
    expect(chapterSyncPanelReasonText(item)).toBe('Closest track “Chap 6” is not a confident match, so it was not linked on its own.');
  });

  it('keeps the dialog wording for the reasons the mock does not draw', () => {
    const item: ChapterSyncNeedsYou = { chapterId: 'c1', chapterTitle: 'Chapter 1', reason: 'region', best: null, candidates: [] };
    expect(chapterSyncPanelReasonText(item)).toBe(chapterSyncReasonText(item));
  });

  it('joins the tracks that are not chapters with dots and names the pickup track', () => {
    const track = (guid: string, name: string): ChapterSyncTrackRef => ({ guid, name, index: 0, marker: '' });
    const pickup: ChapterSyncPickupTrack = { trackGuid: 'g3', trackName: 'Chapter 3 (pickups)', chapterId: 'c3', chapterTitle: 'Chapter 3' };
    expect(chapterSyncPanelNotChaptersText([track('g1', 'Room tone'), track('g2', 'Pickups')], [pickup])).toBe(
      'Room tone · Pickups · Chapter 3 (pickups), kept as Chapter 3’s pickup track',
    );
    expect(chapterSyncPanelNotChaptersText([track('g1', 'Room tone')], [])).toBe('Room tone');
    expect(chapterSyncPanelNotChaptersText([], [])).toBe('');
  });
});

describe('chapterSyncTimeLabel', () => {
  const now = new Date(2026, 8, 28, 15, 0);
  it('shows the time today, Yesterday, then the day and month', () => {
    expect(chapterSyncTimeLabel(new Date(2026, 8, 28, 10, 42).toISOString(), now)).toBe('10:42');
    expect(chapterSyncTimeLabel(new Date(2026, 8, 27, 23, 5).toISOString(), now)).toBe('Yesterday');
    expect(chapterSyncTimeLabel(new Date(2026, 8, 22, 9, 0).toISOString(), now)).toBe('22 Sep');
    expect(chapterSyncTimeLabel(new Date(2025, 11, 2, 9, 0).toISOString(), now)).toBe('2 Dec 2025');
    expect(chapterSyncTimeLabel('not a date', now)).toBe('');
  });
});

describe('chapterSyncSummaryText', () => {
  const now = new Date(2026, 8, 28, 15, 0);
  const row = (origin: '' | 'manual' | 'auto') => ({ origin });
  it('names the saved file and splits automatic links from the narrator’s', () => {
    const chapters = [...Array.from({ length: 8 }, () => row('auto')), row('manual'), row('')];
    expect(
      chapterSyncSummaryText({ lastSync: new Date(2026, 8, 28, 10, 42).toISOString(), projectFile: 'C:\\Books\\Alice\\Alice.rpp', chapters, linked: 9 }, now),
    ).toBe('On · last synced 10:42 from the saved Alice.rpp · 8 chapters linked automatically, 1 by you');
  });

  it('reads well with one kind of link, none, or no sync yet', () => {
    const at = new Date(2026, 8, 28, 10, 42).toISOString();
    expect(chapterSyncSummaryText({ lastSync: at, projectFile: 'Alice.rpp', chapters: [row('auto')], linked: 1 }, now)).toBe(
      'On · last synced 10:42 from the saved Alice.rpp · 1 chapter linked automatically',
    );
    expect(chapterSyncSummaryText({ lastSync: at, projectFile: '', chapters: [row('manual'), row('manual')], linked: 2 }, now)).toBe(
      'On · last synced 10:42 · 2 chapters linked by you',
    );
    expect(chapterSyncSummaryText({ lastSync: at, projectFile: 'Alice.rpp', chapters: [row('')], linked: 0 }, now)).toBe(
      'On · last synced 10:42 from the saved Alice.rpp · no chapters linked',
    );
    // Before the host has its chapter rows (the saved .rpp unreadable), the plain count stands in.
    expect(chapterSyncSummaryText({ lastSync: null, projectFile: 'Alice.rpp', chapters: [], linked: 3 }, now)).toBe('On · not synced yet · 3 chapters linked');
  });
});

describe('chapterSyncActivityRows', () => {
  const link = (chapterId: string, chapterTitle: string, trackGuid: string) => ({
    chapterId,
    chapterTitle,
    trackGuid,
    confirmedAt: '',
    origin: 'auto' as const,
  });
  it('writes one line per link and new track, and one for the first sync', () => {
    const rows = chapterSyncActivityRows(
      [
        { at: '2026-09-28T10:42:00Z', trigger: 'watch', linked: [link('c11', 'Chapter 11', 'g11')], newTracks: [] },
        { at: '2026-09-27T10:00:00Z', trigger: 'watch', linked: [], newTracks: [{ guid: 'g0', name: 'Room tone', index: 9, marker: '' }] },
        { at: '2026-09-22T09:00:00Z', trigger: 'consent', linked: Array.from({ length: 8 }, (_, i) => link(`c${i}`, `Chapter ${i}`, `g${i}`)), newTracks: [] },
        { at: '2026-09-21T09:00:00Z', trigger: 'undo', linked: [], newTracks: [] },
      ],
      (guid) => (guid === 'g11' ? 'Ch. 11' : ''),
    );
    expect(rows.map((row) => row.text)).toEqual(['Linked “Ch. 11” to Chapter 11', 'New track “Room tone”, not a chapter', 'First sync: 8 chapters linked']);
    expect(rows[0].undoTrackGuid).toBe('g11');
    expect(rows[1].undoTrackGuid).toBe('');
    expect(rows[2].at).toBe('2026-09-22T09:00:00Z');
  });

  it('falls back when the track’s name is no longer known', () => {
    const rows = chapterSyncActivityRows([{ at: '2026-09-28T10:42:00Z', trigger: 'import', linked: [link('c2', 'Chapter 2', 'g2')], newTracks: [] }], () => '');
    expect(rows[0].text).toBe('Linked a track to Chapter 2');
  });
});
