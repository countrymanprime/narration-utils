import { useEffect, useRef, useState } from 'react';
import { useApi } from '../../api/ApiContext';
import { apiErrorMessage } from '../../api/errorMessage';
import type { DeliveryProfile, DeliveryProfilesState, MeasureFileResult, MeasureJob } from '../../types';
import { Button } from '../primitives/Button';
import { Heading } from '../primitives/Heading';
import { Panel } from '../primitives/Panel';
import { ProgressBar } from '../primitives/ProgressBar';
import { ToggleGroup } from '../primitives/ToggleGroup';
import { deliveryProfileKey, deliveryProfileTitle } from './deliveryProfile';
import { DeliveryPackagePanel } from './DeliveryPackagePanel';
import { DeliveryProfilePanel, type ProfileState } from './DeliveryProfilePanel';
import { DiagnosticsSection } from './DiagnosticsSection';
import { fileVerdict } from './fileVerdict';
import { FileRulesPanel } from './FileRulesPanel';
import { MasteringChain, useMasteringProviders } from './MasteringChain';
import type { MasterFocus } from './masterLink';
import { MasterToSpecPanel } from './MasterToSpecPanel';
import { PerFileChecks } from './PerFileChecks';
import { ReportExportPanel } from './ReportExportPanel';
import { useExportJobs } from './useExportJobs';
import { WhyItFails } from './WhyItFails';

/** How often a running measurement is read. */
const POLL_MS = 500;

const MUTED = { color: 'var(--text-muted)' };
const DANGER = { color: 'var(--danger-text)' };
const OK = { color: 'var(--ok-text)' };
const WARN = { color: 'var(--warn-text)' };

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** The panel's state from the profiles: the profile the project is judged against, the built-in it is based on, any notice. */
function profileState(state: DeliveryProfilesState): ProfileState {
  const profile = state.profiles.find((candidate) => deliveryProfileKey(candidate) === state.projectProfile);
  if (!profile) return { status: 'error', message: `the profile ${state.projectProfile} is not in the list` };
  const base = profile.basedOn ? state.profiles.find((candidate) => deliveryProfileKey(candidate) === profile.basedOn) : undefined;
  return { status: 'ready', profile, ...(base ? { basedOn: deliveryProfileTitle(base) } : {}), ...(state.notice ? { notice: state.notice } : {}) };
}

/** A platform tab's name: a built-in by its platform ("ACX"), a custom profile by the name the narrator gave it. */
const platformName = (profile: DeliveryProfile) => (profile.builtIn ? profile.platform : profile.name);

/** A rule's label inside a sentence: "RMS" and "MP3 format" keep their capitals, "Sample rate" becomes "sample rate". */
const lowerFirst = (label: string) => (/^[A-Z0-9]{2}/.test(label) ? label : label.charAt(0).toLowerCase() + label.slice(1));

/** A list in words: "a", "a and b", "a, b and c". */
const inWords = (items: readonly string[]) => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`);

/**
 * The measurement's result in sentences: which rules each file missed, or that every rule the app checks is met; and which rules
 * the app did not check, so the narrator checks them before uploading.
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
  const notChecked = profile.rules.filter((rule) => rule.scope === 'file' && !rule.off && rule.checkedBy !== 'measured').map((rule) => lowerFirst(rule.label));
  const unmeasurable = measured.some((file) => file.rules.some((result) => result.status === 'not_measurable'));
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
          {unmeasurable ? ', apart from values it could not measure' : ''}.
        </p>
      )}
      {notChecked.length > 0 && (
        <p className="mt-1" style={MUTED}>
          {plural(notChecked.length, 'rule', 'rules')} per file {notChecked.length === 1 ? 'is' : 'are'} not checked by the app ({inWords(notChecked)}): check{' '}
          {notChecked.length === 1 ? 'it' : 'them'} yourself before uploading.
        </p>
      )}
    </>
  );
}

/**
 * Master & QC (stage-navigation-and-page-replacement.prd.md Phase 8, mock 05; it replaces the Delivery page, ADR 0407): one page
 * for the book's finish. The platform tabs choose the delivery profile the project is judged against (the project's own choice,
 * the one Settings > Delivery also sets, ADR 0440); the per-file checks are the host's measurement of the rendered files, judged
 * rule by rule against it (ADR 0179), with why a file fails and a suggested fix beside the book's consistency; the mastering
 * chain is the project's row of the mastering port (ADR 0306), shown, not edited (ADR 0321); "Master all to spec…" masters and
 * encodes picked files, and the delivery package beside it assembles them for the chosen platform. Diagnostics and the report
 * follow below. The host keeps each job, so leaving the page and coming back shows them again. Nothing here changes a source file.
 */
export function MasterQcPage({ openSettings, focus }: { openSettings: () => void; focus?: MasterFocus }) {
  const api = useApi();
  const jobs = useExportJobs();
  const mastering = useMasteringProviders();
  const [job, setJob] = useState<MeasureJob>();
  const [jobError, setJobError] = useState<string>();
  const [profiles, setProfiles] = useState<DeliveryProfilesState>();
  const [profile, setProfile] = useState<ProfileState>({ status: 'loading' });
  const [platformProblem, setPlatformProblem] = useState<string>();
  const [choosingPlatform, setChoosingPlatform] = useState(false);
  const [selected, setSelected] = useState<string>();
  const [rulesOpen, setRulesOpen] = useState(false);
  const [problem, setProblem] = useState<string>();
  const [checking, setChecking] = useState(false);
  // A delivery finding on Proof opened here (delivery-platform-profiles.prd.md Phase 9, P12): its file is opened rule by rule once
  // the measurement is read, or the page says the file is not in it. Applied once per file and rule, so the narrator can close it.
  const [focusNote, setFocusNote] = useState<{ found: boolean; text: string }>();
  const appliedFocus = useRef<string | undefined>(undefined);
  const detailRef = useRef<HTMLDivElement>(null);

  const readProfiles = (state: DeliveryProfilesState) => {
    setProfiles(state);
    setProfile(profileState(state));
  };

  useEffect(() => {
    let active = true;
    api
      .measureState()
      .then((state) => active && setJob(state))
      .catch((error) => active && setJobError(apiErrorMessage(error)));
    api
      .deliveryProfiles()
      .then((state) => {
        if (!active) return;
        setProfiles(state);
        setProfile(profileState(state));
      })
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

  useEffect(() => {
    const key = focus ? `${focus.file}\n${focus.rule ?? ''}` : undefined;
    if (!focus || !key || appliedFocus.current === key || !job || job.phase === 'running') return;
    appliedFocus.current = key;
    const file = job.files.find((candidate) => candidate.path === focus.file && candidate.status === 'measured');
    const name = focus.file.split(/[\\/]/).pop() ?? focus.file;
    if (!file) {
      setFocusNote({ found: false, text: `${name} is not in the last measurement. Check it again to measure it and see its rules.` });
      return;
    }
    const rule = focus.rule ? job.profile?.rules.find((candidate) => candidate.id === focus.rule)?.label : undefined;
    setSelected(file.path);
    setRulesOpen(true);
    setFocusNote({ found: true, text: `Opened from a note on Proof: ${rule ? `${lowerFirst(rule)} in ` : ''}${file.name}.` });
  }, [focus, job]);

  useEffect(() => {
    if (focusNote?.found) detailRef.current?.scrollIntoView?.({ block: 'start' });
  }, [focusNote]);

  const files = job?.files ?? [];
  const ended = job !== undefined && (job.phase === 'success' || job.phase === 'cancelled' || job.phase === 'error');
  const judgedBy = job?.profile ?? (profile.status === 'ready' ? profile.profile : undefined);
  // The files of a measurement that has ended were picked, so they can be checked again (and diagnosed) without picking them again.
  const measuredPaths = ended ? files.map((file) => file.path) : [];
  const measured = files.filter((file) => file.status === 'measured');
  // The file "Why it fails" explains: the one the narrator pressed, else the first that fails.
  const detail = measured.find((file) => file.path === selected) ?? (selected ? undefined : measured.find((file) => fileVerdict(file) === 'fail'));
  const unavailable = measured.some((file) => file.rules.some((result) => result.status === 'not_measurable'));
  const current = profile.status === 'ready' ? profile.profile : undefined;

  const analyze = async (paths: string[]) => {
    setJob(await api.measureAnalyze(paths));
    setJobError(undefined);
    setSelected(undefined);
  };

  // "Re-check N files" measures the last measurement's files again; with none yet, the narrator picks them.
  const check = async () => {
    setChecking(true);
    setProblem(undefined);
    try {
      if (measuredPaths.length > 0) {
        await analyze(measuredPaths);
        return;
      }
      const picked = await api.measurePickFiles();
      if (picked.paths.length === 0) return;
      await analyze(picked.paths);
    } catch (error) {
      setProblem(apiErrorMessage(error));
    } finally {
      setChecking(false);
    }
  };

  const chooseOther = async () => {
    setChecking(true);
    setProblem(undefined);
    try {
      const picked = await api.measurePickFiles();
      if (picked.paths.length > 0) await analyze(picked.paths);
    } catch (error) {
      setProblem(apiErrorMessage(error));
    } finally {
      setChecking(false);
    }
  };

  const cancel = () => void api.measureCancel().then(setJob, (error) => setProblem(apiErrorMessage(error)));

  // A platform tab is the project's own choice of delivery profile: the host judges what was measured against it when it is next
  // read, so the page reads the measurement again.
  const choosePlatform = async (key: string) => {
    const next = profiles?.profiles.find((candidate) => deliveryProfileKey(candidate) === key);
    if (!next || key === profiles?.projectProfile) return;
    setChoosingPlatform(true);
    setPlatformProblem(undefined);
    try {
      readProfiles(await api.deliverySelectProfile('project', next.id, next.builtIn ? next.version : ''));
      setJob(await api.measureState());
    } catch (error) {
      setPlatformProblem(apiErrorMessage(error));
    } finally {
      setChoosingPlatform(false);
    }
  };

  const chain = mastering.providers?.providers.find((row) => row.name === mastering.providers?.effective);
  const platform = current ? platformName(current) : '…';

  return (
    <div className="mx-auto flex max-w-[96rem] flex-col gap-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Heading title="Master & QC" />
          {profiles && profiles.profiles.length > 0 && (
            <ToggleGroup
              label="Delivery platform"
              value={profiles.projectProfile}
              onChange={(key) => void choosePlatform(key)}
              options={profiles.profiles.map((candidate) => ({
                value: deliveryProfileKey(candidate),
                label: platformName(candidate),
                title: deliveryProfileTitle(candidate),
                disabled: choosingPlatform || running,
              }))}
              className="flex-wrap gap-1.5"
            />
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 lg:ml-auto">
          <Button variant="ghost" onClick={() => void jobs.pick()} pending={jobs.picking} disabled={jobs.exportRunning}>
            Master all to spec…
          </Button>
          <Button onClick={() => void check()} pending={checking} disabled={running}>
            {measuredPaths.length > 0 ? `Re-check ${plural(measuredPaths.length, 'file', 'files')}` : 'Check files…'}
          </Button>
        </div>
      </div>
      {platformProblem && (
        <p role="alert" className="text-sm" style={DANGER}>
          The platform was not changed: {platformProblem}
        </p>
      )}
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(19rem,23rem)]">
        <div className="flex min-w-0 flex-col gap-4">
          <Panel
            title="Per-file checks"
            actions={
              measuredPaths.length > 0 && (
                <Button variant="ghost" onClick={() => void chooseOther()} pending={checking} disabled={running}>
                  Choose other files…
                </Button>
              )
            }
          >
            <p className="mt-1 text-sm" style={MUTED}>
              Measured on the rendered files · true peak (ITU-R BS.1770){judgedBy ? ` · judged against ${deliveryProfileTitle(judgedBy)}` : ''}. Your files are
              only read, never changed.
            </p>
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
            {focusNote && !focusNote.found && (
              <p role="status" className="mt-2 text-sm" style={WARN}>
                {focusNote.text}
              </p>
            )}
            {job?.profileNotice && files.length > 0 && (
              <p role="status" className="mt-2 text-sm" style={WARN}>
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
                  {judgedBy && <PerFileChecks files={files} profile={judgedBy} selected={detail?.path} onSelect={setSelected} />}
                </div>
                <p className="mt-2 text-xs" style={MUTED}>
                  {unavailable ? 'A dash is a value the app could not measure (silence, or too short); it is never counted as met. ' : ''}
                  Press a file for why it fails, and for every rule with its source.
                </p>
              </>
            ) : (
              !running &&
              !jobError && (
                <p className="mt-2 text-sm" style={MUTED}>
                  Nothing measured yet. Check your rendered chapter files (WAV) to see them here.
                </p>
              )
            )}
          </Panel>
          {judgedBy && <WhyItFails file={detail} profile={judgedBy} files={files} rulesOpen={rulesOpen} onToggleRules={() => setRulesOpen((open) => !open)} />}
          <div ref={detailRef} className="flex scroll-mt-4 flex-col gap-2 empty:hidden">
            {detail && judgedBy && rulesOpen && focusNote?.found && (
              <p role="status" className="text-sm" style={MUTED}>
                {focusNote.text}
              </p>
            )}
            {detail && judgedBy && rulesOpen && (
              <FileRulesPanel
                file={detail}
                profile={judgedBy}
                onClose={() => {
                  setRulesOpen(false);
                  setFocusNote(undefined);
                }}
              />
            )}
          </div>
          <MasterToSpecPanel jobs={jobs} chainLabel={chain?.label} />
          <MasteringChain providers={mastering.providers} problem={mastering.problem} />
          <DiagnosticsSection measuredPaths={measuredPaths} />
          <ReportExportPanel busy={running} />
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <DeliveryPackagePanel profile={current} platform={platform} measure={job} jobs={jobs} />
          <DeliveryProfilePanel state={profile} openSettings={openSettings} />
        </div>
      </div>
    </div>
  );
}
