import type { ReactNode } from 'react';
import type { Finding, FindingsPage } from '../../types';
import { Button } from '../primitives/Button';
import { StatusBadge, type StatusTone } from '../primitives/StatusBadge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../primitives/Table';
import { analyzerLabel, chapterLabel, confidenceLabel, evidenceKindLabel, findingSummary, formatTime } from './findingFormat';
import { resolutionOf } from './resolution';

// The note's type as mock 04 draws it (stage-navigation-and-page-replacement.prd.md Phase 5): a chip coloured by what
// kind of fix it asks for, never by colour alone (the chip says the category in words).
export const CATEGORY_TONE: Record<string, StatusTone> = {
  transcript_discrepancy: 'danger',
  pickup: 'warning',
  duplicate_read: 'warning',
  pronunciation: 'info',
  entity: 'info',
};

// A chip on its own `--surface` backing: StatusBadge's tints are contrast-checked over `--surface` (paletteContrast.test.ts), and a
// selected or hovered row is `--surface-2`, so the backing keeps each chip on the pair it was checked against.
function NoteChip({ tone, label }: { tone: StatusTone; label: string }) {
  return (
    <span className="inline-flex rounded-full bg-[var(--surface)] whitespace-nowrap">
      <StatusBadge tone={tone} label={label} />
    </span>
  );
}

/** Proof's notes table (mock 04): the findings the host answered for the current filters, one row per note - chapter, time, type, script
 * against what was heard, where it came from and its resolution (Pickup, Edit or Waived, D85 #7); a row opens its detail. The chapter
 * view shows one chapter's notes, so it leaves the Chapter column out, as the mock draws it; `header` is the mock's notes header. */
export function FindingsList({
  page,
  selectedId,
  filtered,
  onSelect,
  onClearFilters,
  onShowMore,
  header,
  showChapter = true,
}: {
  /** Undefined until the first answer arrives. */
  page: FindingsPage | undefined;
  selectedId: string | undefined;
  /** Whether a filter is narrowing the list, so an empty list offers to clear them. */
  filtered: boolean;
  onSelect: (finding: Finding) => void;
  onClearFilters: () => void;
  onShowMore?: () => void;
  header?: ReactNode;
  showChapter?: boolean;
}) {
  const findings = page?.findings ?? [];
  return (
    <section
      aria-label="Notes"
      className="min-w-0 self-start overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2 shadow-[var(--shadow)]"
    >
      {header}
      <Table label="Notes">
        <TableHead>
          <TableRow>
            {showChapter && <TableHeader>Chapter</TableHeader>}
            <TableHeader>Time</TableHeader>
            <TableHeader>Type</TableHeader>
            <TableHeader>Script vs. heard</TableHeader>
            <TableHeader>From</TableHeader>
            <TableHeader>Resolution</TableHeader>
          </TableRow>
        </TableHead>
        <TableBody>
          {findings.map((finding) => (
            <TableRow key={finding.id} selected={finding.id === selectedId} onActivate={() => onSelect(finding)}>
              {showChapter && <TableCell className="whitespace-nowrap">{chapterLabel(finding)}</TableCell>}
              <TableCell className="font-['IBM_Plex_Mono',ui-monospace,monospace] whitespace-nowrap">
                {finding.time_range ? formatTime(finding.time_range.start) : '—'}
              </TableCell>
              <TableCell>
                <NoteChip tone={CATEGORY_TONE[finding.category] ?? 'neutral'} label={evidenceKindLabel(finding)} />
                {finding.not_in_latest_run && (
                  <div className="mt-0.5 text-xs" style={{ color: 'var(--text-muted)' }}>
                    not in the latest run
                  </div>
                )}
              </TableCell>
              <TableCell className="[overflow-wrap:anywhere]">{findingSummary(finding)}</TableCell>
              <TableCell className="text-xs" style={{ color: 'var(--text-muted)' }}>
                {analyzerLabel(finding.analyzer)}
                {finding.confidence !== null && ` · ${confidenceLabel(finding.confidence)}`}
              </TableCell>
              <TableCell className="whitespace-nowrap">
                <NoteChip {...resolutionOf(finding)} />
              </TableCell>
            </TableRow>
          ))}
          {page && findings.length === 0 && (
            <TableRow>
              <TableCell colSpan={showChapter ? 6 : 5} className="text-sm" style={{ color: 'var(--text-muted)' }}>
                <p>{filtered ? 'No findings match these filters.' : 'No findings to show.'}</p>
                {filtered && (
                  <Button variant="ghost" className="mt-2" onClick={onClearFilters}>
                    Clear filters
                  </Button>
                )}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      {page && onShowMore && page.total > findings.length && (
        <div className="flex items-center justify-between gap-3 px-2 pt-3 pb-1 text-sm" style={{ color: 'var(--text-muted)' }}>
          <span>
            Showing {findings.length} of {page.total}
          </span>
          <Button variant="ghost" onClick={onShowMore}>
            Show more
          </Button>
        </div>
      )}
    </section>
  );
}
