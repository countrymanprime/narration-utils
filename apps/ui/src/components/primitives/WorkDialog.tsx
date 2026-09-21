import type { WorkJob } from '../../types';
import { Button } from './Button';
import { Dialog } from './Dialog';
import { ProgressBar } from './ProgressBar';

const active = new Set<WorkJob['phase']>(['preparing', 'committing', 'running']);

// Shown while a job runs with no Cancel (the Story Bible rebuild, an import that is writing): the dialog stays blocking, so
// it says why nothing can be pressed and what will change. It is the dialog's description, so a screen reader hears it on open.
const NOT_CANCELLABLE_NOTICE = 'This step cannot be cancelled. Close appears when it finishes.';
// The same, for a job the caller lets keep running without the dialog (ADR 0076): the app tells the narrator when it ends.
const BACKGROUND_NOTICE = 'This step cannot be cancelled. You can close this window: it keeps running, and a message appears when it finishes.';

export function WorkDialog({
  title,
  job,
  close,
  cancel,
  background,
}: {
  title: string;
  job: WorkJob;
  close?: () => void;
  cancel?: () => void;
  /** Lets the narrator dismiss the dialog while the job runs. Only for a job whose end the app announces on its own (ADR 0076). */
  background?: () => void;
}) {
  const running = active.has(job.phase);
  // A running job that has reported no progress yet (percent 0) is indeterminate: no value, and the bar slides.
  const indeterminate = running && job.percent === 0;
  const showCancel = Boolean(cancel) && running;
  const showClose = Boolean(close) && !running;
  const showBackground = Boolean(background) && running;
  const notCancellable = running && !cancel;
  return (
    <Dialog
      title={title}
      actionsAlign="end"
      // Escape is ignored while a job runs (Cancel is a deliberate action) and works as Close once it has finished.
      onEscape={close && !running ? close : showBackground ? background : undefined}
      // A running job with no Cancel has nothing to press: no action row is drawn, and the description says why.
      description={notCancellable ? <span className="mb-3 block">{showBackground ? BACKGROUND_NOTICE : NOT_CANCELLABLE_NOTICE}</span> : undefined}
      actions={
        showCancel || showClose || showBackground ? (
          <>
            {showBackground && (
              <Button variant="ghost" onClick={background}>
                Continue in background
              </Button>
            )}
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
        <span>
          <span role={job.error ? 'alert' : 'status'}>{job.error || job.message}</span>
          {/* The numbers move on nearly every poll, so they sit outside the live region: the progress bar carries them for a screen reader. */}
          {job.detail && !job.error && <span> {job.detail}</span>}
        </span>
        <span className="font-['IBM_Plex_Mono',ui-monospace,monospace] text-xs">{Math.floor(job.elapsed)}s</span>
      </div>
      <ProgressBar label={`${title} progress`} value={indeterminate ? null : job.percent} running={running} valueText={job.detail} className="mt-3" />
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
