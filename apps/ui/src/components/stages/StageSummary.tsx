import { Button } from '../primitives/Button';
import type { StagesState } from './useStageRecommendations';
import { plural, summarize } from './stageText';

// A chip is the Button primitive a size down; its colours say what it counts.
const CHIP = 'px-2.5 py-1 text-[0.78rem]';

/**
 * The estimate card's summary of the stage suggestions (docs/prds/chapter-stage-recommendations.prd.md Phase 5), seen while the breakdown is
 * still collapsed: how many chapters have a suggestion, how many have evidence that changed since they were confirmed, or that they could
 * not be checked. Each chip opens the breakdown, where the rows are. Nothing shows while the first read runs or when there is nothing to say.
 */
export function StageSummaryChips({ state, onShow }: { state: StagesState; onShow: () => void }) {
  if (state.phase === 'error')
    return (
      <div className="mt-2 flex flex-wrap gap-2">
        <Button variant="ghost" className={CHIP} style={{ borderColor: 'var(--danger)', color: 'var(--danger-text)' }} onClick={onShow}>
          Couldn’t check stage suggestions
        </Button>
      </div>
    );
  const { suggested, changed } = summarize([...state.byChapter.values()]);
  if (suggested === 0 && changed === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {suggested > 0 && (
        <Button
          variant="ghost"
          className={CHIP}
          style={{ borderColor: 'var(--accent)', color: 'var(--accent-strong)', background: 'var(--accent-soft)' }}
          onClick={onShow}
        >
          {plural(suggested, 'chapter has a suggestion', 'chapters have a suggestion')}
        </Button>
      )}
      {changed > 0 && (
        <Button variant="ghost" className={CHIP} style={{ borderColor: 'var(--warn)', color: 'var(--warn-text)' }} onClick={onShow}>
          {plural(changed, 'chapter’s evidence changed', 'chapters’ evidence changed')}
        </Button>
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
