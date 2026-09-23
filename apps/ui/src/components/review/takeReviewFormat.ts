import { takeReviewEvidenceSchema } from '../../api/schemas/takeReview';
import type { Finding, TakeReviewEvidence, TakeReviewMember } from '../../types';

// How the Review page words a take-review finding's reads (internal/repeats.Member over the wire), shared by the reads list,
// the "Add as take" pickers and the audition's A/B pickers so one read is named the same everywhere. Display only.

/** The reads a take-review finding groups, checked against their schema; undefined for any other finding or evidence that does not match. */
export function takeReviewEvidence(finding: Finding): TakeReviewEvidence | undefined {
  if (finding.analyzer !== 'take-review') return undefined;
  const parsed = takeReviewEvidenceSchema.safeParse(finding.evidence);
  return parsed.success ? parsed.data : undefined;
}

// evidence.kind, internal/repeats.classify's Q11 mapping.
const KIND_LABELS: Record<string, string> = {
  exact_copy: 'Exact copy',
  restart: 'Restart',
  pickup: 'Partial pickup',
  near_duplicate: 'Near duplicate',
};

export const readKindLabel = (kind: string): string => KIND_LABELS[kind] ?? kind;

/** The script sentences the reads cover, counted from 1 as the narrator does. */
export const spanLabel = (evidence: TakeReviewEvidence): string =>
  evidence.matched_span_first === evidence.matched_span_last
    ? `Sentence ${evidence.matched_span_first + 1}`
    : `Sentences ${evidence.matched_span_first + 1}–${evidence.matched_span_last + 1}`;

/** A read covers the whole span when the sidecar measured (nearly) all of it; the host's own full-coverage threshold decided the kind. */
const FULL_COVERAGE = 0.999;

export const coverageLabel = (member: TakeReviewMember): string =>
  member.coverage >= FULL_COVERAGE ? 'Whole span' : `Part of the span (${Math.round(member.coverage * 100)}%)`;

export function sourceFileName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

export function memberLabel(member: TakeReviewMember, index: number): string {
  const coverage = Math.round(member.coverage * 100);
  return `Read ${index + 1} — ${sourceFileName(member.source_file)} (${coverage}% coverage)`;
}
