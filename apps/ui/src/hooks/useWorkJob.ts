import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { describeApiError } from '../api/errorMessage';
import type { WorkJob } from '../types';

/** A host job that is still going: the phases a Story Bible build reports while it runs. */
const RUNNING_PHASES: readonly WorkJob['phase'][] = ['preparing', 'running'];
/** How often the host is asked how far the job is. */
const DEFAULT_POLL_MS = 250;

type Options = {
  /** Asks the host for the job's current state. */
  poll: (job: WorkJob) => Promise<WorkJob>;
  /** The phases in which the job is still going and is polled. Any other phase stops the polling. */
  pollingPhases?: readonly WorkJob['phase'][];
  intervalMs?: number;
  /**
   * When given, a reported success is not shown: this runs (and is awaited, so a page can reload its data first and never render on stale
   * rows) and then the job is cleared, which closes its dialog. Without it a success is shown like any other phase.
   */
  onSuccess?: () => unknown;
};

/**
 * The one poll loop for a host `WorkJob` shown in a `WorkDialog` (a Story Bible build, a manuscript import). Holding a job in a polled
 * phase polls the host at once and then every interval, and shows each answer; the percent and log are only ever what the host reported
 * (ADR 0015). A failed poll becomes an error on the job in the words the narrator reads. Unmounting stops the loop and drops a late answer.
 * The job itself is plain state, so a page sets it from whatever started the job.
 */
export function useWorkJob({ poll, pollingPhases = RUNNING_PHASES, intervalMs = DEFAULT_POLL_MS, onSuccess }: Options) {
  const [job, setJob] = useState<WorkJob>();
  // The latest callbacks, read by the running loop, so a page passing inline functions does not restart the polling on every render.
  const latest = useRef({ poll, onSuccess });
  latest.current = { poll, onSuccess };
  const polled = job !== undefined && pollingPhases.includes(job.phase);
  const jobRef = useRef(job);
  jobRef.current = job;

  useEffect(() => {
    if (!polled || !jobRef.current?.id) return;
    let active = true;
    const refresh = () =>
      void latest.current
        .poll(jobRef.current!)
        .then(async (next) => {
          if (!active) return;
          const settle = latest.current.onSuccess;
          if (next.phase !== 'success' || !settle) setJob(next);
          else {
            await settle();
            setJob(undefined);
          }
        })
        .catch(
          (error) =>
            active &&
            setJob((current) => (current ? { ...current, phase: 'error', error: describeApiError(error), message: describeApiError(error) } : current)),
        );
    refresh();
    const timer = window.setInterval(refresh, intervalMs);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [job?.id, job?.phase, polled, intervalMs]);

  return [job, setJob] as readonly [WorkJob | undefined, Dispatch<SetStateAction<WorkJob | undefined>>];
}
