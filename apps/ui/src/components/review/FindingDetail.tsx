import { useState } from 'react';
import { useApi } from '../../api/ApiContext';
import { apiErrorMessage } from '../../api/errorMessage';
import { MAX_REVIEW_NOTE_LENGTH } from '../../api/contracts/findings';
import { usePendingAction } from '../../hooks/usePendingAction';
import type { Finding, FindingReviewStatus, ReaperStatus } from '../../types';
import { Button } from '../primitives/Button';
import { Field } from '../primitives/Field';
import { Panel } from '../primitives/Panel';
import { TooltipTarget } from '../primitives/Tooltip';
import { hasAudio, ReaperControls } from './ReaperControls';
import { TakeReviewReads } from './TakeReviewReads';
import { takeReviewEvidence } from './takeReviewFormat';
import {
  analyzerLabel,
  categoryLabel,
  chapterLabel,
  confidenceLabel,
  evidenceRows,
  formatDecidedAt,
  formatTime,
  severityLabel,
  STATUS_LABELS,
} from './findingFormat';

const STALE_MESSAGE =
  'Not saved: this finding changed since you opened it, because its check ran again. The latest version is shown now. Look at it again, then decide.';

// The decisions a narrator can make, in the order the buttons show them. "Reopen" puts a decided finding back in the queue.
const DECISIONS: Array<{ status: FindingReviewStatus; label: string; variant: 'primary' | 'ghost' }> = [
  { status: 'accepted', label: 'Accept', variant: 'primary' },
  { status: 'dismissed', label: 'Dismiss', variant: 'ghost' },
  { status: 'deferred', label: 'Defer', variant: 'ghost' },
];

function Facts({ rows, label }: { rows: Array<{ label: string; value: string }>; label: string }) {
  if (rows.length === 0) return null;
  return (
    <dl aria-label={label} className="mt-3 grid gap-x-4 gap-y-1.5 text-sm sm:grid-cols-[10rem_minmax(0,1fr)]">
      {rows.map((row) => (
        <div key={row.label} className="contents">
          <dt style={{ color: 'var(--text-muted)' }}>{row.label}</dt>
          <dd className="[overflow-wrap:anywhere]">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * One finding in full, and the narrator's decision on it (review-dashboard-and-findings-adoption.prd.md Phase 5). A decision is
 * sent with the evidence version shown here; when the host refuses it because the check ran again meanwhile (ADR 0120), the
 * latest version is fetched and shown, the typed note is kept, and the narrator is told in plain words to look again.
 * A finding with audio also has Go to, Loop and Stop in REAPER (Phase 7, ReaperControls), available while the page's REAPER
 * status says REAPER is listening. A take-review group lists its reads instead, each with its own (TakeReviewReads).
 */
export function FindingDetail({
  finding,
  hasManuscript,
  onChanged,
  goToManuscript,
  goToStoryBible,
  reaperStatus,
  onReaperStatusChange,
}: {
  finding: Finding;
  hasManuscript: boolean;
  /** Whether REAPER is listening, as the page last read it; undefined until the first answer. */
  reaperStatus: ReaperStatus | undefined;
  onReaperStatusChange: () => Promise<void>;
  /** The finding as the host now holds it, after a decision or a refresh; `decided` is true when a decision was saved. */
  onChanged: (finding: Finding, decided: boolean) => void;
  goToManuscript: (chapter: string, paragraph?: number) => void;
  goToStoryBible: (entityId: string) => void;
}) {
  const api = useApi();
  const [note, setNote] = useState(finding.review.note ?? '');
  const [problem, setProblem] = useState<string>();
  const [saved, setSaved] = useState<string>();
  const action = usePendingAction();
  const noteTooLong = [...note].length > MAX_REVIEW_NOTE_LENGTH;

  const decide = (status: FindingReviewStatus) =>
    action.run(status, async () => {
      setProblem(undefined);
      setSaved(undefined);
      const shownVersion = finding.evidence_version ?? '';
      try {
        const decided = await api.findingsReview({ id: finding.id, evidenceVersion: shownVersion, status, note: note.trim() });
        onChanged(decided, true);
        setSaved(status === 'unreviewed' ? 'Put back in the queue.' : `Saved as ${STATUS_LABELS[status].toLowerCase()}.`);
      } catch (error) {
        await explainRefusal(error, shownVersion);
      }
    });

  // The host says why it refused in its own words; whether the evidence changed is checked here against the finding itself, so the
  // page never depends on the wording of an error message.
  const explainRefusal = async (error: unknown, shownVersion: string) => {
    const current = await api.findingsGet(finding.id).catch(() => undefined);
    if (current && (current.evidence_version ?? '') !== shownVersion) {
      onChanged(current, false);
      setProblem(STALE_MESSAGE);
      return;
    }
    setProblem(`Not saved: ${apiErrorMessage(error)}`);
  };

  const chapterId = finding.manuscript?.chapter_id;
  const openManuscript = () =>
    action.run('manuscript', async () => {
      if (!chapterId) return;
      const paragraphId = finding.manuscript?.span?.paragraph_id;
      let paragraph: number | undefined;
      if (paragraphId) {
        try {
          paragraph = (await api.manuscriptParagraphs(chapterId)).find((candidate) => candidate.id === paragraphId)?.index;
        } catch {
          // The chapter still opens; only the exact line is lost, and the manuscript page reports its own load failure.
          paragraph = undefined;
        }
      }
      goToManuscript(chapterId, paragraph);
    });
  const manuscriptBlocked = !hasManuscript
    ? 'Import a manuscript to open this finding in it.'
    : !chapterId
      ? 'This finding has no chapter to open.'
      : undefined;
  const entityId = typeof finding.evidence?.entity_id === 'string' ? finding.evidence.entity_id : undefined;

  const whatRows = [
    ...(finding.manuscript?.expected
      ? [{ label: finding.category === 'transcript_discrepancy' ? 'Script says' : 'In the script', value: finding.manuscript.expected }]
      : []),
    ...(finding.manuscript?.recorded ? [{ label: 'Recording has', value: finding.manuscript.recorded }] : []),
  ];
  const whereRows = [
    { label: 'Chapter', value: chapterLabel(finding) },
    ...(finding.time_range ? [{ label: 'Project time', value: formatTime(finding.time_range.start) }] : []),
    { label: 'Found by', value: analyzerLabel(finding.analyzer) },
    { label: 'Severity', value: severityLabel(finding.severity) },
  ];
  const decidedAt = formatDecidedAt(finding.review.timestamp);
  // A take-review group has several reads, each in its own place: they are listed with their own REAPER controls.
  const reads = takeReviewEvidence(finding);
  const decided = finding.review.status !== 'unreviewed';

  return (
    <Panel title={categoryLabel(finding.category)}>
      {finding.not_in_latest_run && (
        <p className="mt-3 rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-sm">
          The latest run did not find this again. It is kept here with your decision so nothing you decided is lost.
        </p>
      )}
      <Facts label="What was found" rows={whatRows} />
      <Facts label="Where" rows={whereRows} />
      <h3 className="mt-4 text-sm font-semibold">Evidence</h3>
      <Facts label="Evidence" rows={evidenceRows(finding)} />
      <p className="mt-3 text-sm">
        <span style={{ color: 'var(--text-muted)' }}>Confidence: </span>
        <b>{confidenceLabel(finding.confidence)}</b>. {finding.confidence_reason}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <TooltipTarget text={manuscriptBlocked ?? 'Open the manuscript at this line'}>
          <Button variant="ghost" onClick={() => void openManuscript()} disabled={Boolean(manuscriptBlocked)} pending={action.isPending('manuscript')}>
            Show in manuscript
          </Button>
        </TooltipTarget>
        {entityId && hasManuscript && (
          <Button variant="ghost" onClick={() => goToStoryBible(entityId)}>
            Open in Story Bible
          </Button>
        )}
      </div>
      {reads ? (
        <TakeReviewReads finding={finding} evidence={reads} status={reaperStatus} onStatusChange={onReaperStatusChange} />
      ) : (
        hasAudio(finding) && <ReaperControls finding={finding} status={reaperStatus} onStatusChange={onReaperStatusChange} />
      )}

      <h3 className="mt-5 text-sm font-semibold">Decision</h3>
      <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
        {decided ? `${STATUS_LABELS[finding.review.status]}${decidedAt ? ` on ${decidedAt}` : ''}.` : 'Not decided yet.'}
      </p>
      <div className="mt-3">
        <Field
          label="Note (optional)"
          textarea
          value={note}
          onChange={setNote}
          error={noteTooLong ? `A note can be at most ${MAX_REVIEW_NOTE_LENGTH} characters.` : undefined}
        />
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {DECISIONS.map((decision) => (
          <Button
            key={decision.status}
            variant={decision.variant}
            onClick={() => void decide(decision.status)}
            pending={action.isPending(decision.status)}
            disabled={noteTooLong || action.isBlockedFor(decision.status)}
          >
            {decision.label}
          </Button>
        ))}
        {decided && (
          <Button
            variant="ghost"
            onClick={() => void decide('unreviewed')}
            pending={action.isPending('unreviewed')}
            disabled={action.isBlockedFor('unreviewed')}
          >
            Reopen
          </Button>
        )}
      </div>
      {problem && (
        <p role="alert" className="mt-3 text-sm" style={{ color: 'var(--danger-text)' }}>
          {problem}
        </p>
      )}
      <p role="status" className="mt-3 text-sm empty:hidden">
        {saved}
      </p>
    </Panel>
  );
}
