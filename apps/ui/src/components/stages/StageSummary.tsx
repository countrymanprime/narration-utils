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

/** The line above the breakdown table: what the suggestions are read from, the error when they could not be, and Check now. */
export function StageCheckLine({ state, onCheckNow }: { state: StagesState; onCheckNow: () => void }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 py-2 text-xs">
      {state.phase === 'error' ? (
        <p role="alert" style={{ color: 'var(--danger-text)' }}>
          Couldn’t check stage suggestions: {state.error}
        </p>
      ) : (
        <p style={{ color: 'var(--text-muted)' }}>
          Stage suggestions come from the saved REAPER project and the last recording checks. Nothing changes until you confirm.
        </p>
      )}
      <Button variant="ghost" className="px-3 py-1" pending={state.phase === 'loading'} onClick={onCheckNow}>
        Check now
      </Button>
    </div>
  );
}
