import { Link } from 'react-router-dom';

/**
 * RS4 A (recording-check-summary.prd.md Phase 3): the chapter's unreviewed take-review pickups - repeated reads
 * already recorded, needing comping - as a count line with Open Review. A different kind of pickup from the check's
 * own gaps above it (D33: each source keeps its own meaning), so a count and a link are enough, no per-item detail.
 * The Review route has no chapter filter yet, so the link lands unfiltered (the PRD's own "unless a small filter
 * parameter is added"). The caller only renders this once it has a positive count (`RecordingCheckReport`), so this
 * component itself has no empty or loading state to show.
 */
export function TakeReviewPickups({ count }: { count: number }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-sm">
      <span>
        Take review: {count} group{count === 1 ? '' : 's'} of repeated reads not reviewed yet
      </span>
      <Link to="/review" className="font-semibold underline">
        Open Review
      </Link>
    </li>
  );
}
