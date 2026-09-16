import type { WorkJob } from '../../types';

const active = new Set<WorkJob['phase']>(['preparing', 'committing', 'running']);

export function WorkDialog({ title, job, close, cancel }: { title: string; job: WorkJob; close?: () => void; cancel?: () => void }) {
  const running = active.has(job.phase);
  return (
    <div className="confirm-backdrop" role="dialog" aria-modal="true" aria-label={title}>
      <div className="confirm-dialog">
        <div className="panel-head">
          <h2 className="font-semibold">{title}</h2>
        </div>
        <div className="panel-body">
          <div className="flex justify-between gap-3 text-sm">
            <span>{job.error || job.message}</span>
            <span className="f-mono text-xs">{Math.floor(job.elapsed)}s</span>
          </div>
          <div className="progressbar mt-3">
            <div
              className={running && job.percent === 0 ? 'work-progress-indeterminate' : ''}
              style={{ width: `${Math.max(job.percent, running ? 4 : 0)}%` }}
            />
          </div>
          <div className="mt-3 text-xs" style={{ color: 'var(--text-muted)' }}>
            <div className="section-label mb-1.5">Live activity</div>
            <div className="run-log f-mono">
              {job.logs.map((line, index) => (
                <div key={`${index}-${line}`} className="run-log-entry">
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
          <div className="mt-4 flex justify-end gap-2 border-t pt-3" style={{ borderColor: 'var(--border)' }}>
            {cancel && running && (
              <button className="btn btn-ghost" onClick={cancel}>
                Cancel
              </button>
            )}
            {close && !running && (
              <button className="btn btn-primary" onClick={close}>
                Close
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
