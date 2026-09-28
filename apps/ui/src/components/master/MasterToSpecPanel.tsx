import type { ExportJob, PackageItemKind } from '../../types';
import { Button } from '../primitives/Button';
import { Checkbox } from '../primitives/Checkbox';
import { Panel } from '../primitives/Panel';
import { ProgressBar } from '../primitives/ProgressBar';
import { Select } from '../primitives/Select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../primitives/Table';
import { TextField } from '../primitives/TextField';
import { type ExportJobs, fileName } from './useExportJobs';

const MUTED = { color: 'var(--text-muted)' };
const DANGER = { color: 'var(--danger-text)' };
const OK = { color: 'var(--ok-text)' };

const KIND_OPTIONS: { value: PackageItemKind; label: string }[] = [
  { value: 'chapter', label: 'Chapter' },
  { value: 'credits_opening', label: 'Opening credits' },
  { value: 'credits_closing', label: 'Closing credits' },
  { value: 'retail_sample', label: 'Retail sample' },
];

/** A row's status label ("Waiting", "Mastering…", "Ready", "Failed: …", "Cancelled"). */
function exportRowStatus(file: ExportJob['files'][number]): string {
  switch (file.status) {
    case 'pending':
      return 'Waiting';
    case 'mastering':
      return 'Mastering…';
    case 'encoding':
      return 'Encoding…';
    case 'done':
      return 'Ready';
    case 'failed':
      return `Failed: ${file.error ?? 'unknown reason'}`;
    case 'cancelled':
      return 'Cancelled';
  }
}

/**
 * The files "Master all to spec…" picked (render-encode-master.prd.md Phase 5, on Master & QC since stage navigation Phase 8): each
 * with its role in the package and, for a chapter, its title, then Master & encode as one job with real progress and Cancel. It
 * appears once files are picked or a job exists; before that the page's header action is the way in.
 */
export function MasterToSpecPanel({ jobs, chainLabel }: { jobs: ExportJobs; chainLabel?: string }) {
  const { items, exportJob, exportRunning, problem } = jobs;
  const started = !!exportJob?.files.length;
  if (items.length === 0 && !started && !problem) return null;
  return (
    <Panel
      title="Master to spec"
      actions={
        !started && (
          <Button variant="secondary" onClick={() => void jobs.pick()} pending={jobs.picking} disabled={exportRunning}>
            Add files…
          </Button>
        )
      }
    >
      {problem && (
        <p role="alert" className="mt-2 text-sm" style={DANGER}>
          {problem}
        </p>
      )}
      {(items.length > 0 || started) && (
        <div
          tabIndex={0}
          className="mt-2 overflow-x-auto focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:outline-none focus-visible:ring-inset"
        >
          <Table label="Files to export">
            <TableHead>
              <TableRow>
                <TableHeader>File</TableHeader>
                <TableHeader>Role</TableHeader>
                <TableHeader>Title</TableHeader>
                <TableHeader>Status</TableHeader>
                <TableHeader hiddenLabel="Remove" />
              </TableRow>
            </TableHead>
            <TableBody>
              {(started && exportJob ? exportJob.files : items).map((item) => {
                const result = exportJob?.files.find((file) => file.path === item.path);
                return (
                  <TableRow key={item.path}>
                    <TableCell className="text-sm">{fileName(item.path)}</TableCell>
                    <TableCell>
                      {started ? (
                        KIND_OPTIONS.find((option) => option.value === item.kind)?.label
                      ) : (
                        <Select
                          label={`Role for ${fileName(item.path)}`}
                          value={item.kind}
                          onChange={(value) => jobs.updateItem(item.path, { kind: value as PackageItemKind })}
                          options={KIND_OPTIONS}
                        />
                      )}
                    </TableCell>
                    <TableCell>
                      {item.kind === 'chapter' &&
                        (started ? (
                          item.title
                        ) : (
                          <TextField
                            label={`Title for ${fileName(item.path)}`}
                            value={item.title}
                            onChange={(value) => jobs.updateItem(item.path, { title: value })}
                          />
                        ))}
                    </TableCell>
                    <TableCell className="text-sm" style={result?.status === 'failed' ? DANGER : result?.status === 'done' ? OK : MUTED}>
                      {result ? exportRowStatus(result) : 'Not started'}
                    </TableCell>
                    <TableCell>
                      {!started && (
                        <Button variant="secondary" onClick={() => jobs.removeItem(item.path)}>
                          Remove
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
      {items.length > 0 && !started && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Checkbox checked={jobs.master} onChange={jobs.setMaster}>
            Master before encoding{chainLabel ? ` with the ${chainLabel.charAt(0).toLowerCase()}${chainLabel.slice(1)}` : ''}, to the platform&apos;s RMS window
            and peak limit
          </Checkbox>
          <Button onClick={() => void jobs.startExport()}>{jobs.master ? 'Master & encode' : 'Encode'}</Button>
        </div>
      )}
      {exportJob && exportRunning && (
        <div className="mt-3 flex flex-col gap-2">
          <ProgressBar label="Preparing files" value={exportJob.percent} running valueText={`${exportJob.percent}% prepared`} />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p aria-live="polite" className="text-sm">
              {exportJob.message}
            </p>
            <Button variant="secondary" onClick={jobs.cancelExport}>
              Cancel
            </Button>
          </div>
        </div>
      )}
      {exportJob && !exportRunning && exportJob.phase !== 'idle' && (
        <p aria-live="polite" className="mt-2 text-sm" style={exportJob.phase === 'error' ? DANGER : undefined}>
          {exportJob.message}
        </p>
      )}
    </Panel>
  );
}
