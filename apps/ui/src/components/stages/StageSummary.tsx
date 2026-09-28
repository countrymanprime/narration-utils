import { Button } from '../primitives/Button';
import { StatusBadge } from '../primitives/StatusBadge';
import type { StagesState } from './useStageRecommendations';
import { plural, summarize } from './stageText';

// A chip is THE pill made a button (StatusBadge, ADR 0600); its tone says what it counts.

/**
 * The estimate card's summary of the stage suggestions (chapter-stage-recommendations.prd.md Phase 5, deleted; see
 * docs/architecture/stage-recommendations.md), seen while the breakdown is
 * still collapsed: how many chapters have a suggestion, how many have evidence that changed since they were confirmed, or that they could
 * not be checked. Each chip opens the breakdown, where the rows are. Nothing shows while the first read runs or when there is nothing to say.
 */
export function StageSummaryChips({ state, onShow }: { state: StagesState; onShow: () => void }) {
  if (state.phase === 'error')
    return (
      <div className="mt-2 flex flex-wrap gap-2">
        <StatusBadge tone="danger" look="outline" label="Couldn’t check stage suggestions" onClick={onShow} />
      </div>
    );
  const { suggested, changed } = summarize([...state.byChapter.values()]);
  if (suggested === 0 && changed === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {suggested > 0 && <StatusBadge tone="accent" label={plural(suggested, 'chapter has a suggestion', 'chapters have a suggestion')} onClick={onShow} />}
      {changed > 0 && (
        <StatusBadge tone="warning" look="outline" label={plural(changed, 'chapter’s evidence changed', 'chapters’ evidence changed')} onClick={onShow} />
      )}
    </div>
  );
}

/**
 * The line above the breakdown table: shown only when the last read failed, with the reason and a retry
 * (docs/prds/home-stage-check-line.prd.md Phase 1). Every other read happens by itself, so there is nothing to say
 * and no idle button when the read succeeded.
 */
export function StageCheckLine({ state, onCheckNow }: { state: StagesState; onCheckNow: () => void }) {
  // `refresh` keeps the previous error on screen while a retry is loading (useStageRecommendations.ts), so Try again
  // shows its pending spinner instead of the line vanishing mid-retry; the initial mount read has no error yet.
  if (state.phase === 'ready' || !state.error) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 py-2 text-xs">
      <p role="alert" style={{ color: 'var(--danger-text)' }}>
        Couldn’t check stage suggestions: {state.error}
      </p>
      <Button variant="ghost" className="px-3 py-1" pending={state.phase === 'loading'} onClick={onCheckNow}>
        Try again
      </Button>
    </div>
  );
}
