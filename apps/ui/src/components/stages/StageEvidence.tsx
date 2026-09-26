import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { chapterName, context } from '../../chapterName';
import type { ManuscriptChapter, StageChapterRecommendation, StageEvidence as Evidence, StageSignal } from '../../types';
import { Button } from '../primitives/Button';
import { SlideOver } from '../primitives/SlideOver';
import { formatWhen, paragraphRefs } from '../home/recordingCheckText';
import type { StageDecision, StagesState } from './useStageRecommendations';
import { CAUSE_TEXT, SIGNAL_STATE_LABEL, type StageCauseAction, evidenceValue, formatAge, signalName, stageLabel, verdictSentence } from './stageText';

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
  /** Opens the manuscript at a paragraph (its index in the whole manuscript). */
  goToParagraph: (index: number) => void;
};

/**
 * Why a chapter has the suggestion it has (docs/prds/chapter-stage-recommendations.prd.md Phase 5, Q11): the verdict in a sentence, each
 * required check with its state and reason, the evidence behind it (linked to the paragraphs it names), the saved project it was read from
 * and how old that is, and, for a check that cannot tell, what resolves it. Confirm, Dismiss and Revert are here too, and Check now reads
 * the evidence again; nothing here starts an analysis (Q12).
 */
export function StageEvidence(props: Props) {
  const { open, chapter, recommendation, onClose } = props;
  return (
    <SlideOver open={open} title={chapterName(chapter ?? { title: recommendation?.title ?? '' }, context('Stage suggestion'))} onClose={onClose}>
      {recommendation && chapter ? <EvidenceBody {...props} chapter={chapter} recommendation={recommendation} /> : <Unread {...props} />}
    </SlideOver>
  );
}

function Unread({ phase, error, onCheckNow }: Props) {
  if (phase === 'loading') return <p role="status">Checking…</p>;
  return (
    <div role="alert" className="space-y-3 text-sm">
      <p style={{ color: 'var(--danger-text)' }}>Couldn’t check this chapter{error ? `: ${error}` : '.'}</p>
      <Button variant="ghost" onClick={onCheckNow}>
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
  goToParagraph,
}: Props & { chapter: ManuscriptChapter; recommendation: StageChapterRecommendation }) {
  const now = Date.now();
  const decision = (kind: StageDecision, label: string, variant: 'primary' | 'ghost' = 'ghost') => (
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
            goToParagraph={goToParagraph}
          />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-[var(--border)] pt-3">
        <Button variant="ghost" pending={phase === 'loading'} onClick={onCheckNow}>
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
  goToParagraph,
}: {
  signal: StageSignal;
  chapter: ManuscriptChapter;
  now: number;
  onCheckNow: () => void;
  onOpenCheck: () => void;
  goToParagraph: (index: number) => void;
}) {
  const cause = signal.cause ? CAUSE_TEXT[signal.cause] : undefined;
  const age = formatAge(signal.basis.projectFileModTime, now);
  return (
    <section className="space-y-2 rounded-md border border-[var(--border)] px-3 py-2" aria-label={signalName(signal)}>
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
          <CauseAction resolve={cause.resolve} onCheckNow={onCheckNow} onOpenCheck={onOpenCheck} />
        </div>
      )}
      {signal.evidence.length > 0 && (
        <ul className="space-y-1">
          {signal.evidence.map((entry, index) => (
            <EvidenceLine key={`${entry.kind}-${index}`} entry={entry} chapter={chapter} goToParagraph={goToParagraph} />
          ))}
        </ul>
      )}
      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
        Based on the saved REAPER project, file modified {formatWhen(signal.basis.projectFileModTime)}
        {age && ` (${age})`}. Read {formatWhen(signal.computedAt)}.
      </p>
    </section>
  );
}

function CauseAction({ resolve, onCheckNow, onOpenCheck }: { resolve: StageCauseAction; onCheckNow: () => void; onOpenCheck: () => void }) {
  if (resolve === 'check')
    return (
      <Button variant="ghost" onClick={onOpenCheck}>
        Open recording check
      </Button>
    );
  if (resolve === 'tracks')
    return (
      <Link to="/tracks" className="font-semibold underline">
        Open Tracks
      </Link>
    );
  if (resolve === 'check-now')
    return (
      <Button variant="ghost" onClick={onCheckNow}>
        Check now
      </Button>
    );
  return null;
}

function EvidenceLine({ entry, chapter, goToParagraph }: { entry: Evidence; chapter: ManuscriptChapter; goToParagraph: (index: number) => void }) {
  const first = entry.paragraphIds?.length ? paragraphRefs(chapter, entry.paragraphIds.slice(0, 1))[0] : undefined;
  return (
    <li>
      <span className="font-semibold">{entry.label}:</span> {evidenceValue(entry.kind, entry.value)}
      {first?.index !== undefined && (
        <div className="mt-1">
          <Button variant="ghost" className="px-3 py-1" onClick={() => goToParagraph(first.index!)}>
            Go to paragraph {first.number}
          </Button>
        </div>
      )}
    </li>
  );
}

function Section({ title, tone, children }: { title: string; tone?: 'warn'; children: ReactNode }) {
  return (
    <section
      aria-label={title}
      className="space-y-2 rounded-md border px-3 py-2"
      style={{ borderColor: tone === 'warn' ? 'var(--warn)' : 'var(--border)', background: 'var(--surface-2)' }}
    >
      <p className="font-semibold" style={tone === 'warn' ? { color: 'var(--warn-text)' } : undefined}>
        {title}
      </p>
      {children}
    </section>
  );
}
