import type { Finding } from './findings';

// Editing-readiness check (editing-readiness-analysis.prd.md Phase 5): a narrator-triggered, cache-first scan of one
// chapter's confirmed track for empty space, clicks and breaths, run only when the narrator asks (Q9). The host
// shapes are apps/desktop/bindings_editing.go and apps/desktop/internal/editing/service.go. There is no live event
// yet (unlike CoverageState's `coverage:state`): the panel that would poll this (Phase 7) is not built yet, so this
// is plain request/response like StagesApi.

/** Why a chapter cannot be checked right now: nothing was run or written (internal/editing's Reason). `no_render`
 * (Phase 8, Q6) is the render-source path's own case: the chapter's source choice is "render" but no rendered file
 * is associated with it at all - the only render-choice case that refuses to start (a missing, stale or unsupported
 * render is allowed to start so its specific unknown cause can show on the signal instead). */
export type EditingRefusalReason =
  'unmapped' | 'multiple_tracks' | 'mapped_track_missing' | 'no_project' | 'no_project_file' | 'project_unreadable' | 'busy' | 'no_render';

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

/** Q6 (editing-readiness-analysis.prd.md Phase 8): which analysis source counts for a chapter's editing check - items
 * on its track (the default) or its rendered file. Choosing render is an explicit, per-chapter pick; it never
 * silently replaces the item check. */
export type EditingSourceChoice = 'items' | 'render';

export interface EditingApi {
  /** Starts an editing-readiness scan of one chapter. Refuses rather than starting anything when the chapter cannot
   * be resolved to exactly one confirmed track and its items in the saved project (items source), or when no
   * rendered file is associated at all (render source, reason "no_render"). */
  editingStart(documentId: string, chapterId: string, chapterTitle: string): Promise<EditingStartResult>;
  /** The current check, or the last one that ended. */
  editingState(): Promise<EditingState>;
  /** Asks a running check to stop after its current item; items already finished stay cached. A no-op with nothing running. */
  editingCancel(): Promise<void>;
  /** The chapter's current empty-space findings (silence_cleanup, evidence.class "silence") from its last scan; reads only, starts nothing. */
  editingCandidates(chapterId: string): Promise<Finding[]>;
  /** The chapter's current source choice (Q6): "items", the default, or "render". */
  editingSourceChoice(chapterId: string): Promise<EditingSourceChoice>;
  /** Sets the chapter's source choice (Q6: the narrator chooses per chapter) and answers it back as stored. */
  editingSetSourceChoice(chapterId: string, choice: EditingSourceChoice): Promise<EditingSourceChoice>;
}
