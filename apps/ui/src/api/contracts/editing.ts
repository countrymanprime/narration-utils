import type { Finding } from './findings';

// Editing-readiness check (editing-readiness-analysis.prd.md Phase 5): a narrator-triggered, cache-first scan of one
// chapter's confirmed track for empty space, clicks and breaths, run only when the narrator asks (Q9). The host
// shapes are apps/desktop/bindings_editing.go and apps/desktop/internal/editing/service.go. There is no live event
// yet (unlike CoverageState's `coverage:state`): the panel that would poll this (Phase 7) is not built yet, so this
// is plain request/response like StagesApi.

/** Why a chapter cannot be checked right now: nothing was run or written (internal/editing's Reason). */
export type EditingRefusalReason = 'unmapped' | 'multiple_tracks' | 'mapped_track_missing' | 'no_project' | 'no_project_file' | 'project_unreadable' | 'busy';

export type EditingPhase = 'idle' | 'running' | 'complete' | 'cancelled' | 'failed';

/** The one check the host runs at a time, or the last one that ended. Sent by EditingState. */
export type EditingState = {
  runId?: string;
  chapterId?: string;
  phase: EditingPhase;
  /** Real progress (ADR 0015): items done over items total, cache hits counted done immediately; never moves backwards. */
  percent: number;
  message: string;
  itemsTotal: number;
  itemsDone: number;
  cacheHits: number;
  decoded: number;
  failed: number;
  startedAt?: string;
  completedAt?: string;
};

export type EditingStartResult = { status: 'started'; state: EditingState } | { status: 'refused'; reason: EditingRefusalReason; message: string };

export interface EditingApi {
  /** Starts an editing-readiness scan of one chapter. Refuses rather than starting anything when the chapter cannot
   * be resolved to exactly one confirmed track and its items in the saved project. */
  editingStart(documentId: string, chapterId: string, chapterTitle: string): Promise<EditingStartResult>;
  /** The current check, or the last one that ended. */
  editingState(): Promise<EditingState>;
  /** Asks a running check to stop after its current item; items already finished stay cached. A no-op with nothing running. */
  editingCancel(): Promise<void>;
  /** The chapter's current empty-space findings (silence_cleanup, evidence.class "silence") from its last scan; reads only, starts nothing. */
  editingCandidates(chapterId: string): Promise<Finding[]>;
}
