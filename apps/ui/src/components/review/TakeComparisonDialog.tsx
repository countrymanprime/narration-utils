import { useEffect, useRef, useState } from 'react';
import { useApi } from '../../api/ApiContext';
import { apiErrorMessage } from '../../api/errorMessage';
import type { TakeComparisonJob } from '../../types';
import { Dialog } from '../primitives/Dialog';
import { WorkDialog } from '../primitives/WorkDialog';

/** How often a running comparison is read: the host reads the sidecar's progress file four times as often. */
const POLL_MS = 500;

const ANOTHER_GROUP = 'the takes of another group are being compared. Wait until that comparison ends, then compare these.';

/**
 * Compare takes (take-review-pickups-duplicates-take-intelligence.prd.md Phase 10, user flow step 5): opening it starts the
 * comparison of one take-review group as a host job, which transcribes each read of the group again and measures it, so it
 * shows its real progress with Cancel (ADR 0015) and may be left running in the background, since the app says when it ends
 * (ADR 0076). A comparison already running (of this group or another) is shown as it is rather than started again. A refusal
 * (the group changed, the manuscript has no such chapter any more) is shown in the host's words. `onClose` gets the job as it
 * ended, or undefined when nothing ran to an end here.
 */
export function TakeComparisonDialog({ findingId, onClose }: { findingId: string; onClose: (ended?: TakeComparisonJob) => void }) {
  const api = useApi();
  const [job, setJob] = useState<TakeComparisonJob>();
  const [problem, setProblem] = useState<string>();
  const started = useRef(false);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Start once per dialog, even when effects run twice: a comparison of this group already running is followed instead of
  // started again, and one of another group (only one runs at a time) is said rather than shown as this group's.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    api
      .takeComparisonState()
      .then((state) => {
        if (state.phase !== 'running') return api.takeComparisonStart(findingId);
        if (state.findingId === findingId) return state;
        throw new Error(ANOTHER_GROUP);
      })
      .then((next) => mounted.current && setJob(next))
      .catch((error) => mounted.current && setProblem(apiErrorMessage(error)));
  }, [api, findingId]);

  const running = job?.phase === 'running';
  useEffect(() => {
    if (!running) return;
    let active = true;
    const timer = setTimeout(() => {
      api
        .takeComparisonState()
        .then((next) => active && setJob(next))
        .catch((error) => active && setJob((current) => current && { ...current, phase: 'error', error: apiErrorMessage(error) }));
    }, POLL_MS);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [api, running, job]);

  if (problem) {
    return (
      <Dialog title="Compare takes" onClose={() => onClose()} actions={null}>
        <p role="alert" className="text-sm" style={{ color: 'var(--danger-text)' }}>
          The takes were not compared: {problem}
        </p>
      </Dialog>
    );
  }

  if (!job) {
    return (
      <Dialog title="Compare takes" onClose={() => onClose()} actions={null}>
        <p role="status" className="text-sm">
          Starting the comparison…
        </p>
      </Dialog>
    );
  }

  return (
    <WorkDialog
      title="Comparing takes"
      job={job}
      cancel={() => void api.takeComparisonCancel().then(setJob, (error) => setProblem(apiErrorMessage(error)))}
      background={() => onClose()}
      close={() => onClose(job)}
    />
  );
}
