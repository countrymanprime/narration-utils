import { useState } from 'react';
import { useApi } from '../../api/ApiContext';
import { Panel } from '../primitives/Panel';
import { Button } from '../primitives/Button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../primitives/Table';
import type { TakeReviewFinding } from '../../types';

// Category labels are display-only; the wire value stays the source of truth (findings.Category, apps/desktop/internal/findings/findings.go).
const CATEGORY_LABELS: Record<string, string> = {
  pickup: 'Pickup',
  duplicate_read: 'Duplicate read',
};

// evidence.kind labels (internal/repeats.classify's Q11 mapping).
const EVIDENCE_KIND_LABELS: Record<string, string> = {
  exact_copy: 'Exact copy',
  restart: 'Restart',
  pickup: 'Partial pickup',
  near_duplicate: 'Near duplicate',
};

function formatLocation(finding: TakeReviewFinding): string {
  const chapter = finding.manuscript?.chapter_title || finding.manuscript?.chapter_id;
  const span = finding.evidence ? `sentence ${finding.evidence.matched_span_first + 1}–${finding.evidence.matched_span_last + 1}` : undefined;
  if (chapter && span) return `${chapter}, ${span}`;
  return chapter || span || 'Unknown location';
}

function formatCoverage(finding: TakeReviewFinding): string {
  const members = finding.evidence?.members ?? [];
  if (members.length === 0) return '—';
  const full = members.filter((member) => member.coverage >= 0.999).length;
  return full === members.length ? 'Full coverage' : `${full}/${members.length} full, rest partial`;
}

/**
 * take-review's own scan trigger and results view (phase 5 of
 * take-review-pickups-duplicates-take-intelligence.prd.md): a "Scan for pickups & duplicates"
 * action against one REAPER track, and a simple table of the findings it saves - category,
 * evidence kind and manuscript location, per-category evidence only (Q9: no composite score,
 * so there is deliberately no "best take" or ranking column here). This is not the generic
 * findings-browsing Review page (review-dashboard-and-findings-adoption's own later phase);
 * it is scoped to this PRD's own scan and its own findings only.
 */
export function TakeReviewPanel({ chapterTrackName }: { chapterTrackName: string }) {
  const api = useApi();
  const [findings, setFindings] = useState<TakeReviewFinding[]>();
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState('');

  const runScan = () => {
    setScanning(true);
    setError('');
    void api
      .takeReviewScan(chapterTrackName)
      .then((result) => setFindings(result))
      .catch((reason) => setError(String(reason)))
      .finally(() => setScanning(false));
  };

  return (
    <Panel title="Pickups & duplicates">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          Scan &ldquo;{chapterTrackName}&rdquo; for alternate reads: restarts, pickups and near-duplicate takes.
        </p>
        <Button onClick={runScan} pending={scanning} disabled={!chapterTrackName}>
          Scan for pickups &amp; duplicates
        </Button>
      </div>
      {error && (
        <p role="alert" className="mt-3 text-sm" style={{ color: 'var(--danger-text)' }}>
          {error}
        </p>
      )}
      {!error && findings && findings.length === 0 && (
        <p className="mt-3 text-sm" style={{ color: 'var(--text-muted)' }}>
          No repeated reads found on this track.
        </p>
      )}
      {!error && findings && findings.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <Table label="Pickup and duplicate findings">
            <TableHead>
              <TableRow>
                <TableHeader>Category</TableHeader>
                <TableHeader>Evidence</TableHeader>
                <TableHeader>Manuscript location</TableHeader>
                <TableHeader>Coverage</TableHeader>
                <TableHeader align="right">Reads</TableHeader>
              </TableRow>
            </TableHead>
            <TableBody>
              {findings.map((finding) => (
                <TableRow key={finding.id}>
                  <TableCell>{CATEGORY_LABELS[finding.category] ?? finding.category}</TableCell>
                  <TableCell>{EVIDENCE_KIND_LABELS[finding.evidence?.kind ?? ''] ?? finding.evidence?.kind ?? '—'}</TableCell>
                  <TableCell>{formatLocation(finding)}</TableCell>
                  <TableCell>{formatCoverage(finding)}</TableCell>
                  <TableCell align="right">{finding.evidence?.members.length ?? 0}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </Panel>
  );
}
