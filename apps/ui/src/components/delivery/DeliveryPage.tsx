import { useEffect, useState } from 'react';
import { useApi } from '../../api/ApiContext';
import { apiErrorMessage } from '../../api/errorMessage';
import type { DeliveryProfile, DeliveryProfilesState, MeasureFileResult, MeasureJob } from '../../types';
import { Button } from '../primitives/Button';
import { Heading } from '../primitives/Heading';
import { Panel } from '../primitives/Panel';
import { ProgressBar } from '../primitives/ProgressBar';
import { Tab, TabList, TabPanel, Tabs } from '../primitives/Tabs';
import { deliveryProfileKey, deliveryProfileTitle } from './deliveryProfile';
import { DeliveryProfilePanel, type ProfileState } from './DeliveryProfilePanel';
import { DiagnosticsTab } from './DiagnosticsTab';
import { FileRulesPanel } from './FileRulesPanel';
import { countResults, MeasurementsTable, ruleColumns } from './MeasurementsTable';
import { ReportExportPanel } from './ReportExportPanel';

/** How often a running measurement is read. */
const POLL_MS = 500;

const MUTED = { color: 'var(--text-muted)' };
const DANGER = { color: 'var(--danger-text)' };

const OK = { color: 'var(--ok-text)' };

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** The panel's state from the profiles: the profile the project is judged against, the built-in it is based on, any notice. */
function profileState(state: DeliveryProfilesState): ProfileState {
  const profile = state.profiles.find((candidate) => deliveryProfileKey(candidate) === state.projectProfile);
  if (!profile) return { status: 'error', message: `the profile ${state.projectProfile} is not in the list` };
  const base = profile.basedOn ? state.profiles.find((candidate) => deliveryProfileKey(candidate) === profile.basedOn) : undefined;
  return { status: 'ready', profile, ...(base ? { basedOn: deliveryProfileTitle(base) } : {}), ...(state.notice ? { notice: state.notice } : {}) };
}

/** A rule's label inside a sentence: "RMS" and "MP3 format" keep their capitals, "Sample rate" becomes "sample rate". */
const lowerFirst = (label: string) => (/^[A-Z0-9]{2}/.test(label) ? label : label.charAt(0).toLowerCase() + label.slice(1));

/** A list in words: "a", "a and b", "a, b and c". */
const inWords = (items: readonly string[]) => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`);

/**
 * The measurement's result in sentences (mockups 02 and 03): which rules each file missed, or that every rule the app checks
 * is met; and which rules the app did not check, so the narrator checks them before uploading.
 */
function JudgementSummary({ files, profile }: { files: readonly MeasureFileResult[]; profile: DeliveryProfile }) {
  const measured = files.filter((file) => file.status === 'measured');
  if (measured.length === 0) return null;
  const label = (id: string) => lowerFirst(profile.rules.find((rule) => rule.id === id)?.label ?? id);
  const missed = measured.flatMap((file) => {
    const rules = file.rules.filter((result) => result.status === 'not_met').map((result) => label(result.ruleId));
    return rules.length > 0 ? [{ file: file.name, rules }] : [];
  });
  const total = missed.reduce((sum, entry) => sum + entry.rules.length, 0);
  // The rules the app does not check for a file, named by their column: "room tone at the head and tail", "MP3 format".
  const notChecked = ruleColumns(profile).flatMap((column) => {
    const rules = column.rules.filter((rule) => !rule.off && rule.checkedBy !== 'measured');
    if (rules.length === 0) return [];
    if (column.rules.length === 1) return [{ name: lowerFirst(column.label), count: 1 }];
    const ends = rules.map((rule) => rule.label.split(', ')[1] ?? rule.label);
    return [{ name: `${lowerFirst(column.label)} at the ${inWords(ends)}`, count: rules.length }];
  });
  const notCheckedRules = notChecked.reduce((sum, entry) => sum + entry.count, 0);
  const unmeasurable = measured.reduce((sum, file) => sum + countResults(file.rules).notMeasurable, 0);
  return (
    <>
      {missed.length > 0 ? (
        <p className="mt-1 font-medium" style={DANGER}>
          {plural(total, 'rule', 'rules')} not met in {plural(missed.length, 'file', 'files')}:{' '}
          {missed.map((entry) => `${inWords(entry.rules)} in ${entry.file}`).join('; ')}.
        </p>
      ) : (
        <p className="mt-1 font-medium" style={OK}>
          Every rule the app checks is met in {measured.length === 1 ? 'the file' : `all ${measured.length} files`}
          {unmeasurable > 0 ? ', apart from values it could not measure' : ''}.
        </p>
      )}
      {notCheckedRules > 0 && (
        <p className="mt-1" style={MUTED}>
          {plural(notCheckedRules, 'rule', 'rules')} per file {notCheckedRules === 1 ? 'is' : 'are'} not checked by the app (
          {inWords(notChecked.map((entry) => entry.name))}
          ): check {notCheckedRules === 1 ? 'it' : 'them'} yourself before uploading.
        </p>
      )}
    </>
  );
}

/**
 * Delivery (docs/prds/diagnostics-delivery-and-cleanup-tools.prd.md Phase 5): the narrator picks rendered chapter files, the host
 * measures them as a job with real progress and Cancel (ADR 0015, ADR 0156), and the page lists every file rule by rule as the host
 * judges it against the project's delivery profile (ACX unless the narrator chose another; delivery-platform-profiles.prd.md
 * Phase 3, ADR 0179). The host keeps the last measurement, so leaving the page and coming back shows it again, and one still
 * running is picked up where it is. The Diagnostics tab (Phase 6) checks the same files with the windowed analyzers, and the Report
 * panel (Phase 7) exports both. Nothing here changes an audio file.
 */
export function DeliveryPage({ openSettings }: { openSettings: () => void }) {
  const api = useApi();
  const [job, setJob] = useState<MeasureJob>();
  const [jobError, setJobError] = useState<string>();
  const [profile, setProfile] = useState<ProfileState>({ status: 'loading' });
  const [selected, setSelected] = useState<string>();
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
      .deliveryProfiles()
      .then((state) => active && setProfile(profileState(state)))
      .catch((error) => active && setProfile({ status: 'error', message: apiErrorMessage(error) }));
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
  const judgedBy = job?.profile ?? (profile.status === 'ready' ? profile.profile : undefined);
  const unavailable = files.reduce((sum, file) => sum + countResults(file.rules).notMeasurable, 0);
  const detail = files.find((file) => file.path === selected && file.status === 'measured');
  // The files of a measurement that has ended were picked, so the Diagnostics tab can check them without picking them again.
  const measuredPaths = ended ? files.map((file) => file.path) : [];

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      <Heading title="Delivery">
        Measure your rendered chapter files against the delivery profile of the platform you upload to, rule by rule, and check them for clipping, level shifts
        and room-tone changes. Your files are only read, never changed.
      </Heading>
      <Tabs value={tab} onChange={setTab} className="flex flex-col gap-4">
        <TabList label="Delivery views" activation="automatic">
          <Tab value="measurements">Measurements</Tab>
          <Tab value="diagnostics">Diagnostics</Tab>
        </TabList>
        <TabPanel value="measurements" className="flex flex-col gap-4">
          <DeliveryProfilePanel state={profile} openSettings={openSettings} />
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
            {job?.profileNotice && files.length > 0 && (
              <p role="status" className="mt-2 text-sm" style={{ color: 'var(--warn-text)' }}>
                {job.profileNotice}
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
                  <p aria-live="polite">
                    {job.message}
                    {job.profile ? ` Judged against ${deliveryProfileTitle(job.profile)}.` : ''}
                  </p>
                )}
                {job.profile && <JudgementSummary files={files} profile={job.profile} />}
              </div>
            )}
            {files.length > 0 ? (
              <>
                {/* tabIndex: the table scrolls sideways in a narrow window, and a scrolling region must be reachable by keyboard. */}
                <div
                  tabIndex={0}
                  className="overflow-x-auto focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:outline-none focus-visible:ring-inset"
                >
                  {judgedBy && <MeasurementsTable files={files} profile={judgedBy} selected={detail?.path} onSelect={setSelected} />}
                </div>
                <p className="mt-2 text-xs" style={MUTED}>
                  {unavailable > 0 ? 'Not measurable: the audio is silent, or too short for that measurement. It is never counted as met. ' : ''}
                  Loudness (LUFS) and true peak are shown in each file&apos;s detail for information. Press a file for every rule with its source.
                </p>
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
          {detail && judgedBy && <FileRulesPanel file={detail} profile={judgedBy} onClose={() => setSelected(undefined)} />}
        </TabPanel>
        <TabPanel value="diagnostics">
          <DiagnosticsTab measuredPaths={measuredPaths} />
        </TabPanel>
      </Tabs>
      <ReportExportPanel busy={running} />
    </div>
  );
}
