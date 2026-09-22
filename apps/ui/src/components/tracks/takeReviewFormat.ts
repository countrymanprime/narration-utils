import type { TakeReviewMember } from '../../types';

// Shared display helpers for a take-review finding's members (apps/desktop/internal/repeats.Member
// over the wire, apps/ui/src/api/contracts/takeReview.ts's TakeReviewMember), used by both
// TakeReviewPanel's "Add as take" target/candidate pickers and AuditionDialog's A/B pickers so the
// same read is labelled identically in both places.

function sourceFileName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

export function memberLabel(member: TakeReviewMember, index: number): string {
  const coverage = Math.round(member.coverage * 100);
  return `Read ${index + 1} — ${sourceFileName(member.source_file)} (${coverage}% coverage)`;
}
