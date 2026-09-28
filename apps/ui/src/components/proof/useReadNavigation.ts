import { useState } from 'react';
import { useApi } from '../../api/ApiContext';
import { apiErrorMessage } from '../../api/errorMessage';
import { usePendingAction } from '../../hooks/usePendingAction';
import type { Finding, FindingNavigation, ReaperStatus } from '../../types';
import { doneMessage } from './ReaperControls';

const CHECKING = 'Checking whether REAPER is connected…';

/**
 * Go to, Loop and Stop loop for the reads of a finding that groups several (a take-review group, and a take comparison of one):
 * each read is sent by its index in `evidence.members` (FindingsGoToRead, FindingsLoopRead, ADR 0121), one request at a time,
 * with REAPER's answer or refusal kept for the page to announce. `connectionReason` is why nothing can be sent now, if anything.
 */
export function useReadNavigation(finding: Finding, status: ReaperStatus | undefined, onStatusChange: () => Promise<void>) {
  const api = useApi();
  const action = usePendingAction();
  const [problem, setProblem] = useState<string>();
  const [done, setDone] = useState<string>();
  const connected = status?.connection === 'connected';

  const send = (key: string, request: () => Promise<FindingNavigation>) =>
    action.run(key, async () => {
      setProblem(undefined);
      setDone(undefined);
      try {
        const result = await request();
        if (result.outcome === 'refused') setProblem(result.message);
        else setDone(doneMessage(result));
      } catch (error) {
        setProblem(`REAPER was not asked: ${apiErrorMessage(error)}`);
      }
      await onStatusChange();
    });

  return {
    action,
    problem,
    setProblem,
    done,
    setDone,
    connectionReason: status === undefined ? CHECKING : connected ? undefined : status.message,
    looping: connected && status?.loopingFindingId === finding.id,
    goTo: (read: number) => send(`goto-${read}`, () => api.findingsGoToRead(finding.id, read)),
    loop: (read: number) => send(`loop-${read}`, () => api.findingsLoopRead(finding.id, read)),
    stop: () => send('stop', () => api.findingsStopLoop()),
  };
}
