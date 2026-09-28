import { describe, expect, it } from 'vitest';
import type { ChapterSyncChapter, ChapterTrackLink } from '../../types';
import { chapterCheckStatus, chapterCheckStatusText, relativeTime, shortReasonText } from './chapterCheckStatus';

const link: ChapterTrackLink = {
  chapterId: 'c-1',
  chapterTitle: 'Chapter 6',
  status: 'none',
  track: null,
  candidates: [],
  warnings: [],
  links: [],
  recordedEnd: null,
};
const track = { trackGuid: '{T}', trackName: 'CHAPTER SIX', trackIndex: 5, score: 1, source: 'confirmed' as const, region: null };

const syncRow: ChapterSyncChapter = {
  chapterId: 'c-1',
  chapterTitle: 'Chapter 6',
  trackGuid: '{T}',
  trackName: 'CHAPTER SIX',
  origin: 'auto',
  freshness: 'current',
  reasons: [],
  checkedAt: '2026-09-24T10:00:00Z',
  checking: false,
  trackChangedAt: null,
  newestSourceAt: null,
  lastChanged: null,
  pickupTrackGuid: '',
  pickupTrackName: '',
  pickupsScannedAt: null,
  pickupsChanged: false,
};

describe('chapterCheckStatus (daw-chapter-track-auto-sync.prd.md Phase 6, S14)', () => {
  it('shows checking, before anything else, when a check is running on this chapter', () => {
    expect(chapterCheckStatus(undefined, undefined, true, 42)).toEqual({ kind: 'checking', percent: 42 });
    expect(chapterCheckStatus({ ...link, status: 'confirmed', track }, syncRow, true)).toEqual({ kind: 'checking', percent: undefined });
  });

  it('shows not_linked with no link read yet, or a none status with no candidates', () => {
    expect(chapterCheckStatus(undefined, undefined, false)).toEqual({ kind: 'not_linked' });
    expect(chapterCheckStatus(link, undefined, false)).toEqual({ kind: 'not_linked' });
  });

  it('shows the track-link trouble before freshness: missing, needs_track, suggested', () => {
    expect(chapterCheckStatus({ ...link, status: 'confirmed', track, warnings: ['confirmed-track-missing'] }, syncRow, false)).toEqual({ kind: 'missing' });
    expect(chapterCheckStatus({ ...link, status: 'ambiguous', candidates: [track, { ...track, trackGuid: '{U}' }] }, syncRow, false)).toEqual({
      kind: 'needs_track',
      count: 2,
    });
    expect(chapterCheckStatus({ ...link, status: 'matched', track }, syncRow, false)).toEqual({ kind: 'suggested', trackName: 'CHAPTER SIX' });
  });

  it('reads freshness only once the track is confirmed (linked or renamed)', () => {
    const confirmed: ChapterTrackLink = { ...link, status: 'confirmed', track };
    expect(chapterCheckStatus(confirmed, { ...syncRow, freshness: 'current' }, false)).toEqual({ kind: 'current', checkedAt: '2026-09-24T10:00:00Z' });
    expect(chapterCheckStatus(confirmed, { ...syncRow, freshness: 'stale', reasons: ['item_added'], lastChanged: '2026-09-24T09:00:00Z' }, false)).toEqual({
      kind: 'stale',
      reason: 'item_added',
      changedAt: '2026-09-24T09:00:00Z',
    });
    expect(chapterCheckStatus(confirmed, { ...syncRow, freshness: 'never', lastChanged: '2026-09-24T09:00:00Z' }, false)).toEqual({
      kind: 'never',
      changedAt: '2026-09-24T09:00:00Z',
    });
    // No sync row at all (no sync has run yet): a confirmed track reads as never checked, not as not_linked.
    expect(chapterCheckStatus(confirmed, undefined, false)).toEqual({ kind: 'never', changedAt: null });
  });
});

describe('relativeTime', () => {
  const now = Date.parse('2026-09-24T12:00:00Z');
  it('formats just now, minutes, hours, yesterday and days', () => {
    expect(relativeTime('2026-09-24T11:59:40Z', now)).toBe('just now');
    expect(relativeTime('2026-09-24T11:40:00Z', now)).toBe('20 min ago');
    expect(relativeTime('2026-09-24T11:00:00Z', now)).toBe('1h ago');
    expect(relativeTime('2026-09-23T12:00:00Z', now)).toBe('yesterday');
    expect(relativeTime('2026-09-21T12:00:00Z', now)).toBe('3 days ago');
  });
  it('returns an empty string for an unparsable value', () => {
    expect(relativeTime('', now)).toBe('');
  });
});

describe('shortReasonText', () => {
  it('shortens a known staleness reason and humanises an unknown one', () => {
    expect(shortReasonText('item_added')).toBe('item added');
    expect(shortReasonText('take_switched')).toBe('take switched');
    expect(shortReasonText('some_new_reason')).toBe('some new reason');
  });
});

describe('chapterCheckStatusText', () => {
  const now = Date.parse('2026-09-24T12:00:00Z');
  it('labels current with when it was checked', () => {
    const text = chapterCheckStatusText('Chapter 6', { kind: 'current', checkedAt: '2026-09-24T10:00:00Z' }, now);
    expect(text.label).toBe('Current');
    expect(text.detail).toBe('checked 2h ago');
    expect(text.name).toContain('current');
  });

  it('labels stale with the reason and when it changed', () => {
    const text = chapterCheckStatusText('Chapter 6', { kind: 'stale', reason: 'item_added', changedAt: '2026-09-24T11:00:00Z' }, now);
    expect(text.label).toBe('Out of date');
    expect(text.detail).toBe('item added · 1h ago');
  });

  it('labels needs_track and suggested with their candidate facts', () => {
    expect(chapterCheckStatusText('Chapter 6', { kind: 'needs_track', count: 2 }).detail).toBe('2 possible tracks');
    expect(chapterCheckStatusText('Chapter 6', { kind: 'suggested', trackName: 'Chap 6' }).detail).toBe('confirm “Chap 6”');
  });

  it('labels missing and not_linked plainly', () => {
    expect(chapterCheckStatusText('Chapter 6', { kind: 'missing' }).detail).toBe('not in the saved project');
    expect(chapterCheckStatusText('Chapter 6', { kind: 'not_linked' }).detail).toBeUndefined();
  });

  it('labels checking with the live percent when known', () => {
    expect(chapterCheckStatusText('Chapter 6', { kind: 'checking', percent: 42.9 }).label).toBe('Checking 42%');
    expect(chapterCheckStatusText('Chapter 6', { kind: 'checking' }).label).toBe('Checking');
  });
});
