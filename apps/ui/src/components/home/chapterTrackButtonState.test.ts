import { describe, expect, it } from 'vitest';
import type { ChapterTrackLink } from '../../types';
import { chapterTrackButtonLabel, chapterTrackButtonState } from './chapterTrackButtonState';

const base: ChapterTrackLink = {
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

describe('chapterTrackButtonState (chapter-track-link-control.prd.md Phase 2, Solution Detail)', () => {
  it('reads a confirmed link with no warnings as linked', () => {
    const link: ChapterTrackLink = { ...base, status: 'confirmed', track };
    expect(chapterTrackButtonState(link)).toEqual({ kind: 'linked', trackName: 'CHAPTER SIX', trackGuid: '{T}' });
    expect(chapterTrackButtonLabel('Chapter 6', chapterTrackButtonState(link))).toBe('Track for Chapter 6: CHAPTER SIX, linked');
  });

  it('reads a confirmed link with a rename warning as renamed', () => {
    const link: ChapterTrackLink = { ...base, status: 'confirmed', track, warnings: ['confirmed-track-renamed'] };
    expect(chapterTrackButtonState(link)).toEqual({ kind: 'renamed', trackName: 'CHAPTER SIX', trackGuid: '{T}' });
  });

  it('reads a matched or uncertain, unconfirmed status as suggested', () => {
    for (const status of ['matched', 'uncertain'] as const) {
      const link: ChapterTrackLink = { ...base, status, track };
      expect(chapterTrackButtonState(link)).toEqual({ kind: 'suggested', trackName: 'CHAPTER SIX', trackGuid: '{T}' });
    }
    expect(chapterTrackButtonLabel('Chapter 6', chapterTrackButtonState({ ...base, status: 'matched', track }))).toBe(
      'Track for Chapter 6: suggested CHAPTER SIX, not confirmed',
    );
  });

  it('reads ambiguous status, or a confirmed-links-conflict warning, as ambiguous with a count', () => {
    const byStatus: ChapterTrackLink = { ...base, status: 'ambiguous', candidates: [track, { ...track, trackGuid: '{U}' }] };
    expect(chapterTrackButtonState(byStatus)).toEqual({ kind: 'ambiguous', count: 2 });
    const byWarning: ChapterTrackLink = {
      ...base,
      status: 'confirmed',
      track,
      warnings: ['confirmed-links-conflict'],
      links: [
        { trackGuid: '{T}', chapterId: 'c-1', chapterTitle: 'Chapter 6', confirmedAt: '2026-01-01T00:00:00Z' },
        { trackGuid: '{U}', chapterId: 'c-1', chapterTitle: 'Chapter 6', confirmedAt: '2026-01-01T00:00:00Z' },
      ],
    };
    expect(chapterTrackButtonState(byWarning)).toEqual({ kind: 'ambiguous', count: 2 });
  });

  it('reads a confirmed-track-missing warning as missing, even over a confirmed status', () => {
    const link: ChapterTrackLink = { ...base, status: 'confirmed', track, warnings: ['confirmed-track-missing'] };
    expect(chapterTrackButtonState(link)).toEqual({ kind: 'missing' });
    expect(chapterTrackButtonLabel('Chapter 6', { kind: 'missing' })).toBe('Track for Chapter 6: linked track is missing');
  });

  it('reads a none status with no candidates as not linked', () => {
    expect(chapterTrackButtonState(base)).toEqual({ kind: 'not_linked' });
    expect(chapterTrackButtonLabel('Chapter 6', { kind: 'not_linked' })).toBe('Track for Chapter 6: not linked');
  });
});
