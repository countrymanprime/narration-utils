import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCircle, faCircleCheck, faCircleExclamation, faCircleNotch, faTriangleExclamation } from '@fortawesome/free-solid-svg-icons';
import type { ChapterCheckStatus } from './chapterCheckStatus';
import { chapterCheckStatusText } from './chapterCheckStatus';

const ICON: Record<ChapterCheckStatus['kind'], { icon: typeof faCircle; color?: string; spin?: boolean }> = {
  checking: { icon: faCircleNotch, spin: true },
  current: { icon: faCircleCheck, color: 'var(--ok-text)' },
  stale: { icon: faTriangleExclamation, color: 'var(--warn-text)' },
  missing: { icon: faCircleExclamation, color: 'var(--danger-text)' },
  needs_track: { icon: faCircle, color: 'var(--warn-text)' },
  suggested: { icon: faCircle, color: 'var(--info-text)' },
  never: { icon: faCircle, color: 'var(--text-muted)' },
  not_linked: { icon: faCircle, color: 'var(--text-muted)' },
};

/**
 * Home's row status without a click (daw-chapter-track-auto-sync.prd.md Phase 6, S14, `04-row-check-status-replaces-check.webp`):
 * a bold label and a small muted line under it, replacing the per-row Check button. Always clickable, whatever the
 * state - even "No track yet" and "Track missing" open the chapter's slide-over, which offers the fix in place
 * (the existing TrackLink prompt on a refused check), the same way the Check button already did.
 */
export function ChapterCheckStatusButton({ chapterTitle, status, onClick }: { chapterTitle: string; status: ChapterCheckStatus; onClick: () => void }) {
  const text = chapterCheckStatusText(chapterTitle, status);
  const { icon, color, spin } = ICON[status.kind];
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={text.name}
      className="flex items-start gap-1.5 rounded-md px-1 py-0.5 text-left transition hover:bg-[var(--surface-2)]"
    >
      <FontAwesomeIcon icon={icon} aria-hidden="true" className={`mt-0.5 ${spin ? 'motion-safe:animate-spin' : ''}`} style={color ? { color } : undefined} />
      <span>
        <span className="block font-semibold">{text.label}</span>
        {text.detail && (
          <span className="block text-xs" style={{ color: 'var(--text-muted)' }}>
            {text.detail}
          </span>
        )}
      </span>
    </button>
  );
}
