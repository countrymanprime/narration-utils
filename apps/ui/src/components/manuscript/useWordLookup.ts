import { useCallback, useState } from 'react';
import { useApi } from '../../api/ApiContext';
import { describeApiError } from '../../api/errorMessage';
import { useAssetInstall } from '../../hooks/useAssetInstall';
import type { usePendingAction } from '../../hooks/usePendingAction';
import type { Notify } from '../primitives/Toast';
import type { DictionaryAnswer, DictionaryGate } from './WordLookup';

/** The pending key a lookup runs under, in the reader's one group of selection actions (ADR 0075: one at a time). */
export const LOOKUP_ACTION = 'lookup';

/**
 * The reader's Look up (story-bible-and-import-ux-briefs.prd.md Phase 8): asks the host's offline dictionary about one word and keeps what
 * the reader shows next, either the answer (for the look-up panel) or the first-use gate (for the download question). Nothing is downloaded
 * until the narrator confirms that question; once the download succeeds, the same word is looked up again, so the narrator gets the answer
 * they asked for. A lookup that fails is a toast, and the selection stays so they can try again.
 */
export function useWordLookup({ notify, actions }: { notify: Notify; actions: ReturnType<typeof usePendingAction> }) {
  const api = useApi();
  // The last answer stays after the panel closes, so the panel still has its words while it slides out.
  const [answer, setAnswer] = useState<DictionaryAnswer>();
  const [answerOpen, setAnswerOpen] = useState(false);
  const [gate, setGate] = useState<{ word: string; result: DictionaryGate }>();
  const { run } = actions;

  const install = useAssetInstall({
    start: () => (gate ? api.assetsInstall('dictionary', gate.result.dictionary.id) : Promise.reject(new Error('Look a word up first.'))),
    state: (jobId) => api.assetsInstallState(jobId),
    cancel: (jobId) => api.assetsInstallCancel(jobId),
    // The answer opening is how the narrator learns the download finished: the question they asked is answered.
    onSuccess: async () => {
      const word = gate?.word;
      setGate(undefined);
      install.reset();
      if (word) await lookUp(word);
    },
  });
  const resetInstall = install.reset;

  /** Looks one word up. Resolves to true when the reader moved on to the answer or the download question, so the selection can go. */
  const lookUp = useCallback(
    async (word: string): Promise<boolean> =>
      (await run(LOOKUP_ACTION, async () => {
        try {
          const result = await api.systemLookup(word);
          if (result.status === 'ok') {
            setAnswer(result);
            setAnswerOpen(true);
          } else {
            resetInstall();
            setGate({ word, result });
          }
          return true;
        } catch (error) {
          notify(describeApiError(error), 'error');
          return false;
        }
      })) ?? false,
    [api, notify, resetInstall, run],
  );

  const closeGate = useCallback(() => {
    setGate(undefined);
    resetInstall();
  }, [resetInstall]);

  return { lookUp, answer, answerOpen, closeAnswer: () => setAnswerOpen(false), gate: gate?.result, install, closeGate };
}
