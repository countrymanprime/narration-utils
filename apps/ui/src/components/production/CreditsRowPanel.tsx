import { Link } from 'react-router-dom';
import type { ChapterStatus } from '../../types';
import { STATUS_LABELS, STATUS_ORDER } from '../../chapterStatus';
import { Select } from '../primitives/Select';
import { SlideOver } from '../primitives/SlideOver';
import type { CreditsRow } from './useCreditsRows';

const MUTED = { color: 'var(--text-muted)' };

// Credits run well under a minute, so seconds are shown below one (audiobook-credits-templates.prd.md, Open Question C9).
const creditsLength = (seconds: number) => (seconds < 60 ? `${Math.round(seconds)}s` : `${Math.round(seconds / 60)}m`);

// A single unresolved token reads as its own name (credits-in-chapter-table mock 04); several as a count and list.
const unresolvedWarning = (unresolved: string[]): string | undefined => {
  if (unresolved.length === 0) return undefined;
  if (unresolved.length === 1) return `${unresolved[0]} not filled in`;
  return `${unresolved.length} tokens not filled in: ${unresolved.join(', ')}`;
};

/**
 * An Opening or Closing credits row's slide-over on the Production board (credits-in-chapter-table.prd.md Phase 2, moved from
 * Home's chapter table by stage-navigation-and-page-replacement.prd.md Phase 2): its template, words and estimated length, the
 * tokens still to fill in, and its status, which only `setCreditsStatus` writes (credits are never a manuscript chapter and the
 * stage engine does not assess them).
 */
export function CreditsRowPanel({
  open,
  row,
  label,
  onStatus,
  onClose,
}: {
  open: boolean;
  row: CreditsRow;
  label: string;
  onStatus: (status: ChapterStatus) => void;
  onClose: () => void;
}) {
  const warning = unresolvedWarning(row.unresolved);
  return (
    <SlideOver open={open} title={label} onClose={onClose}>
      <div className="space-y-4 text-sm">
        {row.template ? (
          <>
            <p>
              <span className="font-semibold">{row.template.name}</span> · {(row.words ?? 0).toLocaleString()} words · about{' '}
              {creditsLength(row.estimatedSeconds ?? 0)}
            </p>
            {warning && (
              <p role="alert" style={{ color: 'var(--danger-text)' }}>
                {warning}
              </p>
            )}
            <Link className="font-semibold underline" to={`/script#credits-${row.kind}`}>
              Open in Script
            </Link>
          </>
        ) : (
          <p style={MUTED}>
            Not set up ·{' '}
            <Link className="underline" to="/settings#credits">
              Add {row.kind === 'opening' ? 'an opening' : 'a closing'} template in Settings › Credits
            </Link>
          </p>
        )}
        <Select
          label={`${label} status`}
          value={row.status}
          options={STATUS_ORDER.map((status) => ({ value: status, label: STATUS_LABELS[status] }))}
          onChange={(value) => onStatus(value as ChapterStatus)}
        />
        <p style={MUTED}>Recording check: Not checked. The recording check reads manuscript chapters; credits are not checked yet.</p>
      </div>
    </SlideOver>
  );
}
