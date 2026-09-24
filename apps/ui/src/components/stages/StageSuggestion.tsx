import type { ReactNode } from 'react';
import type { StageChapterRecommendation } from '../../types';
import { Button } from '../primitives/Button';
import type { StageDecision, StagesState } from './useStageRecommendations';
import { stageLabel, verdictLine } from './stageText';

/** The small buttons of a row: the table has twelve of them, so they are a size down from the page's. */
const SMALL = 'px-2 py-0.5 text-[0.75rem]';

/**
 * A chapter's stage suggestion under its status (docs/prds/chapter-stage-recommendations.prd.md Phase 5): the verdict in a few words,
 * Confirm and Dismiss when a move is suggested, Revert after a confirmation (and prominently when the evidence has since changed), and Why,
 * which opens the evidence. It never changes a status on its own; the status select above it stays the narrator's override. Every button
 * names its chapter, so twelve rows of them can be told apart.
 */
export function StageSuggestion({
  title,
  recommendation,
  phase,
  isPending,
  busy,
  onDecide,
  onWhy,
}: {
  title: string;
  recommendation?: StageChapterRecommendation;
  phase: StagesState['phase'];
  isPending: (decision: StageDecision) => boolean;
  busy: boolean;
  onDecide: (decision: StageDecision) => void;
  onWhy: () => void;
}) {
  if (!recommendation) {
    if (phase === 'loading') return <Note>Checking…</Note>;
    if (phase === 'error') return <Note tone="danger">Couldn’t check</Note>;
    return null;
  }
  const decision = (kind: StageDecision, label: string, visible: string, variant: 'primary' | 'ghost' = 'ghost') => (
    <Button variant={variant} className={SMALL} aria-label={label} pending={isPending(kind)} disabled={busy && !isPending(kind)} onClick={() => onDecide(kind)}>
      {visible}
    </Button>
  );
  const why = (
    <Button variant="ghost" className={SMALL} aria-label={`Why: ${title}`} onClick={onWhy}>
      Why
    </Button>
  );

  const { contradiction, confirmation } = recommendation;
  if (contradiction) {
    return (
      <Block>
        <span className="rounded border px-1.5 py-0.5 font-semibold" style={{ borderColor: 'var(--warn)', color: 'var(--warn-text)' }}>
          Evidence changed since you confirmed
        </span>
        <Actions>
          {decision('revert', `Revert to ${stageLabel(contradiction.revertTo)}: ${title}`, `Revert to ${stageLabel(contradiction.revertTo)}`)}
          {why}
        </Actions>
      </Block>
    );
  }

  const line = verdictLine(recommendation);
  if (!line) {
    if (!confirmation) return null;
    return (
      <Block>
        <Note>Confirmed from {stageLabel(confirmation.from)}</Note>
        <Actions>
          {decision('revert', `Revert to ${stageLabel(confirmation.from)}: ${title}`, 'Revert')}
          {why}
        </Actions>
      </Block>
    );
  }

  if (recommendation.verdict === 'recommended' && recommendation.target) {
    const target = stageLabel(recommendation.target);
    return (
      <Block>
        <span className="rounded px-1.5 py-0.5 font-semibold" style={{ background: 'var(--accent-soft)', color: 'var(--accent-strong)' }}>
          {line}
        </span>
        <Actions>
          {decision('confirm', `Confirm ${title} as ${target}`, 'Confirm', 'primary')}
          {decision('dismiss', `Dismiss the suggestion for ${title}`, 'Dismiss')}
          {why}
        </Actions>
      </Block>
    );
  }

  return (
    <Block>
      <Note>{line}</Note>
      <Actions>{why}</Actions>
    </Block>
  );
}

function Block({ children }: { children: ReactNode }) {
  return <div className="mt-1.5 flex max-w-[16rem] flex-col items-start gap-1 text-xs">{children}</div>;
}

function Actions({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap gap-1">{children}</div>;
}

function Note({ children, tone }: { children: ReactNode; tone?: 'danger' }) {
  return (
    <span className="mt-1 block text-xs" style={{ color: tone === 'danger' ? 'var(--danger-text)' : 'var(--text-muted)' }}>
      {children}
    </span>
  );
}
