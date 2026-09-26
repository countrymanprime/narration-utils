import { Link } from 'react-router-dom';

/**
 * RS4 A (recording-check-summary.prd.md Phase 3): the chapter's unreviewed take-review pickups - repeated reads
 * already recorded, needing comping - as a count line with Open Review, always shown (`01-slideover-not-complete.webp`,
 * `02-slideover-passes.webp`: "Repeated reads (Review): 1 group not reviewed yet" and "... none waiting", each in its
 * own dashed box) rather than only when positive, so the narrator can always tell there is nothing here to chase, not
 * just that the row is missing. RS8 A names it "Repeated reads (Review)": a different kind of pickup from the check's
 * own gaps above it (D33), so a count and a link are enough, no per-item detail. The Review route has no chapter
 * filter yet, so the link lands unfiltered (the PRD's own "unless a small filter parameter is added").
 */
export function TakeReviewPickups({ count }: { count: number }) {
  return (
    <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-md border border-dashed border-[var(--border)] px-3 py-2 text-sm">
      <span>Repeated reads (Review): {count === 0 ? 'none waiting' : `${count} group${count === 1 ? '' : 's'} not reviewed yet`}</span>
      <Link to="/review" className="font-semibold underline">
        Open Review
      </Link>
    </div>
  );
}
