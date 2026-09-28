import type { MeasureReport } from './measure';
import type { StageUnknownCause } from './stages';

// A chapter's chosen rendered file (proofing-readiness-signals.prd.md Phase 6, apps/desktop/bindings_proofing_render.go,
// apps/desktop/internal/proofing/renders.go): what the proofing delivery-check signals (`proofing.delivery.*`,
// `proofing.delivery.render_length`) on StageRecommendations are about, and whether it is still current. This PRD adds
// only the bindings to change the choice (choose, clear); the checks themselves are read through StageRecommendations
// (schemas/stages.ts), which already reads the same association.

/** Where a chapter's render stands. `none`: nothing chosen yet. `current`: matches the association exactly.
 * `stale`: the file or the chapter's items changed since it was chosen. `missing`: the file can no longer be read.
 * `unsupported`: not a WAV file, so it cannot be measured (MP3 renders, DX Q2). */
export type ProofingRenderState = 'none' | 'current' | 'stale' | 'missing' | 'unsupported';

/** A chapter's render association and its latest measurement of exactly that file, or none. `cause` and `reason`
 * are set for anything but `current`, the same unknown-cause vocabulary StageSignal uses. */
export type ProofingRender = {
  state: ProofingRenderState;
  cause?: StageUnknownCause;
  reason: string;
  /** The association's path and format, present once one exists whatever its state (so a stale or missing file
   * still shows what it was). */
  path?: string;
  format?: string;
  attestedAt?: string;
  /** The current render's latest measurement, present only once one exists and matches the current association. */
  measurement?: MeasureReport;
  measuredAt?: string;
  /** The current render's latest measurement ended without a report (a job error, not an unavailable value). */
  measurementFailed: boolean;
};

/** ProofingChooseRender's answer: `cancelled` when the narrator closed the file dialog, `refused` when the file
 * could not be read or the chapter has no one confirmed track to attest against, or the render evaluated again. */
export type ProofingChooseRenderResult = { status: 'cancelled' } | { status: 'refused'; message: string } | { status: 'ok'; render: ProofingRender };

export interface ProofingRenderApi {
  /** Reads the chapter's render association and its latest measurement, if it is current. Starts nothing. */
  proofingRenderState(chapterId: string): Promise<ProofingRender>;
  /** Opens the native file dialog for the chapter's rendered file and, once one is chosen, attests it was made from
   * the chapter as the saved project has it now. */
  proofingChooseRender(chapterId: string): Promise<ProofingChooseRenderResult>;
  /** Removes the chapter's render association and answers the render state again (`none`). */
  proofingClearRender(chapterId: string): Promise<ProofingRender>;
}
