// The browser mock's pickup and duplicate scan job (take review Phase 5), answering the way apps/desktop/takereview_job.go
// does: the same scope checks and refusals, a running job whose percent and stage advance one step per poll (standing in
// for the sidecar's own progress file, ADR 0015), and a finished scan that saves its findings into the findings mock, so
// they reach the Review page through the same list the host's do. A scan of "Chapter 1" finds the fixture groups; any
// other track finds nothing. `hold` keeps a started scan part way through, so the progress can be looked at.
import type { Finding, JobEnded, TakeReviewApi, TakeReviewScanJob, TakeReviewScanScope } from '../types';
import { WIRE_TAKE_REVIEW_FINDINGS, WIRE_TRACKS_PROJECT, wireClone } from './mockFixtures';

type Save = (analyzer: string, chapterId: string, fresh: Finding[]) => void;

// The stages a mock scan reports, as compare.py's --find-repeats writes them.
const STAGES: Array<[number, string]> = [
  [2, 'Transcribing read 1/4'],
  [47, 'Transcribing read 2/4'],
  [95, 'Grouping repeated spans...'],
];

/** apps/desktop/takereview.go's takeReviewChapterID: the findings scope a track's scan is saved under. */
const chapterIdOf = (track: string): string => track.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'chapter';

/** takereview.ValidateScope and the host's track check, in the host's words. */
function refusalOf(scope: TakeReviewScanScope): string | undefined {
  const { chapterTrackName: chapter, pickupTrackName: pickup, pickupRangeStart: start, pickupRangeEnd: end } = scope;
  const hasRange = start !== undefined || end !== undefined;
  if (!chapter) return 'choose a track to scan for pickups and duplicates';
  if (pickup && pickup === chapter) return 'choose a different track for pickups than the one you are scanning';
  if (pickup && hasRange) return 'add a pickup track or a time range, not both';
  if (hasRange && (start === undefined || end === undefined)) return 'a pickup time range needs a start and an end';
  if (hasRange && start !== undefined && start < 0) return 'a pickup time range starts at zero or later';
  if (hasRange && start !== undefined && end !== undefined && end <= start) return 'a pickup time range must end after its start';
  const missing = [chapter, pickup].find((name) => name && !WIRE_TRACKS_PROJECT.tracks.some((track) => track.name === name));
  return missing ? `the REAPER project has no track named "${missing}"; reload the tracks and choose again` : undefined;
}

export function createTakeReviewScanMock(
  save: Save,
  publish: (event: JobEnded) => void,
  hold = false,
): Pick<TakeReviewApi, 'takeReviewScanStart' | 'takeReviewScanState' | 'takeReviewScanCancel'> {
  let job: TakeReviewScanJob = {
    id: null,
    kind: 'take_review',
    phase: 'idle',
    message: 'Ready to scan for pickups and duplicates.',
    percent: 0,
    logs: [],
    elapsed: 0,
    scope: { chapterTrackName: '' },
    found: 0,
  };
  let stage = 0;

  const end = (phase: 'success' | 'cancelled', message: string, found = 0) => {
    job = { ...job, phase, message, found, percent: phase === 'success' ? 100 : job.percent, logs: [...job.logs, message] };
    publish({ id: job.id ?? '', kind: 'take_review', outcome: phase, message, durationMs: Math.round(job.elapsed * 1000) });
  };

  const finish = () => {
    const track = job.scope.chapterTrackName;
    const fresh = track === 'Chapter 1' ? WIRE_TAKE_REVIEW_FINDINGS : [];
    save('take-review', chapterIdOf(track), fresh);
    const found = fresh.length;
    const message = found === 0 ? `No repeated reads found in ${track}.` : `Found ${found} ${found === 1 ? 'group' : 'groups'} of repeated reads in ${track}.`;
    end('success', message, found);
  };

  // One poll is one step of real work: the next stage, then the end.
  const advance = () => {
    if (job.phase !== 'running' || hold) return;
    if (stage < STAGES.length) {
      const [percent, message] = STAGES[stage];
      stage += 1;
      job = { ...job, percent, message, logs: [...job.logs, message], elapsed: job.elapsed + 1.5 };
      return;
    }
    finish();
  };

  return {
    takeReviewScanStart: async (scope) => {
      const refusal = refusalOf(scope);
      if (refusal) throw new Error(refusal);
      if (job.phase === 'running') throw new Error('a pickup and duplicate scan is already running');
      const message = `Scanning ${scope.chapterTrackName} for pickups and duplicates.`;
      stage = 0;
      job = { id: 'take-review-1', kind: 'take_review', phase: 'running', message, percent: 0, logs: [message], elapsed: 0, scope: wireClone(scope), found: 0 };
      if (hold) {
        // Held part way through, at the second read, the way a real scan of a long chapter is seen most of the time.
        const [percent, stageMessage] = STAGES[1];
        job = { ...job, percent, message: stageMessage, logs: [message, STAGES[0][1], stageMessage], elapsed: 12 };
      }
      return wireClone(job);
    },
    takeReviewScanState: async () => {
      advance();
      return wireClone(job);
    },
    takeReviewScanCancel: async () => {
      if (job.phase === 'running') end('cancelled', 'Scan cancelled. Nothing was saved.');
      return wireClone(job);
    },
  };
}
