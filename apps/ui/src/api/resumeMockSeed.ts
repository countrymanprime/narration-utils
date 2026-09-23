import type { ChapterTrackMatch } from './contracts/chapterTrackMap';
import type { TeleprompterLocateResult } from './contracts/teleprompter';

/**
 * `?mockResume=` (main.tsx): which resume card state (teleprompter-manuscript-integration.prd.md Phase 10) the mock's
 * TeleprompterLocate answers for any chapter, so each can be seen on the first chapter without a real REAPER project,
 * recording or Whisper run. Unset, the mock project's own tracks decide (Chapter 1 found, Chapter 2's source missing, the
 * last chapter no track).
 */
export type MockResumeSeed = 'low_confidence' | 'not_found' | 'ambiguous' | 'none' | 'no_recording' | 'source_missing' | 'source_unsupported' | 'error';

export const MOCK_RESUME_SEEDS: readonly MockResumeSeed[] = [
  'low_confidence',
  'not_found',
  'ambiguous',
  'none',
  'no_recording',
  'source_missing',
  'source_unsupported',
  'error',
];

// What the seeded low-confidence tail scores: it also fits a passage the chapter repeats (ADR 0111, "fit times distinctness").
const LOW_CONFIDENCE = 0.31;
// What the seeded not-found tail heard: a sign-off after the reading, which is no part of the chapter.
const NOT_FOUND_HEARD = 'okay that is where I will stop for today, the next session picks up after the break';

/**
 * The seeded match: `ambiguous` ties the chapter's own track with the next one, `none` finds nothing. Neither sets a track,
 * as the host's matcher never does below `matched` (ADR 0110).
 */
export function seedTrackMatch(match: ChapterTrackMatch, seed: MockResumeSeed | undefined): ChapterTrackMatch {
  if (seed === 'none') return { ...match, status: 'none', track: null, candidates: [], recordedEnd: null };
  if (seed !== 'ambiguous') return match;
  const candidates = match.tracks.slice(0, 2).map((track) => ({
    trackGuid: track.guid,
    trackName: track.name,
    trackIndex: track.index,
    score: 0.9,
    source: 'track-name' as const,
    region: null,
  }));
  return { ...match, status: 'ambiguous', track: null, candidates, recordedEnd: null };
}

/**
 * Turns the mock's answer for a readable track into the seeded status, keeping every field one the host could send: the
 * statuses that stop before the sidecar runs carry no tail or placement, and `not_found` carries a placement with no word.
 */
export function seedLocateResult(result: TeleprompterLocateResult, seed: MockResumeSeed | undefined): TeleprompterLocateResult {
  if (result.status === 'asset_required' || !result.recordedEnd) return result;
  const unread = { ...result, tail: null, located: null };
  switch (seed) {
    case 'no_recording':
      return { ...unread, recordedEnd: null, status: 'no_recording' };
    case 'source_missing':
      return { ...unread, recordedEnd: { ...result.recordedEnd, sourceAvailable: false }, status: 'source_missing' };
    case 'source_unsupported':
      return {
        ...unread,
        recordedEnd: { ...result.recordedEnd, sourceFile: result.recordedEnd.sourceFile.replace(/\.\w+$/, '.mid'), supported: false },
        status: 'source_unsupported',
      };
    case 'low_confidence':
      return result.located ? { ...result, located: { ...result.located, confidence: LOW_CONFIDENCE, confident: false }, status: 'low_confidence' } : result;
    case 'not_found':
      return result.located
        ? {
            ...result,
            located: {
              ...result.located,
              word: null,
              last: null,
              sentence: null,
              confidence: 0,
              confident: false,
              matched: 1,
              heard: NOT_FOUND_HEARD.split(' ').length,
              runnerUp: 0,
              heardText: NOT_FOUND_HEARD,
            },
            status: 'not_found',
          }
        : result;
    default:
      return result;
  }
}
