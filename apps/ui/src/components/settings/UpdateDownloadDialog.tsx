import { useEffect, useRef, useState } from 'react';
import { describeApiError } from '../../api/errorMessage';
import { useApi } from '../../api/ApiContext';
import type { UpdateAvailable, UpdateJob, WorkJob } from '../../types';
import { WorkDialog } from '../primitives/WorkDialog';

const POLL_MS = 400;
const BYTES_PER_MB = 1024 * 1024;

const isFinished = (phase: UpdateJob['phase']) => phase === 'ready' || phase === 'error' || phase === 'cancelled';
const megabytes = (bytes: number) => Math.round(bytes / BYTES_PER_MB);

/** The words for a step: while it downloads, the real bytes so far, so the narrator sees it move and knows how far it has to go. */
function stepMessage(job: UpdateJob): string {
  if (job.phase !== 'downloading' || job.bytesTotal <= 0) return job.message;
  return `${job.message} ${megabytes(job.bytesDone)} of ${megabytes(job.bytesTotal)} MB`;
}

const WORK_PHASE: Record<UpdateJob['phase'], WorkJob['phase']> = {
  downloading: 'running',
  verifying: 'running',
  unpacking: 'running',
  ready: 'success',
  error: 'error',
  cancelled: 'cancelled',
};

/**
 * Downloads the update the narrator asked for and shows how it goes: real bytes while it downloads, then the check against the
 * release's checksum and the unpacking. Cancel stops the download; once it has all arrived the remaining steps are short and are
 * not cancellable, and the dialog says so (ADR 0057). It starts the download once when it opens and never on its own before that.
 */
export function UpdateDownloadDialog({ available, close }: { available: UpdateAvailable; close: (result: UpdateJob['phase']) => void }) {
  const api = useApi();
  const [job, setJob] = useState<UpdateJob>();
  const [failure, setFailure] = useState('');
  const [seconds, setSeconds] = useState(0);
  const [log, setLog] = useState<string[]>([]);
  // One start per dialog, even when React runs the effect twice in development: the second run waits for the same request.
  const starting = useRef<Promise<UpdateJob>>(undefined);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async (id: string) => {
      try {
        const next = await api.updateJobState(id);
        if (!active) return;
        setJob(next);
        if (!isFinished(next.phase)) timer = setTimeout(() => void poll(id), POLL_MS);
      } catch (error) {
        if (active) setFailure(describeApiError(error));
      }
    };
    starting.current ??= api.updateDownload();
    starting.current
      .then((started) => {
        if (!active) return;
        setJob(started);
        timer = setTimeout(() => void poll(started.id), POLL_MS);
      })
      .catch((error) => active && setFailure(describeApiError(error)));
    const clock = setInterval(() => setSeconds((current) => current + 1), 1000);
    return () => {
      active = false;
      clearTimeout(timer);
      clearInterval(clock);
    };
  }, [api]);

  const message = job ? stepMessage(job) : '';
  const jobMessage = job?.message;
  useEffect(() => {
    if (jobMessage) setLog((current) => (current.includes(jobMessage) ? current : [...current, jobMessage]));
  }, [jobMessage]);

  const workJob: WorkJob = failure
    ? { id: null, kind: 'app_update', phase: 'error', message: failure, percent: 0, logs: log, elapsed: seconds, error: failure }
    : {
        id: job?.id ?? null,
        kind: 'app_update',
        phase: job ? WORK_PHASE[job.phase] : 'preparing',
        message,
        percent: job?.percent ?? 0,
        logs: log,
        elapsed: seconds,
        error: job?.phase === 'error' ? job.error : undefined,
      };
  // Only the download itself can be stopped; the checks after it are short and finish what they started.
  const canCancel = job?.phase === 'downloading';
  return (
    <WorkDialog
      title={`Download Narration Utils ${available.version}`}
      job={workJob}
      close={() => close(failure ? 'error' : (job?.phase ?? 'error'))}
      cancel={
        canCancel && job
          ? () =>
              void api
                .updateJobCancel(job.id)
                .then(setJob)
                .catch((error) => setFailure(describeApiError(error)))
          : undefined
      }
    />
  );
}
