// The browser mock's editing-readiness check (editing-readiness-analysis.prd.md Phase 5, stepped for Phase 7's panel).
// A start steps through real-looking progress over a few items, exactly like coverageMock's TRANSCRIBE/ALIGN steps: a
// held run freezes partway (so the panel's Cancel affordance, and a cancel's `partial` result, can be seen without a
// host or a race), and every reason answers a refusal instead of running.
//
// `editingCandidates` is not implemented here: the real host reads it from the same findings store `FindingsReview`
// decides against (apps/desktop/internal/editing/scan.go's `Candidates`), so this mock's `editingCandidates` is
// overridden in mockApi.ts to read the shared `findingsMock` store instead - a candidate is seeded like any other
// finding (`initial.findings`, editingCandidateFor in mockFixtures.ts), and Accept/Dismiss/Defer on it go through the
// same `findingsReview` binding a real editing candidate would.
import type { EditingApi, EditingRefusalReason, EditingState } from '../types';
import { wireClone } from './mockFixtures';

/** The host's own refusal sentences (apps/desktop/internal/editing/service.go's unknown/unknownf messages), in short. */
const EDITING_REFUSAL_MESSAGES: Record<EditingRefusalReason, string> = {
  unmapped: 'link this chapter to the REAPER track it is edited on',
  multiple_tracks: 'this chapter is linked to more than one REAPER track',
  mapped_track_missing: 'the track this chapter is linked to is no longer in the saved project',
  no_project: 'open a project before checking editing',
  no_project_file: 'no REAPER project file is chosen for this project',
  project_unreadable: 'could not read the saved project',
  busy: 'an editing check is already running',
};

const STEP_MS = 150;
const DEFAULT_ITEMS_TOTAL = 3;

export type EditingSeed = {
  /** Every start answers this refusal instead of running, so each reason's state can be seen without a host. */
  refusal?: EditingRefusalReason;
  /** A started check stops after its first item and never ends, so the panel's Cancel (and the `partial` result a
   * cancel leaves) can be seen without a host or a race. */
  hold?: boolean;
  /** How many items the scan reports (default 3): only affects the progress steps' count and message. */
  itemsTotal?: number;
};

const idle: EditingState = {
  phase: 'idle',
  message: 'Open a project, save it in REAPER, then check a chapter’s editing.',
  percent: 0,
  itemsTotal: 0,
  itemsDone: 0,
  cacheHits: 0,
  decoded: 0,
  failed: 0,
};

export function createEditingMock(seed?: EditingSeed): EditingApi {
  let state: EditingState = { ...idle };
  let timers: ReturnType<typeof setTimeout>[] = [];
  const itemsTotal = seed?.itemsTotal ?? DEFAULT_ITEMS_TOTAL;

  const stop = () => {
    timers.forEach(clearTimeout);
    timers = [];
  };

  const finish = () => {
    state = {
      ...state,
      phase: 'complete',
      percent: 100,
      itemsDone: itemsTotal,
      decoded: itemsTotal,
      // This mock cannot simulate discovering a genuine new candidate (that needs real audio analysis); whatever the
      // chapter's findings already hold (seeded in `initial.findings`, read through mockApi.ts's own editingCandidates
      // override) is what a narrator sees after this "scan" too.
      message: 'Checked.',
      completedAt: new Date().toISOString(),
    };
  };

  return {
    editingStart: async (_documentId, chapterId, _chapterTitle) => {
      if (seed?.refusal) return { status: 'refused', reason: seed.refusal, message: EDITING_REFUSAL_MESSAGES[seed.refusal] };
      if (state.phase === 'running') return { status: 'refused', reason: 'busy', message: EDITING_REFUSAL_MESSAGES.busy };
      stop();
      const startedAt = Date.now();
      const runId = String(startedAt);
      state = {
        runId,
        chapterId,
        phase: 'running',
        message: `Checking item 1 of ${itemsTotal}…`,
        percent: 0,
        itemsTotal,
        itemsDone: 0,
        cacheHits: 0,
        decoded: 0,
        failed: 0,
        startedAt: new Date(startedAt).toISOString(),
      };
      if (seed?.hold) {
        // One item finishes, so a cancel from here leaves a realistic `partial` result (an item already done stays cached).
        timers.push(
          setTimeout(() => {
            if (state.runId !== runId || state.phase !== 'running') return;
            state = { ...state, itemsDone: 1, decoded: 1, percent: Math.round((1 / itemsTotal) * 100), message: `Checking item 2 of ${itemsTotal}…` };
          }, STEP_MS),
        );
      } else {
        for (let done = 1; done <= itemsTotal; done += 1) {
          timers.push(
            setTimeout(() => {
              if (state.runId !== runId || state.phase !== 'running') return;
              if (done === itemsTotal) {
                finish();
                return;
              }
              state = {
                ...state,
                itemsDone: done,
                decoded: done,
                percent: Math.round((done / itemsTotal) * 100),
                message: `Checking item ${done + 1} of ${itemsTotal}…`,
              };
            }, STEP_MS * done),
          );
        }
      }
      return { status: 'started', state: wireClone(state) };
    },
    editingState: async () => wireClone(state),
    editingCancel: async () => {
      if (state.phase === 'running') {
        stop();
        state = {
          ...state,
          phase: 'cancelled',
          message: 'Cancelled. The items already checked are kept for the next check.',
          completedAt: new Date().toISOString(),
        };
      }
    },
    // Overridden in mockApi.ts to read the shared findings store; this default (always clean) is never reached there.
    editingCandidates: async () => [],
  };
}
