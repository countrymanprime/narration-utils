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

/** Why a pinned window is stale (proofing-preview-suggestion.prd.md Phase 8, Q9): `text_changed` when every
 * paragraph it names is still in the chapter but at least one no longer reads the way it did when pinned or last
 * adjusted; `paragraph_missing` when at least one is no longer in the manuscript at all (a re-import renumbered or
 * dropped it) - in that case `candidate` is omitted, since there is nothing left to recompute evidence for. */
export type PreviewPinStaleReason = 'text_changed' | 'paragraph_missing';

/** The narrator's pinned window, always present (never null) with `present` naming whether one exists - the same
 * named-state convention `PreviewResult.outcome` uses, rather than a nullable payload every caller has to
 * null-check. A pin is a narrator decision, never a computed verdict (SR D1): it is never suggested, only kept
 * when the narrator asks, and it is one per book (Q9) - setting a new one replaces whatever was pinned before. */
export type PinnedPreview = {
  present: boolean;
  /** The pin's window, recomputed fresh against the manuscript's current text on every read, the same evidence a
   * suggested candidate carries. Present even while `stale` is `'text_changed'` (the paragraphs still exist, just
   * reworded); omitted only when `staleReason` is `'paragraph_missing'`. */
  candidate?: PreviewCandidate;
  stale: boolean;
  staleReason?: PreviewPinStaleReason;
  /** When the pin was set or last adjusted, RFC 3339. Omitted when `present` is `false`. */
  pinnedAt?: string;
  /** Whether each edge adjustment (User Flow step 5: "move its edges by paragraphs") would actually change the
   * range: `false` both when nothing is pinned and when that edge already reaches the chapter's own boundary, or
   * (shrinking) the range is already down to one paragraph. */
  canExtendStart: boolean;
  canShrinkStart: boolean;
  canExtendEnd: boolean;
  canShrinkEnd: boolean;
};

export interface PreviewApi {
  /** Reads up to three ranked five-minute preview candidates from the imported manuscript. Never runs anything,
   * stores nothing; recomputed fresh from the manuscript's current chapters and paragraphs on every call. */
  previewCandidates(): Promise<PreviewResult>;
  /** Reads the narrator's pinned window, if any, resolved against the manuscript's current text. */
  previewPin(): Promise<PinnedPreview>;
  /** Pins one window, replacing any earlier pin: chapterId and paragraphIds are normally a candidate's own fields,
   * exactly as previewCandidates answered them, though any contiguous, in-order run of one chapter's paragraph ids
   * is accepted. */
  previewPinSet(chapterId: string, paragraphIds: string[]): Promise<PinnedPreview>;
  /** Grows (`grow: true`) or shrinks (`grow: false`) the pinned range by one paragraph at `edge`. A no-op, not an
   * error, once that edge already reaches its limit (see `canExtendStart` etc. above); rejects only when nothing
   * is pinned or the pin can no longer be resolved at all (`staleReason: 'paragraph_missing'`). */
  previewPinAdjust(edge: 'start' | 'end', grow: boolean): Promise<PinnedPreview>;
  /** Removes the pin. Not an error when nothing is pinned. */
  previewPinClear(): Promise<PinnedPreview>;
}
