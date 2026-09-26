import { useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPause, faPlay } from '@fortawesome/free-solid-svg-icons';
import { useApi } from '../../api/ApiContext';
import { apiErrorMessage } from '../../api/errorMessage';
import { usePendingAction } from '../../hooks/usePendingAction';
import type { Finding, FindingReviewStatus, ReaperStatus } from '../../types';
import { Button } from '../primitives/Button';
import { confidenceLabel, formatTime, STATUS_LABELS } from '../review/findingFormat';
import { hasAudio, ReaperControls } from '../review/ReaperControls';
import { useRangePlayer } from '../tracks/useRangePlayer';
import { EDITING_CLASS_LABEL, candidateAudition, candidateClass, candidateReason } from './editingCheckText';

const STALE_MESSAGE = 'This candidate changed since it was shown, because the check ran again. Look at it again, then decide.';

const DECISIONS: Array<{ status: FindingReviewStatus; label: string; variant: 'primary' | 'ghost' }> = [
  { status: 'accepted', label: 'Accept', variant: 'primary' },
  { status: 'dismissed', label: 'Dismiss', variant: 'ghost' },
  { status: 'deferred', label: 'Defer', variant: 'ghost' },
];

/**
 * One editing candidate (editing-readiness-analysis.prd.md Phase 7): its time range, class, confidence and reason,
 * a Hear control that plays its own source file around the candidate's source-relative range with a pre-roll
 * (`useRangePlayer`, the same range player the take-review audition dialog uses over `/media`), Accept, Dismiss and
 * Defer through RD-4's `findingsReview` (review-dashboard-and-findings-adoption.prd.md Phase 4, ADR 0120 - a
 * decision refused because the check ran again since is shown as `STALE_MESSAGE`, not a bare error), and Go to /
 * Loop in REAPER (RD Phase 7) through the same `ReaperControls` the Review page uses, which is already off with its
 * own reason until a bridge is connected.
 */
export function EditingCandidateRow({
  finding,
  reaperStatus,
  onReaperStatusChange,
  onChanged,
}: {
  finding: Finding;
  reaperStatus: ReaperStatus | undefined;
  onReaperStatusChange: () => Promise<void>;
  onChanged: (finding: Finding) => void;
}) {
  const api = useApi();
  const action = usePendingAction();
  const [problem, setProblem] = useState<string>();
  const player = useRangePlayer(api.mediaUrl);
  const audition = candidateAudition(finding);
  const isPlayingThis = player.isPlaying && player.activeRange?.sourceFile === audition?.sourceFile && player.activeRange?.rangeStart === audition?.rangeStart;

  const decide = (status: FindingReviewStatus) =>
    action.run(status, async () => {
      setProblem(undefined);
      const shownVersion = finding.evidence_version ?? '';
      try {
        const decided = await api.findingsReview({ id: finding.id, evidenceVersion: shownVersion, status, note: finding.review.note ?? '' });
        onChanged(decided);
      } catch (error) {
        const current = await api.findingsGet(finding.id).catch(() => undefined);
        if (current && (current.evidence_version ?? '') !== shownVersion) {
          onChanged(current);
          setProblem(STALE_MESSAGE);
        } else {
          setProblem(`Not saved: ${apiErrorMessage(error)}`);
        }
      }
    });

  const decided = finding.review.status !== 'unreviewed';
  const cls = candidateClass(finding);
  const toggleHear = () => {
    if (isPlayingThis) {
      player.stop();
    } else if (audition) {
      player.play(audition);
    }
  };

  return (
    <section
      className="space-y-2 rounded-md border border-[var(--border)] px-3 py-2"
      aria-label={`${cls ? EDITING_CLASS_LABEL[cls] : 'Candidate'} at ${formatTime(finding.time_range?.start ?? 0)}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-semibold">
          {cls ? EDITING_CLASS_LABEL[cls] : 'Candidate'} · {formatTime(finding.time_range?.start ?? 0)}
        </p>
        <Button
          variant="ghost"
          className="px-3 py-1"
          onClick={toggleHear}
          disabled={!audition}
          aria-label={
            !audition
              ? `No audio to hear for ${cls ? EDITING_CLASS_LABEL[cls] : 'this candidate'}`
              : isPlayingThis
                ? `Pause ${cls ? EDITING_CLASS_LABEL[cls] : 'candidate'}`
                : `Hear ${cls ? EDITING_CLASS_LABEL[cls] : 'candidate'}`
          }
        >
          <FontAwesomeIcon icon={isPlayingThis ? faPause : faPlay} /> {audition ? 'Hear' : 'No audio to hear'}
        </Button>
      </div>
      <p className="text-sm">
        <span style={{ color: 'var(--text-muted)' }}>Confidence: </span>
        {confidenceLabel(finding.confidence)}. {candidateReason(finding)}
      </p>
      {player.loadError && isPlayingThis && (
        <p role="alert" className="text-sm" style={{ color: 'var(--danger-text)' }}>
          This candidate&rsquo;s audio couldn&rsquo;t be played. Check that its source file is still where the project expects it.
        </p>
      )}
      <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
        {decided ? `${STATUS_LABELS[finding.review.status]}.` : 'Not decided yet.'}
      </p>
      <div className="flex flex-wrap gap-2">
        {DECISIONS.map((decision) => (
          <Button
            key={decision.status}
            variant={decision.variant}
            className="px-3 py-1"
            onClick={() => void decide(decision.status)}
            pending={action.isPending(decision.status)}
            disabled={action.isBlockedFor(decision.status)}
          >
            {decision.label}
          </Button>
        ))}
        {decided && (
          <Button
            variant="ghost"
            className="px-3 py-1"
            onClick={() => void decide('unreviewed')}
            pending={action.isPending('unreviewed')}
            disabled={action.isBlockedFor('unreviewed')}
          >
            Reopen
          </Button>
        )}
      </div>
      {problem && (
        <p role="alert" className="text-sm" style={{ color: 'var(--danger-text)' }}>
          {problem}
        </p>
      )}
      {hasAudio(finding) && <ReaperControls finding={finding} status={reaperStatus} onStatusChange={onReaperStatusChange} />}
    </section>
  );
}
