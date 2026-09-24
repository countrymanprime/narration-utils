import { useEffect, useState } from 'react';
import { useApi } from '../../api/ApiContext';
import { apiErrorMessage } from '../../api/errorMessage';
import type { DiagnosticsJob, DiagnosticsSourceKind } from '../../types';
import { Button } from '../primitives/Button';
import { Panel } from '../primitives/Panel';
import { ProgressBar } from '../primitives/ProgressBar';
import { ToggleGroup } from '../primitives/ToggleGroup';
import { thresholdRows } from './diagnosticsFormat';
import { CheckedFilesTable, FindingsTable } from './DiagnosticsTables';

/** How often a running check is read. */
const POLL_MS = 500;

const MUTED = { color: 'var(--text-muted)' };
const DANGER = { color: 'var(--danger-text)' };

const SOURCE_KINDS = [
  { value: 'processed_render', label: 'Rendered chapters' },
  { value: 'raw_recording', label: 'Raw recordings' },
] as const;

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

function ThresholdsPanel({ job }: { job: DiagnosticsJob | undefined }) {
  return (
    <Panel title="Thresholds">
      {job ? (
        <>
          <dl className="mt-2 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1 text-sm">
            {thresholdRows(job.thresholds).map((row) => (
              <div key={row.label} className="contents">
                <dt>{row.label}</dt>
                <dd className="[overflow-wrap:anywhere]">{row.value}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-2 text-xs" style={MUTED}>
            These are starting values, not a delivery specification, and they cannot be changed here yet. Each finding shows the threshold that raised it.
          </p>
        </>
      ) : (
        <p className="mt-2 text-sm" style={MUTED}>
          Reading the thresholds…
        </p>
      )}
    </Panel>
  );
}

/**
 * The Delivery page's Diagnostics tab (docs/prds/diagnostics-delivery-and-cleanup-tools.prd.md Phase 6): the windowed analyzers
 * (ADR 0158) over files picked for measuring, as a host job with real progress and Cancel (ADR 0015). Each finding shows its time in
 * the file, what was measured, the threshold that raised it and whether the audio is a raw recording or a rendered chapter, never a
 * grade. It is read-only: nothing is saved, played or sent to REAPER, so every finding stays unreviewed (PRD Open Question 4), and
 * the narrator listens at those times in REAPER (Open Question 8). `measuredPaths` are the files of the last measurement, which the
 * host already accepts, so they can be checked without picking them again.
 */
export function DiagnosticsTab({ measuredPaths }: { measuredPaths: readonly string[] }) {
  const api = useApi();
  const [job, setJob] = useState<DiagnosticsJob>();
  const [jobError, setJobError] = useState<string>();
  const [problem, setProblem] = useState<string>();
  const [picking, setPicking] = useState(false);
  const [sourceKind, setSourceKind] = useState<DiagnosticsSourceKind>('processed_render');

  useEffect(() => {
    let active = true;
    api
      .diagnosticsState()
      .then((state) => {
        if (!active) return;
        setJob(state);
        if (state.sourceKind) setSourceKind(state.sourceKind);
      })
      .catch((error) => active && setJobError(apiErrorMessage(error)));
    return () => {
      active = false;
    };
  }, [api]);

  // A running check is read until it ends; an answer after the tab closed is dropped.
  const running = job?.phase === 'running';
  useEffect(() => {
    if (!running) return;
    let active = true;
    const timer = setTimeout(() => {
      api
        .diagnosticsState()
        .then((next) => active && setJob(next))
        .catch((error) => active && setJobError(apiErrorMessage(error)));
    }, POLL_MS);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [api, running, job]);

  const check = async (paths: () => Promise<readonly string[]>) => {
    setPicking(true);
    setProblem(undefined);
    try {
      const chosen = await paths();
      if (chosen.length === 0) return;
      setJob(await api.diagnosticsAnalyze([...chosen], sourceKind));
      setJobError(undefined);
    } catch (error) {
      setProblem(apiErrorMessage(error));
    } finally {
      setPicking(false);
    }
  };

  const chooseFiles = () => check(async () => (await api.measurePickFiles()).paths);
  const checkMeasured = () => check(async () => measuredPaths);
  const cancel = () => void api.diagnosticsCancel().then(setJob, (error) => setProblem(apiErrorMessage(error)));

  const files = job?.files ?? [];
  const ended = job !== undefined && (job.phase === 'success' || job.phase === 'cancelled' || job.phase === 'error');
  const findings = files.flatMap((file) => file.findings);
  const anyChecked = files.some((file) => file.status === 'checked');
  const checkedKind = job?.sourceKind ?? sourceKind;

  return (
    <div className="flex flex-col gap-4">
      <Panel
        title="Diagnostics"
        actions={
          <div className="flex flex-wrap gap-2">
            {measuredPaths.length > 0 && (
              <Button variant="ghost" onClick={() => void checkMeasured()} pending={picking} disabled={running}>
                {`Check the ${plural(measuredPaths.length, 'measured file', 'measured files')}`}
              </Button>
            )}
            <Button onClick={() => void chooseFiles()} pending={picking} disabled={running}>
              Choose files to check…
            </Button>
          </div>
        }
      >
        <p className="mt-2 text-sm" style={MUTED}>
          Clipping, level shifts, room-tone changes and long pauses, each with its time in the file and the threshold that raised it. Listen at those times in
          REAPER: nothing here is saved, played or changed.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
          <span aria-hidden="true">The files are</span>
          <ToggleGroup
            label="The files are"
            value={sourceKind}
            onChange={(value) => setSourceKind(value as DiagnosticsSourceKind)}
            options={SOURCE_KINDS.map((option) => ({ ...option, disabled: running }))}
            className="flex-wrap gap-1.5"
          />
        </div>
        <p className="mt-1 text-xs" style={MUTED}>
          Room tone and level mean different things in each: a render may have been gated or cleaned on purpose.
        </p>
        {jobError && (
          <p role="alert" className="mt-2 text-sm" style={DANGER}>
            The diagnostics could not be read: {jobError}
          </p>
        )}
        {problem && (
          <p role="alert" className="mt-2 text-sm" style={DANGER}>
            {problem}
          </p>
        )}
        {job && running && (
          <div className="mt-3 flex flex-col gap-2">
            <ProgressBar label="Checking" value={job.percent} running valueText={`${job.percent}% read`} />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p aria-live="polite" className="text-sm">
                {job.message}
              </p>
              <Button variant="ghost" onClick={cancel}>
                Cancel
              </Button>
            </div>
          </div>
        )}
        {job && ended && (
          <div className="mt-2 text-sm">
            {job.phase === 'error' ? (
              <p role="alert" style={DANGER}>
                {job.message} Choose the files again to check them.
              </p>
            ) : (
              <p aria-live="polite">{job.message}</p>
            )}
            {findings.length > 0 && <p className="mt-1 font-medium">{`${plural(findings.length, 'finding', 'findings')} to listen to.`}</p>}
          </div>
        )}
        {files.length > 0 ? (
          <>
            {/* tabIndex: the tables scroll sideways in a narrow window, and a scrolling region must be reachable by keyboard. */}
            <div
              tabIndex={0}
              className="overflow-x-auto focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:outline-none focus-visible:ring-inset"
            >
              <CheckedFilesTable files={files} />
            </div>
            {findings.length > 0 ? (
              <div
                tabIndex={0}
                className="overflow-x-auto focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:outline-none focus-visible:ring-inset"
              >
                <FindingsTable files={files} sourceKind={checkedKind} />
              </div>
            ) : (
              ended &&
              anyChecked && (
                <p className="mt-3 text-sm" style={MUTED}>
                  Nothing reached a threshold in the checked files. That is not a pass: it only means no clipping, level shift, room-tone change or long pause
                  reached the thresholds below.
                </p>
              )
            )}
            {findings.length > 0 && (
              <p className="mt-2 text-xs" style={MUTED}>
                Every finding is a candidate to listen to, not a verdict, and stays unreviewed: deciding on them comes with the review list.
              </p>
            )}
          </>
        ) : (
          !running &&
          !jobError && (
            <p className="mt-2 text-sm" style={MUTED}>
              Nothing checked yet. Check the files you measured, or choose rendered chapters or raw recordings (WAV) to check.
            </p>
          )
        )}
      </Panel>
      <ThresholdsPanel job={job} />
    </div>
  );
}
