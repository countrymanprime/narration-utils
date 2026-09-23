import type { Finding, FindingsPage } from '../../types';
import { Button } from '../primitives/Button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../primitives/Table';
import { categoryLabel, chapterLabel, confidenceLabel, findingSummary, STATUS_LABELS } from './findingFormat';

/** The list of findings the host answered for the current filters, one row per finding; a row opens its detail. */
export function FindingsList({
  page,
  selectedId,
  filtered,
  onSelect,
  onClearFilters,
  onShowMore,
}: {
  /** Undefined until the first answer arrives. */
  page: FindingsPage | undefined;
  selectedId: string | undefined;
  /** Whether a filter is narrowing the list, so an empty list offers to clear them. */
  filtered: boolean;
  onSelect: (finding: Finding) => void;
  onClearFilters: () => void;
  onShowMore: () => void;
}) {
  const findings = page?.findings ?? [];
  return (
    <section
      aria-label="Findings"
      className="min-w-0 self-start overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2 shadow-[var(--shadow)]"
    >
      <Table label="Findings">
        <TableHead>
          <TableRow>
            <TableHeader>Finding</TableHeader>
            <TableHeader>Chapter</TableHeader>
            <TableHeader align="right">Confidence</TableHeader>
            <TableHeader>Status</TableHeader>
          </TableRow>
        </TableHead>
        <TableBody>
          {findings.map((finding) => (
            <TableRow key={finding.id} selected={finding.id === selectedId} onActivate={() => onSelect(finding)}>
              <TableCell>
                <div className="font-medium [overflow-wrap:anywhere]">{findingSummary(finding)}</div>
                <div className="mt-0.5 text-xs" style={{ color: 'var(--text-muted)' }}>
                  {categoryLabel(finding.category)}
                  {finding.not_in_latest_run ? ' · not in the latest run' : ''}
                </div>
              </TableCell>
              <TableCell className="whitespace-nowrap">{chapterLabel(finding)}</TableCell>
              <TableCell
                align="right"
                className={`whitespace-nowrap ${finding.confidence === null ? '' : "font-['IBM_Plex_Mono',ui-monospace,monospace]"}`}
                style={finding.confidence === null ? { color: 'var(--text-muted)' } : undefined}
              >
                {confidenceLabel(finding.confidence)}
              </TableCell>
              <TableCell className="whitespace-nowrap">{STATUS_LABELS[finding.review.status]}</TableCell>
            </TableRow>
          ))}
          {page && findings.length === 0 && (
            <TableRow>
              <TableCell colSpan={4} className="text-sm" style={{ color: 'var(--text-muted)' }}>
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
      {page && page.total > findings.length && (
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
