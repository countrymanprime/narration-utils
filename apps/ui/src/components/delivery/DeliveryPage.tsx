import { useEffect, useState } from 'react';
import { useApi } from '../../api/ApiContext';
import { apiErrorMessage } from '../../api/errorMessage';
import type { MeasureJob } from '../../types';
import { Button } from '../primitives/Button';
import { Heading } from '../primitives/Heading';
import { Panel } from '../primitives/Panel';
import { ProgressBar } from '../primitives/ProgressBar';
import { Tab, TabList, TabPanel, Tabs } from '../primitives/Tabs';
import { deliveryLimitsFrom } from './deliveryLimits';
import { DeliveryLimitsPanel, type LimitsState } from './DeliveryLimitsPanel';
import { DiagnosticsTab } from './DiagnosticsTab';
import { MeasurementsTable, tally } from './MeasurementsTable';
import { ReportExportPanel } from './ReportExportPanel';

/** How often a running measurement is read. */
const POLL_MS = 500;

const MUTED = { color: 'var(--text-muted)' };
const DANGER = { color: 'var(--danger-text)' };

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/**
 * Delivery (docs/prds/diagnostics-delivery-and-cleanup-tools.prd.md Phase 5): the narrator picks rendered chapter files, the host
 * measures them as a job with real progress and Cancel (ADR 0015, ADR 0156), and the page lists every measurement with its unit
 * as the host judges it against the narrator's own limits (ADR 0155, Phase 7). The host keeps the last measurement, so leaving the
 * page and coming back shows it again, and one still running is picked up where it is. The Diagnostics tab (Phase 6) checks the same
 * files with the windowed analyzers, and the Report panel (Phase 7) exports both. Nothing here changes an audio file.
 */
export function DeliveryPage({ openSettings }: { openSettings: () => void }) {
  const api = useApi();
  const [job, setJob] = useState<MeasureJob>();
  const [jobError, setJobError] = useState<string>();
  const [limits, setLimits] = useState<LimitsState>({ status: 'loading' });
  const [problem, setProblem] = useState<string>();
  const [picking, setPicking] = useState(false);
  const [tab, setTab] = useState('measurements');

  useEffect(() => {
    let active = true;
    api
      .measureState()
      .then((state) => active && setJob(state))
      .catch((error) => active && setJobError(apiErrorMessage(error)));
    api
      .settingsForScope('project')
      .then((settings) => active && setLimits({ status: 'ready', limits: deliveryLimitsFrom(settings.Delivery ?? []) }))
      .catch((error) => active && setLimits({ status: 'error', message: apiErrorMessage(error) }));
    return () => {
      active = false;
    };
  }, [api]);

  // A running measurement is read until it ends; an answer after the page closed is dropped.
  const running = job?.phase === 'running';
  useEffect(() => {
    if (!running) return;
    let active = true;
    const timer = setTimeout(() => {
      api
        .measureState()
        .then((next) => active && setJob(next))
        .catch((error) => active && setJobError(apiErrorMessage(error)));
    }, POLL_MS);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [api, running, job]);

  const choose = async () => {
    setPicking(true);
    setProblem(undefined);
    try {
      const picked = await api.measurePickFiles();
      if (picked.paths.length === 0) return;
      setJob(await api.measureAnalyze(picked.paths));
      setJobError(undefined);
    } catch (error) {
      setProblem(apiErrorMessage(error));
    } finally {
      setPicking(false);
    }
  };

  const cancel = () => void api.measureCancel().then(setJob, (error) => setProblem(apiErrorMessage(error)));

  const files = job?.files ?? [];
  const ended = job !== undefined && (job.phase === 'success' || job.phase === 'cancelled' || job.phase === 'error');
  const { outside, unavailable } = tally(files);
  // The files of a measurement that has ended were picked, so the Diagnostics tab can check them without picking them again.
  const measuredPaths = ended ? files.map((file) => file.path) : [];

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      <Heading title="Delivery">
        Measure your rendered chapter files: loudness, levels, peaks and noise floor, against limits you set yourself, and check them for clipping, level shifts
        and room-tone changes. Your files are only read, never changed.
      </Heading>
      <Tabs value={tab} onChange={setTab} className="flex flex-col gap-4">
        <TabList label="Delivery views" activation="automatic">
          <Tab value="measurements">Measurements</Tab>
          <Tab value="diagnostics">Diagnostics</Tab>
        </TabList>
        <TabPanel value="measurements" className="flex flex-col gap-4">
          <DeliveryLimitsPanel state={limits} openSettings={openSettings} />
          <Panel
            title="Measurements"
            actions={
              <Button onClick={() => void choose()} pending={picking} disabled={running}>
                Choose files to measure…
              </Button>
            }
          >
            {jobError && (
              <p role="alert" className="mt-2 text-sm" style={DANGER}>
                The measurement could not be read: {jobError}
              </p>
            )}
            {problem && (
              <p role="alert" className="mt-2 text-sm" style={DANGER}>
                {problem}
              </p>
            )}
            {job?.limitsError && files.length > 0 && (
              <p role="alert" className="mt-2 text-sm" style={DANGER}>
                Your limits could not be read, so no value is judged: {job.limitsError}
              </p>
            )}
            {job && running && (
              <div className="mt-3 flex flex-col gap-2">
                <ProgressBar label="Measuring" value={job.percent} running valueText={`${job.percent}% read`} />
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
                  // The technical reason is on the file it broke on; the files after it were not read.
                  <p role="alert" style={DANGER}>
                    {job.message} Choose the files again to measure them.
                  </p>
                ) : (
                  <p aria-live="polite">{job.message}</p>
                )}
                {outside > 0 && (
                  <p className="mt-1 font-medium" style={DANGER}>
                    {plural(outside, 'value is', 'values are')} outside your limits.
                  </p>
                )}
              </div>
            )}
            {files.length > 0 ? (
              <>
                {/* tabIndex: the table scrolls sideways in a narrow window, and a scrolling region must be reachable by keyboard. */}
                <div
                  tabIndex={0}
                  className="overflow-x-auto focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:outline-none focus-visible:ring-inset"
                >
                  <MeasurementsTable files={files} />
                </div>
                {unavailable > 0 && (
                  <p className="mt-2 text-xs" style={MUTED}>
                    Not measurable: the audio is silent, or too short for that measurement. It is never counted as within a limit.
                  </p>
                )}
              </>
            ) : (
              !running &&
              !jobError && (
                <p className="mt-2 text-sm" style={MUTED}>
                  Nothing measured yet. Choose one or more rendered chapter files (WAV) to see their measurements here.
                </p>
              )
            )}
          </Panel>
        </TabPanel>
        <TabPanel value="diagnostics">
          <DiagnosticsTab measuredPaths={measuredPaths} />
        </TabPanel>
      </Tabs>
      <ReportExportPanel busy={running} />
    </div>
  );
}
