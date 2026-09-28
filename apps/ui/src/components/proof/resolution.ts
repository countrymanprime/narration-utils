// Proof's resolution vocabulary (D85 #7 on #509: the approved mocks win, so mock 04's Pickup / Edit / Waived). The
// stored decision is still the finding's own review status (docs/architecture/findings-contract.md): accepted, dismissed,
// deferred or unreviewed. Only the words change. An accepted note reads Pickup or Edit by what it asks for, a
// re-record or a fix in the edit, and that comes from the note itself (its category, or Transcript Compare's evidence
// kind), never stored as a second field. ADR 0470 records the mapping.
import type { Finding, FindingReviewStatus } from '../../types';
import type { StatusTone } from '../primitives/StatusBadge';
import type { FlagKind } from './flags';

export type FixKind = 'pickup' | 'edit';

// The categories fixed in the edit rather than re-recorded: mock 04's REPEAT ("Edit · cut"), PACING ("Edit · tighten"),
// MOUTH and PLOSIVE ("Edit · de-click"), and the audio and delivery checks, which a narrator fixes in REAPER or at
// mastering. Everything else, and any category a newer host adds, is a pickup, the safer fix.
const EDIT_CATEGORIES: ReadonlySet<string> = new Set([
  'duplicate_read',
  'take_comparison',
  'pacing',
  'audio_quality',
  'silence_cleanup',
  'level_consistency',
  'delivery_qc',
]);

/** Whether a note asks for a pickup or an edit. Extra words heard (Transcript Compare's EXTRA) are cut in the edit. */
export function fixKindOf(finding: Finding): FixKind {
  if (finding.evidence?.kind === 'EXTRA') return 'edit';
  return EDIT_CATEGORIES.has(finding.category) ? 'edit' : 'pickup';
}

/** The same question for a chapter-view flag: extra words and cleanup candidates are edits, the rest are pickups. */
export const flagFixKind = (kind: FlagKind): FixKind => (kind === 'extra' || kind === 'cleanup' ? 'edit' : 'pickup');

const RESOLUTION: Record<FindingReviewStatus, { label: string; tone: StatusTone }> = {
  unreviewed: { label: 'To review', tone: 'neutral' },
  accepted: { label: 'Pickup', tone: 'danger' },
  dismissed: { label: 'Waived', tone: 'success' },
  deferred: { label: 'Deferred', tone: 'info' },
};

/** The resolution chip for a status and fix: an accepted edit reads Edit, an accepted pickup Pickup. */
export function resolutionFor(status: FindingReviewStatus, fix: FixKind): { label: string; tone: StatusTone } {
  if (status === 'accepted' && fix === 'edit') return { label: 'Edit', tone: 'warning' };
  return RESOLUTION[status];
}

/** A note's Resolution column chip (mock 04): Pickup, Edit or Waived once decided; To review or Deferred otherwise. */
export const resolutionOf = (finding: Finding) => resolutionFor(finding.review.status, fixKindOf(finding));

/** A status where no single note is in view (Proof's Status filter), in the same words: an accepted note is a pickup or an edit. */
export const PROOF_STATUS_LABELS: Record<FindingReviewStatus, string> = {
  unreviewed: 'To review',
  accepted: 'Pickup or edit',
  dismissed: 'Waived',
  deferred: 'Deferred',
};

/** The decision buttons, in order; accepting a note records the fix it asks for, so its button says which. */
export const DECISION_ORDER: readonly FindingReviewStatus[] = ['accepted', 'dismissed', 'deferred'];

export function decisionLabel(status: FindingReviewStatus, fix: FixKind): string {
  switch (status) {
    case 'accepted':
      return fix === 'edit' ? 'Fix in edit' : 'Pickup';
    case 'dismissed':
      return 'Waive';
    case 'deferred':
      return 'Defer';
    default:
      return 'Reopen';
  }
}

export function savedMessage(status: FindingReviewStatus, fix: FixKind): string {
  switch (status) {
    case 'accepted':
      return fix === 'edit' ? 'Saved: fix in edit.' : 'Saved: needs a pickup.';
    case 'dismissed':
      return 'Saved: waived.';
    case 'deferred':
      return 'Saved: deferred.';
    default:
      return 'Put back in the queue.';
  }
}

export type ResolutionCounts = { pickup: number; edit: number; waived: number; toReview: number; deferred: number };

/** The notes header's chips (mock 04: "6 need pickup", "5 fix in edit", "3 waived"), counted from the notes themselves. */
export function resolutionCounts(findings: readonly Finding[]): ResolutionCounts {
  const counts: ResolutionCounts = { pickup: 0, edit: 0, waived: 0, toReview: 0, deferred: 0 };
  for (const finding of findings) {
    const status = finding.review.status;
    if (status === 'accepted') counts[fixKindOf(finding)] += 1;
    else if (status === 'dismissed') counts.waived += 1;
    else if (status === 'deferred') counts.deferred += 1;
    else counts.toReview += 1;
  }
  return counts;
}
