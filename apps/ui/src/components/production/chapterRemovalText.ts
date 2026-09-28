import type { ManuscriptContentKind } from '../../api/contracts/manuscript';

/** How a removed chapter's new kind reads in a sentence (chapter-track-link-control.prd.md Phase 3, mockups 06/07):
 * "removed today as not a chapter" / "as front matter". `narration` never appears here - a chapter holding it isn't removed. */
export function removalKindLabel(kind: ManuscriptContentKind): string {
  return kind === 'opening' ? 'front matter' : 'not a chapter';
}

const isSameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** "today" / "yesterday" / a plain date, for "removed <when> as <kind>" (mockup 07). */
export function removedWhenLabel(kindChangedAt: string, now: Date): string {
  const changed = new Date(kindChangedAt);
  if (isSameDay(changed, now)) return 'today';
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (isSameDay(changed, yesterday)) return 'yesterday';
  return changed.toLocaleDateString(undefined, { dateStyle: 'medium' });
}
