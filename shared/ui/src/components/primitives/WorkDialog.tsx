import type { WorkJob } from '../../types';
import { Button } from './Button';
import { Dialog } from './Dialog';

const active = new Set<WorkJob['phase']>(['preparing', 'committing', 'running']);

export function WorkDialog({ title, job, close, cancel }: { title: string; job: WorkJob; close?: () => void; cancel?: () => void }) {
  const running = active.has(job.phase);
  return (
    <Dialog
      title={title}
      actionsAlign="end"
      actions={
        <>
          {cancel && running && (
            <Button variant="ghost" onClick={cancel}>
              Cancel
            </Button>
          )}
          {close && !running && (
            <Button variant="primary" onClick={close}>
              Close
            </Button>
          )}
        </>
      }
    >
      <div className="flex justify-between gap-3 text-sm">
        <span>{job.error || job.message}</span>
        <span className="font-['IBM_Plex_Mono',ui-monospace,monospace] text-xs">{Math.floor(job.elapsed)}s</span>
      </div>
      <div className="progressbar mt-3 h-4 overflow-hidden rounded-full bg-[var(--surface-3)]">
        <div
          className={`h-full bg-[var(--accent)] transition-[width] duration-[0.4s] ease-in-out ${running && job.percent === 0 ? 'animate-[work-progress-slide_1.15s_ease-in-out_infinite]' : ''}`}
          style={{ width: `${Math.max(job.percent, running ? 4 : 0)}%` }}
        />
      </div>
      <div className="mt-3 text-xs" style={{ color: 'var(--text-muted)' }}>
        <div className="mb-1.5 font-['Barlow_Condensed',sans-serif] text-[0.72rem] font-semibold tracking-[0.08em] text-[var(--text-faint)] uppercase">
          Live activity
        </div>
        <div className="h-36 overflow-x-hidden overflow-y-auto border border-[var(--border)] bg-[var(--surface-2)] font-['IBM_Plex_Mono',ui-monospace,monospace]">
          {job.logs.map((line, index) => (
            <div key={`${index}-${line}`} className="border-b border-[var(--border)] px-[0.45rem] py-1 break-words">
              {line}
            </div>
          ))}
          {!job.logs.length && (
            <div className="border-b border-[var(--border)] px-[0.45rem] py-1" style={{ color: 'var(--text-faint)' }}>
              Waiting for activity…
            </div>
          )}
        </div>
      </div>
    </Dialog>
  );
}
