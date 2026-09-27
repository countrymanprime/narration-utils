import type { PrepMarkupSpan } from '../../types';

// How the reader names a script mark (prep-depth.prd.md Phase 5): what a screen reader hears on the marked words, and the
// mark's own name where it is listed (a stale notice, the Mark up dialog).

/** What the marked words are, said after them: "stressed", "breath after", "spoken by Queen". */
export function describeMark(span: Pick<PrepMarkupSpan, 'kind' | 'value'>): string {
  if (span.kind === 'stress') return 'stressed';
  if (span.kind === 'pause') return span.value === 'long' ? 'pause after' : 'breath after';
  return `spoken by ${span.value}`;
}

/** The mark by name: "stress mark", "breath mark", "pause mark", "Queen tag". */
export function markName(span: Pick<PrepMarkupSpan, 'kind' | 'value'>): string {
  if (span.kind === 'stress') return 'stress mark';
  if (span.kind === 'pause') return span.value === 'long' ? 'pause mark' : 'breath mark';
  return `${span.value} tag`;
}

/** The accessible name of a mark's Remove button: "Remove the stress mark on “warriors”". */
export const removeMarkLabel = (span: Pick<PrepMarkupSpan, 'kind' | 'value' | 'anchorText'>) => `Remove the ${markName(span)} on “${span.anchorText}”`;
