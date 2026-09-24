import { useCallback, useEffect, useRef, useState } from 'react';
import { useApi } from '../../api/ApiContext';
import { apiErrorMessage, describeApiError } from '../../api/errorMessage';
import { usePendingAction } from '../../hooks/usePendingAction';
import type { ChapterStatus, StageChapterRecommendation, StageDecisionResult } from '../../types';
import type { Notify } from '../primitives/Toast';
import { stageLabel } from './stageText';

export type StageDecision = 'confirm' | 'dismiss' | 'revert';

/**
 * The chapters' stage suggestions as last read (docs/prds/chapter-stage-recommendations.prd.md Phase 5). `loading` keeps the rows of the
 * previous read on screen while a new one runs; `error` has none, so every row says it could not check rather than going quiet.
 */
export type StagesState = {
  phase: 'loading' | 'ready' | 'error';
  byChapter: ReadonlyMap<string, StageChapterRecommendation>;
  error: string;
};

const sentence = (text: string) => `${text.charAt(0).toUpperCase()}${text.slice(1)}${/[.!?]$/.test(text) ? '' : '.'}`;

function decidedMessage(decision: StageDecision, chapter: StageChapterRecommendation, previous: StageChapterRecommendation): string {
  if (decision === 'confirm') return `${chapter.title} moved to ${stageLabel(chapter.from)}.`;
  if (decision === 'revert') return `${chapter.title} moved back to ${stageLabel(chapter.from)}.`;
  return `Suggestion to move ${chapter.title} to ${previous.target ? stageLabel(previous.target) : 'the next stage'} dismissed.`;
}

/**
 * Reads every chapter's suggestion on mount, whenever `refreshKey` changes (a manuscript import, a recording check that finished) and on
 * `refresh` (Check now, a status changed by hand): evaluated on read, never stored (D1, Q5). `decide` sends Confirm, Dismiss or Revert with
 * the basis the narrator saw; a refusal (the evidence moved meanwhile) is said and the suggestions are read again. `onStatus` hears the
 * chapter status a Confirm or Revert set, so the caller's own chapter list follows.
 */
export function useStageRecommendations({
  refreshKey,
  notify,
  onStatus,
}: {
  refreshKey: string;
  notify: Notify;
  onStatus: (chapterId: string, status: ChapterStatus) => void;
}) {
  const api = useApi();
  const [state, setState] = useState<StagesState>({ phase: 'loading', byChapter: new Map(), error: '' });
  const latest = useRef(0);
  const actions = usePendingAction();

  const refresh = useCallback(async () => {
    const request = ++latest.current;
    setState((current) => ({ ...current, phase: 'loading' }));
    try {
      const { chapters } = await api.stageRecommendations();
      if (request !== latest.current) return;
      setState({ phase: 'ready', byChapter: new Map(chapters.map((chapter) => [chapter.chapterId, chapter])), error: '' });
    } catch (error) {
      if (request !== latest.current) return;
      setState({ phase: 'error', byChapter: new Map(), error: apiErrorMessage(error) });
    }
  }, [api]);

  useEffect(() => {
    void refresh();
  }, [refresh, refreshKey]);

  const send = (decision: StageDecision, chapter: StageChapterRecommendation): Promise<StageDecisionResult> => {
    if (decision === 'revert') return api.stageRevert(chapter.chapterId);
    if (!chapter.target || !chapter.basisKey) return Promise.reject(new Error(`${chapter.title} has no suggestion to act on.`));
    return decision === 'confirm'
      ? api.stageConfirm(chapter.chapterId, chapter.target, chapter.basisKey)
      : api.stageDismiss(chapter.chapterId, chapter.target, chapter.basisKey);
  };

  const decide = (decision: StageDecision, chapter: StageChapterRecommendation) =>
    actions.run(`${decision}:${chapter.chapterId}`, async () => {
      try {
        const result = await send(decision, chapter);
        if (result.status === 'refused') {
          notify(sentence(result.message), 'error');
          await refresh();
          return;
        }
        const updated = result.chapter;
        setState((current) => ({ ...current, byChapter: new Map(current.byChapter).set(updated.chapterId, updated) }));
        if (updated.from !== chapter.from) onStatus(updated.chapterId, updated.from);
        notify(decidedMessage(decision, updated, chapter));
      } catch (error) {
        notify(describeApiError(error), 'error');
      }
    });

  return {
    state,
    refresh,
    decide,
    /** True while this decision of this chapter is being sent. */
    isPending: (decision: StageDecision, chapterId: string) => actions.isPending(`${decision}:${chapterId}`),
    /** True while any decision is being sent: the others wait, so two never race on the same files. */
    busy: actions.isBusy,
  };
}
