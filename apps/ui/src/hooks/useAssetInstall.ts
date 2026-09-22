import { useCallback, useEffect, useRef, useState } from 'react';
import { apiErrorMessage } from '../api/errorMessage';
import { isInstallRunning, type AssetInstallJob } from '../types';

/** How often the host is asked how far the download is. Short enough that the bar moves, long enough that a poll is never the load. */
const POLL_MS = 400;

type Options<J extends AssetInstallJob> = {
  /** Starts the install, or joins the one already running for the same asset (the host does that). */
  start: () => Promise<J>;
  state: (jobId: string) => Promise<J>;
  cancel: (jobId: string) => Promise<J>;
  /** Called once when the install succeeded, and never after the page that started it has gone. */
  onSuccess?: (job: J) => void | Promise<void>;
  /** Called once with the sentence the narrator reads when the install failed, or a call to the host did. */
  onFailure?: (message: string) => void;
};

/**
 * The one install-poll loop for every optional asset (a voice, a Whisper model, and the models that follow; owner decision D4). It starts
 * the install, follows the job the host reports until it ends, and exposes what a dialog needs: the job with its real bytes, the seconds it
 * has been running, the distinct messages so far, and a failure sentence when a call to the host itself failed.
 *
 * `begin` is refused while an install is running, in the code path and not only in how a button looks (ADR 0075); the host refuses too, by
 * joining the running job. Leaving the page stops the polling but not the download: it is a host job and ends with a `job:ended` event.
 */
export function useAssetInstall<J extends AssetInstallJob>(options: Options<J>) {
  const latest = useRef(options);
  latest.current = options;
  const [job, setJob] = useState<J>();
  const [failure, setFailure] = useState('');
  // Why a Cancel did not work, shown while the job goes on (the download is still running, so it is not the job's failure).
  const [cancelFailure, setCancelFailure] = useState('');
  const [seconds, setSeconds] = useState(0);
  const [log, setLog] = useState<string[]>([]);
  const [starting, setStarting] = useState(false);
  // One generation per begin/reset: a loop that finds it is no longer the current one stops without touching state.
  const generation = useRef(0);
  const active = useRef(false);
  const currentJob = useRef<J>(undefined);
  // Counts the answers shown. A poll whose answer was asked for before a newer one was shown (a Cancel) is out of date and is dropped.
  const shown = useRef(0);

  const running = starting || (job !== undefined && isInstallRunning(job));

  useEffect(
    () => () => {
      generation.current += 1;
    },
    [],
  );

  useEffect(() => {
    if (!running) return;
    const clock = setInterval(() => setSeconds((current) => current + 1), 1000);
    return () => clearInterval(clock);
  }, [running]);

  // The log is kept as each answer arrives, not from an effect, so a step that a re-render skipped is still in it.
  const show = useCallback((next: J) => {
    currentJob.current = next;
    shown.current += 1;
    setJob(next);
    if (next.message) setLog((current) => (current.includes(next.message) ? current : [...current, next.message]));
  }, []);

  const begin = useCallback(async () => {
    if (active.current) return;
    active.current = true;
    const mine = ++generation.current;
    const stale = () => generation.current !== mine;
    setFailure('');
    setSeconds(0);
    setLog([]);
    setStarting(true);
    try {
      let current = await latest.current.start();
      if (stale()) return;
      setStarting(false);
      show(current);
      while (isInstallRunning(current)) {
        await new Promise((resolve) => window.setTimeout(resolve, POLL_MS));
        if (stale()) return;
        const asked = shown.current;
        const answer = await latest.current.state(current.id);
        if (stale()) return;
        if (shown.current === asked) show(answer);
        current = currentJob.current ?? answer;
      }
      if (current.phase === 'success') await latest.current.onSuccess?.(current);
      else if (current.phase === 'error') latest.current.onFailure?.(current.error || current.message);
    } catch (error) {
      if (stale()) return;
      const text = apiErrorMessage(error);
      setStarting(false);
      setFailure(text);
      latest.current.onFailure?.(text);
    } finally {
      if (!stale()) active.current = false;
    }
  }, [show]);

  const cancel = useCallback(async () => {
    const running = currentJob.current;
    if (!running || !isInstallRunning(running)) return;
    const mine = generation.current;
    setCancelFailure('');
    try {
      const answer = await latest.current.cancel(running.id);
      if (generation.current === mine) show(answer);
    } catch (error) {
      if (generation.current === mine) setCancelFailure(apiErrorMessage(error));
    }
  }, [show]);

  /** Forgets the job, so a dialog that showed its end can be dismissed and a later `begin` starts fresh. Does not stop a running download. */
  const reset = useCallback(() => {
    generation.current += 1;
    active.current = false;
    currentJob.current = undefined;
    setJob(undefined);
    setFailure('');
    setCancelFailure('');
    setSeconds(0);
    setLog([]);
    setStarting(false);
  }, []);

  return { job, failure, cancelFailure, running, starting, seconds, log, begin, cancel, reset };
}

export type AssetInstall<J extends AssetInstallJob = AssetInstallJob> = ReturnType<typeof useAssetInstall<J>>;
