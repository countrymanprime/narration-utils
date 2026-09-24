import type { ChapterStatus } from './manuscript';

// Chapter stage recommendations (docs/prds/chapter-stage-recommendations.prd.md, docs/architecture/stage-recommendations.md,
// ADR 0160 and ADR 0161): every narration chapter's suggestion to advance one stage, computed on read from the evidence as it
// stands and never stored (D1). Only Confirm and Revert change a chapter status, and only when the narrator clicks. The host
// shapes are apps/desktop/internal/stages (types.go, engine.go, service.go) and apps/desktop/bindings_stages.go.

/** A signal's tri-state answer (D2): only `met` can recommend; `unknown` is never read as met. */
export type StageSignalState = 'met' | 'not_met' | 'unknown';

/** Why a signal is unknown; the UI routes the action that resolves it from this (stages/types.go). */
export type StageUnknownCause =
  | 'never_analyzed'
  | 'stale'
  | 'incomplete_run'
  | 'analysis_running'
  | 'unmapped_track'
  | 'unconfirmed_mapping'
  | 'multiple_tracks'
  | 'measurement_unavailable'
  | 'project_unreadable'
  | 'provider_error';

/**
 * `recommended`: every required signal is met. `not_ready`: one is not met (it outranks unknown). `unknown`: none is not met but one
 * is unknown. `dismissed`: recommended, but the narrator dismissed this exact basis. `none`: not evaluated, see `noneReason`.
 */
export type StageVerdict = 'recommended' | 'not_ready' | 'unknown' | 'dismissed' | 'none';

/** `stage_not_evaluated`: the chapter is not started or finalized (Q4). `no_required_signals`: its stage has no required check yet. */
export type StageNoneReason = 'stage_not_evaluated' | 'no_required_signals';

/** One typed fact behind a signal. `kind` is the signal's own (the recording signal: coverage, region, paragraph, items, analysis, stale). */
export type StageEvidence = {
  kind: string;
  label: string;
  value: string;
  file?: string;
  /** Source-relative seconds. */
  range?: { start: number; end: number };
  paragraphIds?: string[];
};

/** What a signal was computed from. `projectFileModTime` is the saved project's modified time, shown as the evidence's age. */
export type StageBasis = { ledgerRecordIds: string[]; fingerprint: string; projectFileModTime: string };

/** One required check's answer for one chapter. `id` is `<stage>.<name>`; `cause` is set only when `state` is `unknown`. */
export type StageSignal = {
  id: string;
  stage: ChapterStatus;
  state: StageSignalState;
  reason: string;
  cause?: StageUnknownCause;
  evidence: StageEvidence[];
  basis: StageBasis;
  computedAt: string;
};

/** A live confirmation: the narrator confirmed `from` to `target` and the status is still `target`. */
export type StageConfirmation = {
  from: ChapterStatus;
  target: ChapterStatus;
  basisKey: string;
  at: string;
  /** The signals that justified it no longer give the confirmed basis: shown quietly, no notice (Q10). */
  evidenceChanged: boolean;
};

/** "Evidence changed since you confirmed": fresh not-met signals of the confirmed stage. It changes nothing; Revert is the narrator's. */
export type StageContradiction = { revertTo: ChapterStatus; signals: StageSignal[] };

export type StageChapterRecommendation = {
  chapterId: string;
  title: string;
  /** The chapter's status, which is its current stage. */
  from: ChapterStatus;
  /** The stage it may advance to; absent when the stage is not evaluated. */
  target?: ChapterStatus;
  verdict: StageVerdict;
  noneReason?: StageNoneReason;
  /** One per required signal, sorted by id. */
  signals: StageSignal[];
  /** The distinct causes of the unknown signals, sorted. */
  causes: StageUnknownCause[];
  /** What Confirm and Dismiss send back; absent only for a `none` verdict. */
  basisKey?: string;
  confirmation?: StageConfirmation;
  contradiction?: StageContradiction;
};

export type StageRecommendations = { chapters: StageChapterRecommendation[] };

/** Why a Confirm, Dismiss or Revert changed nothing. On `basis_changed` the evidence moved while the narrator looked: check again. */
export type StageRefusalReason = 'basis_changed' | 'not_recommended' | 'nothing_to_revert';

export type StageDecisionResult = { status: 'ok'; chapter: StageChapterRecommendation } | { status: 'refused'; reason: StageRefusalReason; message: string };

export interface StagesApi {
  /** Every narration chapter's verdict, in manuscript order. Reads stored evidence only; never starts an analysis (Q12). */
  stageRecommendations(): Promise<StageRecommendations>;
  /** Sets the chapter's status to `target` and records the basis, if `basisKey` is still the one the evidence gives. */
  stageConfirm(chapterId: string, target: ChapterStatus, basisKey: string): Promise<StageDecisionResult>;
  /** Hides the chapter's suggestion of `target` until its basis changes (Q7); the status is untouched. */
  stageDismiss(chapterId: string, target: ChapterStatus, basisKey: string): Promise<StageDecisionResult>;
  /** Returns a chapter with a live confirmation to the stage it was confirmed from. */
  stageRevert(chapterId: string): Promise<StageDecisionResult>;
}
