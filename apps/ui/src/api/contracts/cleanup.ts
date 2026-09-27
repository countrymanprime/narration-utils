// Silence trim and item gain (booth-actions-enablement PRD Phase 5): the Editing view's own gate onto
// bridge.CleanupClient and bridge.LevelMatchClient (apps/desktop/bindings_cleanup.go), behind CapabilityGate('silence_trim')
// and CapabilityGate('item_gain'). Preview never changes anything in REAPER; Apply recomputes the same candidates
// rather than trusting whatever Preview last answered.

/** One candidate CleanupPreview/CleanupApply found stale: the saved project has moved on since the finding was made. */
export type StaleCleanupCandidate = { findingId: string; itemGuid: string; reason: string };

export type CleanupPreviewResult = {
  /** How many silence-trim candidates this chapter's last editing check found. */
  candidates: number;
  /** How many take markers preview_cleanup_markers newly added. */
  added: number;
  /** How many of those markers already existed from an earlier preview. */
  existing: number;
  stale: StaleCleanupCandidate[];
};

export type CleanupApplyResult = {
  candidates: number;
  /** How many candidates were actually trimmed. */
  applied: number;
  stale: StaleCleanupCandidate[];
};

/** One item on the chapter's linked track whose measured level differs from the target by more than its tolerance. */
export type GainCandidate = { itemGuid: string; deltaDb: number };

export type LevelMatchPreviewResult = { candidates: GainCandidate[] };

/** One item apply_item_gain actually changed, REAPER's own volume unit (D_VOL, linear) before and after. */
export type GainChange = { itemGuid: string; beforeVolume: number; afterVolume: number };

export type StaleGainCandidate = { findingId: string; itemGuid: string; reason: string };

export type LevelMatchApplyResult = { changed: GainChange[]; stale: StaleGainCandidate[] };

/** levelnormalize.Metric's own two values (apps/desktop/internal/levelnormalize). */
export type LevelMatchMetric = 'integrated_lufs' | 'rms_dbfs';

export interface CleanupActionApi {
  /** Asks REAPER to mark every silence-trim candidate's cut range (preview_cleanup_markers). Changes nothing else. */
  cleanupPreview(chapterId: string): Promise<CleanupPreviewResult>;
  /** Asks REAPER to remove every silence-trim candidate's cut range (apply_cleanup_trims), in one undo block. */
  cleanupApply(chapterId: string): Promise<CleanupApplyResult>;
  /** Measures every analyzable item on the chapter's linked track and proposes the gain change that would bring it
   * within toleranceDb of targetValueDb on metric. Read-only: REAPER's item volumes are not touched. */
  levelMatchPreview(chapterId: string, metric: LevelMatchMetric, targetValueDb: number, toleranceDb: number): Promise<LevelMatchPreviewResult>;
  /** Re-measures the same items levelMatchPreview would (never the narrator's last-seen answer) and sends every item
   * that still needs a change to REAPER's apply_item_gain, in one undo block. */
  levelMatchApply(chapterId: string, metric: LevelMatchMetric, targetValueDb: number, toleranceDb: number): Promise<LevelMatchApplyResult>;
}
