import type { ReactNode } from 'react';
import { EnginePanelLink } from '../engine/EnginePanelContext';
import { chapterName, context } from '../../chapterName';
import type { ManuscriptChapter, StageChapterRecommendation, StageEvidence as Evidence, StageSignal } from '../../types';
import { Button } from '../primitives/Button';
import { InsetCard } from '../primitives/InsetCard';
import { SlideOver } from '../primitives/SlideOver';
import { formatWhen, paragraphRefs } from '../production/recordingCheckText';
import type { StageDecision, StagesState } from './useStageRecommendations';
import {
  SIGNAL_STATE_LABEL,
  type StageCauseAction,
  causeText,
  evidenceValue,
  formatAge,
  isEditingSignal,
  signalName,
  stageLabel,
  verdictSentence,
} from './stageText';
type Props = {
  open: boolean;
  chapter?: ManuscriptChapter;
  recommendation?: StageChapterRecommendation;
  phase: StagesState['phase'];
  error: string;
  isPending: (decision: StageDecision) => boolean;
  busy: boolean;
  onDecide: (decision: StageDecision) => void;
  onClose: () => void;
  onCheckNow: () => void;
  /** Opens the chapter's recording check, which runs a check, links a track or offers the Whisper model. */
  onOpenCheck: () => void;
  /** Opens the chapter's editing check (editing-readiness-analysis.prd.md Phase 7), for an editing signal's own
   * `cause.resolve === 'check'` - a bare `onOpenCheck` would open the recording check instead, the wrong panel. */
  onOpenEditingCheck: () => void;
  /** Opens the manuscript at a paragraph (its index in the whole manuscript). */
  goToParagraph: (index: number) => void;
  /** Opens the finding an evidence entry names (the proofing pickups roll-up's open items), on whatever page hosts
   * this popover; undefined where there is nowhere to open it. */
  onOpenFinding?: (findingId: string) => void;
  /** Shown first, above the verdict: the Production board's status override and its links to the chapter's checks
   * (stage-navigation-and-page-replacement.prd.md Phase 2), which Home's table row used to carry. */
  status?: ReactNode;
};

/**
 * Why a chapter has the suggestion it has (chapter-stage-recommendations.prd.md Phase 5, Q11, deleted; see
 * docs/architecture/stage-recommendations.md): the verdict in a sentence, each
 * required check with its state and reason, the evidence behind it (linked to the paragraphs it names), the saved project it was read from
 * and how old that is, and, for a check that cannot tell, what resolves it. Confirm, Dismiss and Revert are here too, and Check now reads
 * the evidence again; nothing here starts an analysis (Q12).
 */
export function StageEvidence(props: Props) {
  const { open, chapter, recommendation, onClose, status } = props;
  return (
    <SlideOver open={open} title={chapterName(chapter ?? { title: recommendation?.title ?? '' }, context('Stage suggestion'))} onClose={onClose}>
      {status && <div className="mb-4 border-b border-[var(--border)] pb-4">{status}</div>}
      {recommendation && chapter ? <EvidenceBody {...props} chapter={chapter} recommendation={recommendation} /> : <Unread {...props} />}
    </SlideOver>
  );
}

function Unread({ phase, error, onCheckNow }: Props) {
  if (phase === 'loading') return <p role="status">Checking…</p>;
  // Read, and this chapter has no suggestion (it is finalized, or not narration the stage engine assesses).
  if (phase === 'ready') return <p style={{ color: 'var(--text-muted)' }}>No stage suggestion for this chapter.</p>;
  return (
    <div role="alert" className="space-y-3 text-sm">
      <p style={{ color: 'var(--danger-text)' }}>Couldn’t check this chapter{error ? `: ${error}` : '.'}</p>
      <Button variant="secondary" onClick={onCheckNow}>
        Check now
      </Button>
    </div>
  );
}

function EvidenceBody({
  chapter,
  recommendation,
  phase,
  isPending,
  busy,
  onDecide,
  onCheckNow,
  onOpenCheck,
  onOpenEditingCheck,
  goToParagraph,
  onOpenFinding,
}: Props & { chapter: ManuscriptChapter; recommendation: StageChapterRecommendation }) {
  const now = Date.now();
  const decision = (kind: StageDecision, label: string, variant: 'primary' | 'secondary' = 'secondary') => (
    <Button variant={variant} pending={isPending(kind)} disabled={busy && !isPending(kind)} onClick={() => onDecide(kind)}>
      {label}
    </Button>
  );
  const { contradiction, confirmation, target } = recommendation;
  const signals = contradiction ? contradiction.signals : recommendation.signals;
  return (
    <div className="space-y-4 text-sm">
      {/* A confirmed chapter whose new stage has no check yet: the confirmation below is the whole story. */}
      {!(recommendation.verdict === 'none' && confirmation) && <p>{verdictSentence(recommendation)}</p>}
      {(recommendation.verdict === 'recommended' || recommendation.verdict === 'dismissed') && target && (
        <div className="flex flex-wrap gap-2">
          {decision('confirm', `Confirm ${stageLabel(target)}`, 'primary')}
          {recommendation.verdict === 'recommended' && decision('dismiss', 'Dismiss')}
        </div>
      )}
      {contradiction && confirmation && (
        <Section tone="warn" title="Evidence changed since you confirmed">
          <p>
            You confirmed the move from {stageLabel(confirmation.from)} to {stageLabel(confirmation.target)} on {formatWhen(confirmation.at)}. A check since
            then is not met (below). Nothing has changed: the chapter stays in {stageLabel(confirmation.target)} unless you revert it.
          </p>
          <div>{decision('revert', `Revert to ${stageLabel(contradiction.revertTo)}`)}</div>
        </Section>
      )}
      {confirmation && !contradiction && (
        <Section title="Confirmed">
          <p>
            You confirmed the move from {stageLabel(confirmation.from)} to {stageLabel(confirmation.target)} on {formatWhen(confirmation.at)}.
            {confirmation.evidenceChanged && ' The chapter has changed since, as editing changes it; that alone raises no notice.'}
          </p>
          <div>{decision('revert', `Revert to ${stageLabel(confirmation.from)}`)}</div>
        </Section>
      )}
      <div className="space-y-3">
        <h4 className="font-semibold">{contradiction ? 'What changed' : 'What was checked'}</h4>
        {signals.length === 0 && <p style={{ color: 'var(--text-muted)' }}>No check applies to this stage yet.</p>}
        {signals.map((signal) => (
          <SignalCard
            key={signal.id}
            signal={signal}
            chapter={chapter}
            now={now}
            onCheckNow={onCheckNow}
            onOpenCheck={onOpenCheck}
            onOpenEditingCheck={onOpenEditingCheck}
            goToParagraph={goToParagraph}
            onOpenFinding={onOpenFinding}
          />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-[var(--border)] pt-3">
        <Button variant="secondary" pending={phase === 'loading'} onClick={onCheckNow}>
          Check now
        </Button>
        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
          Reads the evidence again; it starts no check.
        </span>
      </div>
    </div>
  );
}

function SignalCard({
  signal,
  chapter,
  now,
  onCheckNow,
  onOpenCheck,
  onOpenEditingCheck,
  goToParagraph,
  onOpenFinding,
}: {
  signal: StageSignal;
  chapter: ManuscriptChapter;
  now: number;
  onCheckNow: () => void;
  onOpenCheck: () => void;
  onOpenEditingCheck: () => void;
  goToParagraph: (index: number) => void;
  onOpenFinding?: (findingId: string) => void;
}) {
  const cause = causeText(signal);
  const age = formatAge(signal.basis.projectFileModTime, now);
  return (
    <InsetCard as="section" className="space-y-2" aria-label={signalName(signal)}>
      <p className="font-semibold">{signalName(signal)}</p>
      <p>
        <span className="font-semibold" style={{ color: signal.state === 'not_met' ? 'var(--danger-text)' : undefined }}>
          {SIGNAL_STATE_LABEL[signal.state]}.
        </span>{' '}
        {signal.reason}
      </p>
      {cause && (
        <div className="space-y-1">
          <p>
            <span className="font-semibold">What to do:</span> {cause.action}
          </p>
          <CauseAction
            resolve={cause.resolve}
            openLabel={isEditingSignal(signal.id) ? 'Open editing check' : 'Open recording check'}
            onCheckNow={onCheckNow}
            onOpenCheck={isEditingSignal(signal.id) ? onOpenEditingCheck : onOpenCheck}
          />
        </div>
      )}
      {signal.evidence.length > 0 && (
        <ul className="space-y-1">
          {signal.evidence.map((entry, index) => (
            <EvidenceLine key={`${entry.kind}-${index}`} entry={entry} chapter={chapter} goToParagraph={goToParagraph} onOpenFinding={onOpenFinding} />
          ))}
        </ul>
      )}
      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
        Based on the saved REAPER project, file modified {formatWhen(signal.basis.projectFileModTime)}
        {age && ` (${age})`}. Read {formatWhen(signal.computedAt)}.
      </p>
    </InsetCard>
  );
}

function CauseAction({
  resolve,
  openLabel,
  onCheckNow,
  onOpenCheck,
}: {
  resolve: StageCauseAction;
  openLabel: string;
  onCheckNow: () => void;
  onOpenCheck: () => void;
}) {
  if (resolve === 'check')
    return (
      <Button variant="secondary" onClick={onOpenCheck}>
        {openLabel}
      </Button>
    );
  if (resolve === 'engine') return <EnginePanelLink />;
  if (resolve === 'check-now')
    return (
      <Button variant="secondary" onClick={onCheckNow}>
        Check now
      </Button>
    );
  return null;
}

function EvidenceLine({
  entry,
  chapter,
  goToParagraph,
  onOpenFinding,
}: {
  entry: Evidence;
  chapter: ManuscriptChapter;
  goToParagraph: (index: number) => void;
  onOpenFinding?: (findingId: string) => void;
}) {
  const first = entry.paragraphIds?.length ? paragraphRefs(chapter, entry.paragraphIds.slice(0, 1))[0] : undefined;
  return (
    <li>
      <span className="font-semibold">{entry.label}:</span> {evidenceValue(entry.kind, entry.value)}
      {first?.index !== undefined && (
        <div className="mt-1">
          <Button size="sm" variant="secondary" onClick={() => goToParagraph(first.index!)}>
            Go to paragraph {first.number}
          </Button>
        </div>
      )}
      {entry.findingId && onOpenFinding && (
        <div className="mt-1">
          <Button size="sm" variant="secondary" onClick={() => onOpenFinding(entry.findingId!)}>
            Open this note
          </Button>
        </div>
      )}
    </li>
  );
}

function Section({ title, tone, children }: { title: string; tone?: 'warn'; children: ReactNode }) {
  return (
    <InsetCard as="section" aria-label={title} tone={tone === 'warn' ? 'warn' : 'neutral'} fill className="space-y-2">
      <p className="font-semibold" style={tone === 'warn' ? { color: 'var(--warn-text)' } : undefined}>
        {title}
      </p>
      {children}
    </InsetCard>
  );
}
