// The browser mock's editing-readiness check (editing-readiness-analysis.prd.md Phase 5), answering the shape
// apps/desktop/bindings_editing.go does. No panel drives this yet (Phase 7 is out of this pass's scope), so unlike
// coverageMock/diagnosticsMock this does not step progress across polls: a start completes immediately (nothing to
// animate without a UI reading intermediate percent), and `hold` keeps it at `running` instead, so a future panel's
// cancel affordance can still be exercised without a host.
import type { EditingApi, EditingRefusalReason, EditingState, Finding } from '../types';
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

export type EditingSeed = {
  /** Every start answers this refusal instead of running, so each reason's state can be seen without a host. */
  refusal?: EditingRefusalReason;
  /** A started check stays at `running` instead of completing, so the cancel affordance can be seen without a race. */
  hold?: boolean;
  /** `editingCandidates` answers this list for every chapter, instead of the default (empty: a clean pass). */
  candidates?: Finding[];
};

export function createEditingMock(seed?: EditingSeed): EditingApi {
  let state: EditingState = {
    phase: 'idle',
    message: 'Open a project, save it in REAPER, then check a chapter’s editing.',
    percent: 0,
    itemsTotal: 0,
    itemsDone: 0,
    cacheHits: 0,
    decoded: 0,
    failed: 0,
  };

  return {
    editingStart: async (_documentId, chapterId, _chapterTitle) => {
      if (seed?.refusal) return { status: 'refused', reason: seed.refusal, message: EDITING_REFUSAL_MESSAGES[seed.refusal] };
      if (state.phase === 'running') return { status: 'refused', reason: 'busy', message: EDITING_REFUSAL_MESSAGES.busy };
      const startedAt = new Date().toISOString();
      state = {
        runId: 'editing-1',
        chapterId,
        phase: 'running',
        message: 'Checking…',
        percent: seed?.hold ? 40 : 0,
        itemsTotal: 1,
        itemsDone: 0,
        cacheHits: 0,
        decoded: 0,
        failed: 0,
        startedAt,
      };
      if (!seed?.hold) {
        state = {
          ...state,
          phase: 'complete',
          message: 'Checked. No candidates left to clear.',
          percent: 100,
          itemsDone: 1,
          decoded: 1,
          completedAt: new Date().toISOString(),
        };
      }
      return { status: 'started', state: wireClone(state) };
    },
    editingState: async () => wireClone(state),
    editingCancel: async () => {
      if (state.phase === 'running') state = { ...state, phase: 'cancelled', message: 'Cancelled.', completedAt: new Date().toISOString() };
    },
    editingCandidates: async () => wireClone(seed?.candidates ?? []),
  };
}
