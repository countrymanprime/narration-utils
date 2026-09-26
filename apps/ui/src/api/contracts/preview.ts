// The proofing-preview-suggestion PRD's preview candidates: up to three ranked ~five-minute excerpts computed on
// read from the imported manuscript (Phase 1's pure Go engine, apps/desktop/internal/preview; Phase 2's own read
// binding, apps/desktop/bindings_preview.go's PreviewCandidates). Read-only: it never runs anything and stores
// nothing (SR D1), and it is recomputed fresh from the manuscript's current chapters and paragraphs on every call, at
// the engine's default settings until a later phase adds a narrator setting for target length, tolerance, preset and
// ending exclusion (Phase 4).

/** A manuscript-wide state with no ranked candidates to show, distinct from an empty `candidates` list under `ok`
 * (preview.Outcome's own doc: an empty list must never be conflated with "nothing eligible"). */
export type PreviewOutcome = 'ok' | 'no_manuscript' | 'nothing_eligible';

/** One suggested window: a contiguous run of whole paragraphs inside exactly one chapter, never crossing a chapter
 * boundary. `shorter` is true when even this chapter's every eligible paragraph together falls short of the
 * target's lower tolerance bound: the candidate is the whole chapter, honestly labelled rather than padded or
 * hidden. `reasons` and `warnings` are the evidence a narrator reads; nothing here is a grade. */
export type PreviewCandidate = {
  chapterId: string;
  chapterTitle: string;
  paragraphIds: string[];
  wordCount: number;
  estimatedSeconds: number;
  shorter: boolean;
  reasons: string[];
  warnings: string[];
};

export type PreviewResult = {
  outcome: PreviewOutcome;
  /** Up to three, one per eligible chapter, ranked highest score first. Empty unless `outcome` is `'ok'`. */
  candidates: PreviewCandidate[];
};

export interface PreviewApi {
  /** Reads up to three ranked five-minute preview candidates from the imported manuscript. Never runs anything,
   * stores nothing; recomputed fresh from the manuscript's current chapters and paragraphs on every call. */
  previewCandidates(): Promise<PreviewResult>;
}
