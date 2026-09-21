import { Progress } from '@base-ui/react/progress';
import type { WorkJob } from '../../types';
import { Button } from './Button';
import { Dialog } from './Dialog';

const active = new Set<WorkJob['phase']>(['preparing', 'committing', 'running']);

// Shown while a job runs with no Cancel (the Story Bible rebuild, an import that is writing): the dialog stays blocking, so
// it says why nothing can be pressed and what will change. It is the dialog's description, so a screen reader hears it on open.
const NOT_CANCELLABLE_NOTICE = 'This step cannot be cancelled. Close appears when it finishes.';

export function WorkDialog({ title, job, close, cancel }: { title: string; job: WorkJob; close?: () => void; cancel?: () => void }) {
  const running = active.has(job.phase);
  // A running job that has reported no progress yet (percent 0) is indeterminate: no value, and the bar slides.
  const indeterminate = running && job.percent === 0;
  const showCancel = Boolean(cancel) && running;
  const showClose = Boolean(close) && !running;
  const notCancellable = running && !cancel;
  return (
    <Dialog
      title={title}
      actionsAlign="end"
      // Escape is ignored while a job runs (Cancel is a deliberate action) and works as Close once it has finished.
      onEscape={close && !running ? close : undefined}
      // A running job with no Cancel has nothing to press: no action row is drawn, and the description says why.
      description={notCancellable ? <span className="mb-3 block">{NOT_CANCELLABLE_NOTICE}</span> : undefined}
      actions={
        showCancel || showClose ? (
          <>
            {showCancel && (
              <Button variant="ghost" onClick={cancel}>
                Cancel
              </Button>
            )}
            {showClose && (
              <Button variant="primary" onClick={close}>
                Close
              </Button>
            )}
          </>
        ) : null
      }
    >
      <div className="flex justify-between gap-3 text-sm">
        {/* A live region, so a screen reader hears each step; a failure interrupts (alert), progress does not (status). */}
        <span role={job.error ? 'alert' : 'status'}>{job.error || job.message}</span>
        <span className="font-['IBM_Plex_Mono',ui-monospace,monospace] text-xs">{Math.floor(job.elapsed)}s</span>
      </div>
      {/* Progress carries the semantics (role, aria-valuenow only when determinate); the fill below keeps the current look. */}
      <Progress.Root value={indeterminate ? null : job.percent} aria-label={`${title} progress`} className="mt-3">
        <Progress.Track className="progressbar h-4 overflow-hidden rounded-full bg-[var(--surface-3)]">
          <div
            // motion-safe: the fill neither eases nor slides for people who have asked for reduced motion.
            className={`h-full bg-[var(--accent)] motion-safe:transition-[width] motion-safe:duration-[0.4s] motion-safe:ease-in-out ${indeterminate ? 'motion-safe:animate-[work-progress-slide_1.15s_ease-in-out_infinite]' : ''}`}
            style={{ width: `${Math.max(job.percent, running ? 4 : 0)}%` }}
          />
        </Progress.Track>
      </Progress.Root>
      <div className="mt-3 text-xs" style={{ color: 'var(--text-muted)' }}>
        <div className="mb-1.5 font-['Barlow_Condensed',sans-serif] text-[0.72rem] font-semibold tracking-[0.08em] uppercase">Live activity</div>
        <div
          tabIndex={0}
          className="h-36 overflow-x-hidden overflow-y-auto border border-[var(--border)] bg-[var(--surface-2)] font-['IBM_Plex_Mono',ui-monospace,monospace] focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:outline-none focus-visible:ring-inset"
        >
          {job.logs.map((line, index) => (
            <div key={`${index}-${line}`} className="border-b border-[var(--border)] px-[0.45rem] py-1 break-words">
              {line}
            </div>
          ))}
          {!job.logs.length && <div className="border-b border-[var(--border)] px-[0.45rem] py-1">Waiting for activity…</div>}
        </div>
      </div>
    </Dialog>
  );
}
