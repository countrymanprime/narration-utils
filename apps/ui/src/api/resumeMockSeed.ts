import type { ChapterTrackMatch } from './contracts/chapterTrackMap';
import type { TeleprompterLocateResult, TeleprompterModelRequired, TeleprompterReading } from './contracts/teleprompter';

/**
 * `?mockResume=` (main.tsx): which resume state (teleprompter-manuscript-integration.prd.md Phase 10,
 * read-aloud-resume-from-daw.prd.md Phase 3) the mock's TeleprompterLocate answers for any chapter, so each can be seen on
 * the first chapter without a real REAPER project, recording or Whisper run. Unset, the mock project's own tracks decide
 * (Chapter 1 found, Chapter 2's source missing, the last chapter no track) and no last reading is stored, so the verdict is
 * `daw_only`. `agree` and `disagree` add a last reading near to or far from the recording; `prompter_only` has no track and
 * a last reading.
 */
export type MockResumeSeed =
  | 'agree'
  | 'disagree'
  | 'prompter_only'
  | 'low_confidence'
  | 'complete'
  | 'not_found'
  | 'ambiguous'
  | 'none'
  | 'no_recording'
  | 'source_missing'
  | 'source_unsupported'
  | 'error';

export const MOCK_RESUME_SEEDS: readonly MockResumeSeed[] = [
  'agree',
  'disagree',
  'prompter_only',
  'low_confidence',
  'complete',
  'not_found',
  'ambiguous',
  'none',
  'no_recording',
  'source_missing',
  'source_unsupported',
  'error',
];

/** The locate result before the host adds the last reading and the verdict (`withResumeVerdict` in teleprompterlocate.go). */
export type LocateDraft = Omit<Extract<TeleprompterLocateResult, { match: unknown }>, 'lastReading' | 'verdict'> | TeleprompterModelRequired;

// When the seeded last reading ended (a fixed time, so captures are stable).
const READING_ENDED_AT = '2026-09-24T21:04:00Z';

/**
 * The last reading the seed stores for a chapter of `tokens` words whose recording ends at `dawWord` (null when nothing was
 * placed): three words past the recording for `agree`, far from it for `disagree`, a third of the way in for
 * `prompter_only`, and none otherwise.
 */
export function seedLastReading(seed: MockResumeSeed | undefined, chapterId: string, dawWord: number | null, tokens: number): TeleprompterReading | null {
  let read: number | null = null;
  if (seed === 'agree' && dawWord !== null) read = Math.min(tokens, dawWord + 3);
  if (seed === 'disagree' && dawWord !== null) read = dawWord > tokens / 2 ? Math.round(tokens * 0.2) : Math.round(tokens * 0.9);
  if (seed === 'prompter_only') read = Math.round(tokens * 0.3);
  if (read === null || read < 1 || tokens < 1) return null;
  return { version: 1, chapterId, read, tokens, scriptHash: '0'.repeat(64), status: 'listening', endedAt: READING_ENDED_AT };
}

// What the seeded low-confidence tail scores: it also fits a passage the chapter repeats (ADR 0111, "fit times distinctness").
const LOW_CONFIDENCE = 0.31;
// What the seeded not-found tail heard: a sign-off after the reading, which is no part of the chapter.
const NOT_FOUND_HEARD = 'okay that is where I will stop for today, the next session picks up after the break';

/**
 * The seeded match: `ambiguous` ties the chapter's own track with the next one, `none` finds nothing. Neither sets a track,
 * as the host's matcher never does below `matched` (ADR 0110).
 */
export function seedTrackMatch(match: ChapterTrackMatch, seed: MockResumeSeed | undefined): ChapterTrackMatch {
  if (seed === 'none' || seed === 'prompter_only') return { ...match, status: 'none', track: null, candidates: [], recordedEnd: null };
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
export function seedLocateResult(result: LocateDraft, seed: MockResumeSeed | undefined): LocateDraft {
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
    // The recording already reaches the chapter's last word (read-aloud-resume-from-daw.prd.md Phase 1: a placed word with
    // no script words after it is complete, and must never be offered as a place to resume).
    case 'complete':
      return result.located ? { ...result, located: { ...result.located, word: result.located.tokens } } : result;
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
