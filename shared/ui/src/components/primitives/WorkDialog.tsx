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
        <span className="f-mono text-xs">{Math.floor(job.elapsed)}s</span>
      </div>
      <div className="progressbar mt-3">
        <div className={running && job.percent === 0 ? 'work-progress-indeterminate' : ''} style={{ width: `${Math.max(job.percent, running ? 4 : 0)}%` }} />
      </div>
      <div className="mt-3 text-xs" style={{ color: 'var(--text-muted)' }}>
        <div className="section-label mb-1.5">Live activity</div>
        <div className="run-log f-mono overflow-x-hidden">
          {job.logs.map((line, index) => (
            <div key={`${index}-${line}`} className="run-log-entry break-words">
              {line}
            </div>
          ))}
          {!job.logs.length && (
            <div className="run-log-entry" style={{ color: 'var(--text-faint)' }}>
              Waiting for activity…
            </div>
          )}
        </div>
      </div>
    </Dialog>
  );
}
