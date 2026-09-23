import { useState } from 'react';
import { useApi } from '../../api/ApiContext';
import { Panel } from '../primitives/Panel';
import { Button } from '../primitives/Button';
import { ConfirmDialog } from '../primitives/ConfirmDialog';
import { Select } from '../primitives/Select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../primitives/Table';
import { AuditionDialog } from './AuditionDialog';
import { memberLabel } from './takeReviewFormat';
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

// Whether a finding can offer "Add as take" at all: the analyzer's own suggested_action (Q4/Q8 - a
// candidate action is only ever a proposal, the narrator confirms it explicitly) and at least two
// reads to choose a target and a candidate from.
function canCreateTake(finding: TakeReviewFinding): boolean {
  return finding.suggested_action?.kind === 'create_take' && (finding.evidence?.members.length ?? 0) >= 2;
}

// Whether a finding can offer "Audition" (phase 7, Q7): playback needs no suggested_action - it
// never mutates REAPER - just two reads to compare.
function canAudition(finding: TakeReviewFinding): boolean {
  return (finding.evidence?.members.length ?? 0) >= 2;
}

/**
 * take-review's own scan trigger and results view (phase 5 of
 * take-review-pickups-duplicates-take-intelligence.prd.md), plus phase 6's take-creation action: a
 * "Scan for pickups & duplicates" action against one REAPER track, a simple table of the findings it
 * saves - category, evidence kind and manuscript location, per-category evidence only (Q9: no
 * composite score, so there is deliberately no "best take" or ranking column here) - and, per row, an
 * "Add as take" action that lets the narrator pick which read is the target item and which is the
 * candidate to attach, then confirms before REAPER does anything (Q4/Q8: never preselected, never
 * automatic). Phase 7 adds a per-row "Audition" action (AuditionDialog) that plays two of a
 * finding's reads side by side from their own raw source, with no REAPER mutation. This is not the
 * generic findings-browsing Review page (review-dashboard-and-findings-adoption's own later phase);
 * it is scoped to this PRD's own scan, findings and take-creation/audition actions.
 */
export function TakeReviewPanel({ chapterTrackName }: { chapterTrackName: string }) {
  const api = useApi();
  const [findings, setFindings] = useState<TakeReviewFinding[]>();
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState('');

  const [activeFindingId, setActiveFindingId] = useState<string | null>(null);
  const [targetGuid, setTargetGuid] = useState('');
  const [candidateGuid, setCandidateGuid] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const [createdTakes, setCreatedTakes] = useState<Record<string, string>>({});

  const [auditionFindingId, setAuditionFindingId] = useState<string | null>(null);

  const runScan = () => {
    setScanning(true);
    setError('');
    void api
      .takeReviewScan(chapterTrackName)
      .then((result) => setFindings(result))
      .catch((reason) => setError(String(reason)))
      .finally(() => setScanning(false));
  };

  const openCreateTake = (finding: TakeReviewFinding) => {
    setActiveFindingId(finding.id);
    setTargetGuid('');
    setCandidateGuid('');
    setCreateError('');
  };
  const closeCreateTake = () => {
    if (creating) return;
    setActiveFindingId(null);
  };

  const activeFinding = findings?.find((finding) => finding.id === activeFindingId);
  const activeMembers = activeFinding?.evidence?.members ?? [];
  const auditionFinding = findings?.find((finding) => finding.id === auditionFindingId);

  const confirmCreateTake = () => {
    const target = activeMembers.find((member) => member.item_guid === targetGuid);
    const candidate = activeMembers.find((member) => member.item_guid === candidateGuid);
    if (!activeFinding || !target || !candidate) {
      setCreateError('Choose a target item and a different candidate read.');
      return;
    }
    setCreating(true);
    setCreateError('');
    void api
      .takeReviewCreateTake({
        findingId: activeFinding.id,
        targetItemGuid: target.item_guid,
        candidateItemGuid: candidate.item_guid,
        sourceFile: candidate.source_file,
        sourceRangeStart: candidate.source_start,
        sourceRangeEnd: candidate.source_start + candidate.source_length,
      })
      .then((result) => {
        setCreatedTakes((previous) => ({ ...previous, [activeFinding.id]: result.newTakeGuid }));
        setActiveFindingId(null);
      })
      .catch((reason) => setCreateError(String(reason)))
      .finally(() => setCreating(false));
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
                <TableHeader align="right">Action</TableHeader>
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
                  <TableCell align="right">
                    <div className="flex justify-end gap-2">
                      <Button variant="ghost" onClick={() => setAuditionFindingId(finding.id)} disabled={!canAudition(finding)}>
                        Audition
                      </Button>
                      {createdTakes[finding.id] ? (
                        <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
                          Take added
                        </span>
                      ) : (
                        <Button variant="ghost" onClick={() => openCreateTake(finding)} disabled={!canCreateTake(finding)}>
                          Add as take
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {activeFinding && (
        <ConfirmDialog
          title="Add candidate as a new take"
          body="Choose the item this take is added to and which read to attach as its source. The previous active take stays active, and the item's length is never changed; this can be undone with one Undo in REAPER."
          confirmLabel="Create take"
          confirm={confirmCreateTake}
          cancel={closeCreateTake}
          pending={creating}
        >
          <div className="mt-3 flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-sm">
              Target item (where the take is added)
              <Select
                label="Target item"
                value={targetGuid}
                onChange={setTargetGuid}
                fullWidth
                options={[
                  { value: '', label: 'Choose a target item…' },
                  ...activeMembers.map((member, index) => ({ value: member.item_guid, label: memberLabel(member, index) })),
                ]}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Candidate (source attached as the new take)
              <Select
                label="Candidate read"
                value={candidateGuid}
                onChange={setCandidateGuid}
                fullWidth
                options={[
                  { value: '', label: 'Choose a candidate read…' },
                  ...activeMembers
                    .filter((member) => member.item_guid !== targetGuid)
                    .map((member, index) => ({ value: member.item_guid, label: memberLabel(member, index) })),
                ]}
              />
            </label>
            {createError && (
              <p role="alert" className="text-sm" style={{ color: 'var(--danger-text)' }}>
                {createError}
              </p>
            )}
          </div>
        </ConfirmDialog>
      )}
      {auditionFinding && <AuditionDialog finding={auditionFinding} onClose={() => setAuditionFindingId(null)} />}
    </Panel>
  );
}
