import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiErrorMessage, describeApiError } from '../../api/errorMessage';
import type { DawCapabilities } from '../../api/contracts/daw';
import type { ChapterStatus } from '../../api/contracts/manuscript';
import type { ProductionOverview, ProductionPlan, ProductionTotals } from '../../api/contracts/production';
import { chapterName } from '../../chapterName';
import { useOpenPickups } from '../pickups/useOpenPickups';
import { usePort } from '../../ports/usePort';
import type { Bootstrap } from '../../types';
import { creditsEntries, creditsKindOfId, ownsOpeningCredits } from '../credits/creditsEntries';
import { useCreditsRows } from '../credits/useCreditsRows';
import { Panel } from '../primitives/Panel';
import { StatStrip } from '../primitives/StatStrip';
import type { Notify } from '../primitives/Toast';
import { openCheckRecordings } from '../recordingcheck/openCheckRecordings';
import { fmtD, parseIso } from '../schedule/dates';
import { WPH } from '../schedule/estimates';
import { calc, scheduleChapters } from '../schedule/progress';
import { useRefreshOnFocus } from '../stages/useRefreshOnFocus';
import { useStageRecommendations } from '../stages/useStageRecommendations';
import { chapterCheckStatus } from './chapterCheckStatus';
import { useManuscriptImport } from './ManuscriptImport';
import { planStart, recordedSeries, weekFigures } from './measured/measured.selectors';
import { useMeasured } from './measured/useMeasured';
import { CheckCountsCard } from './overview/CheckCountsCard';
import { KpiRow } from './overview/KpiRow';
import { checkCounts, deliveryCounts, stageSegments, type OverviewTarget } from './overview/overviewFigures';
import { ProgressChart } from './overview/ProgressChart';
import { StageBar } from './overview/StageBar';
import { WeekCard } from './overview/WeekCard';
import { DawBanner } from './pipeline/DawBanner';
import { DAW_CONNECT_GRACE_MS, useConnectGrace } from './pipeline/dawConnectGrace';
import { NextUp } from './pipeline/NextUp';
import { NoManuscript } from './pipeline/NoManuscript';
import { pickupChapters } from './pipeline/nextUpSources';
import { PageHeader } from './pipeline/PageHeader';
import { PipelineTable } from './pipeline/PipelineTable';
import { pipelineChapters } from './pipeline/pipelineChapters';
import { buildPipelineRows, type GoTarget } from './pipeline/pipelineRows';
import { useStageTimer } from './pipeline/useStageTimer';
import { formatClock, formatPfh, formatRate, stageHoursHint } from './productionFormat';
import { openReportDialog } from './report/openReportDialog';
import { TargetInfoButton } from './target/TargetInfoButton';
import { PIPELINE_AREA, useChapterTools } from './useChapterTools';
import { useChapterSyncToast } from './useChapterSyncToast';
import { usePipelineSources } from './usePipelineSources';
import { addressPath } from '../../navigation/address';

const DANGER = { color: 'var(--danger-text)' };

type Load = { status: 'loading' } | { status: 'ready'; overview: ProductionOverview } | { status: 'error'; message: string };

/** Proof on one chapter's notes (`?chapter=`), or on all of them. */
const proofAt = (chapterId?: string) => addressPath({ page: 'proof', chapter: chapterId });

const isNarration = (chapter: { contentKind?: string }) => !chapter.contentKind || chapter.contentKind === 'narration';

/**
 * The stage timer's three figures, kept as built (SN0-Q4: the mock has no timer, PFH or effective rate, so they stay). Drawn only once
 * time is logged or a timer runs, so the page is the mock's until then.
 */
function TimerFigures({ overview }: { overview: ProductionOverview }) {
  const totals: ProductionTotals = overview.totals;
  if (totals.hoursLogged <= 0 && !overview.running) return null;
  const rateHint =
    totals.effectiveRate !== null
      ? `${formatRate(totals.contractedAmount)} contracted ÷ hours logged`
      : totals.contractedAmount === null
        ? 'No contracted amount set yet'
        : 'No hours logged yet';
  return (
    <StatStrip
      label="Stage timer figures"
      items={[
        {
          key: 'logged',
          label: 'Work time logged',
          value: formatClock(totals.hoursLogged, 'hours'),
          hint: stageHoursHint(totals.hoursByStage) || 'Nothing logged yet',
        },
        {
          key: 'pfh',
          label: 'Hours per finished hour',
          value: formatPfh(totals.bookPfh),
          unit: totals.bookPfh === null ? undefined : ': 1',
          hint: totals.bookPfh === null ? 'Not enough measured time and logged hours yet' : 'Hours logged ÷ measured audio',
        },
        {
          key: 'rate',
          label: 'Effective rate',
          value: formatRate(totals.effectiveRate),
          unit: totals.effectiveRate === null ? undefined : '/hr',
          hint: rateHint,
        },
      ]}
    />
  );
}

/**
 * The Production home at `/` (the Studio Next mock's Production page): the header with the verdict, the KPI row, where the book stands,
 * this week and the recording check, the chapter pipeline beside Next up and the recorded-vs-plan chart. With no manuscript it is the
 * import. It composes the pieces the earlier slices built and reads their data through the ports; the stage timer, its figures and the
 * features the mock has no equivalent for (the row menu's chapter track, status override and checks, the credits rows, the Restore list)
 * stay as built.
 */
const CONNECT_POLLS = 10;
const CONNECT_POLL_MS = 1000;

export function ProductionPage({
  data,
  go,
  notify,
  goToScript,
  goToEditing,
  goToBooth,
  refreshBootstrap,
  onOverview,
  onManuscriptChanged,
  dawConnectGraceMs = DAW_CONNECT_GRACE_MS,
}: {
  data: Bootstrap;
  go: (page: string) => void;
  notify: Notify;
  goToScript: (chapter: string, paragraph?: number) => void;
  /** Opens the Editing page at a chapter (the recording check's Open in Editing). */
  goToEditing: (chapterId: string) => void;
  /** Opens the Booth, on a chapter when one is given. */
  goToBooth: (chapterId?: string) => void;
  refreshBootstrap: () => Promise<void>;
  /** Every overview this page reads, for the header's running-timer chip. */
  onOverview?: (overview: ProductionOverview) => void;
  /** Says a chapter's status or kind changed here, so the chapter list other pages read is read again (`MANUSCRIPT_CHANGED`). */
  onManuscriptChanged?: () => void;
  /** How long after the app opens an unconnected DAW shows as connecting rather than not running (tests pass 0). */
  dawConnectGraceMs?: number;
}) {
  const settling = useConnectGrace(dawConnectGraceMs);
  const production = usePort('production');
  const chapterSyncPort = usePort('chapterSync');
  const measurements = usePort('measurements');
  const daw = usePort('daw');
  const project = usePort('project');
  const system = usePort('system');
  const found = Boolean(data.manuscript);
  const manuscriptKey = data.manuscript ? `${data.manuscript.id}:${data.manuscript.importedAt}` : 'no-manuscript';
  const manuscriptImport = useManuscriptImport({ data, go, notify, refreshBootstrap });
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [plan, setPlan] = useState<ProductionPlan>();
  const [caps, setCaps] = useState<DawCapabilities>();
  const today = useMemo(() => new Date(), []);

  const read = useCallback(async () => {
    // With no manuscript the page is the import: there is nothing to read.
    if (!found) return;
    try {
      const [overview, nextPlan] = await Promise.all([production.productionOverview(), production.productionPlan()]);
      setLoad({ status: 'ready', overview });
      setPlan(nextPlan);
      onOverview?.(overview);
    } catch (error) {
      setLoad({ status: 'error', message: apiErrorMessage(error) });
    }
  }, [found, production, onOverview]);

  useEffect(() => {
    void read();
  }, [manuscriptKey, read]);

  const readCaps = useCallback(() => {
    daw.capabilities().then(setCaps, () => setCaps(undefined));
  }, [daw]);
  useEffect(() => readCaps(), [readCaps]);
  // The host pushes the DAW picture whenever it changes (a heartbeat starts or stops, a bridge session is attached), so the banner
  // follows without the narrator pressing Retry.
  useEffect(() => daw.subscribeCapabilities?.(setCaps), [daw]);
  // The banner's Retry reads the DAW again and, when it is still not running, says so (the mock's toast); a DAW now running drops the banner.
  const retryDaw = useCallback(() => {
    daw.capabilities().then(
      (next) => {
        setCaps(next);
        notify(next.reachable ? `${next.daw} is connected.` : `Still not running. Start ${next.daw} and try again.`);
      },
      (error: unknown) => notify(describeApiError(error), 'error'),
    );
  }, [daw, notify]);

  // Connect starts or reaches REAPER with the launcher (a REAPER already open runs it in place), then reads the DAW until the bridge answers.
  const [connecting, setConnecting] = useState(false);
  const connectDaw = useCallback(async () => {
    setConnecting(true);
    try {
      await system.saveSettings('DAW', 'global', { auto_start_launcher: 'true' });
      await project.launchDaw();
      notify('Connecting to REAPER…');
      for (let attempt = 0; attempt < CONNECT_POLLS; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, CONNECT_POLL_MS));
        const next = await daw.capabilities();
        setCaps(next);
        if (next.reachable) {
          notify(`${next.daw} is connected.`);
          return;
        }
      }
      notify('REAPER has not connected yet. Press Retry in a moment.');
    } catch (error) {
      notify(describeApiError(error), 'error');
    } finally {
      setConnecting(false);
    }
  }, [daw, project, system, notify]);

  // The open lines of the Pickups page's list, so the tile, Next up and the pickup hours count what that page lists.
  const openLines = useOpenPickups();
  const openPickups = openLines?.length ?? 0;
  const sessionIds = useMemo(() => (openLines ?? []).filter((line) => line.included).map((line) => line.id), [openLines]);

  const measured = useMeasured(measurements, '', sessionIds);
  const pipelineSources = usePipelineSources(found, manuscriptKey);
  const timer = useStageTimer(production, read);

  const overview = found && load.status === 'ready' ? load.overview : undefined;
  const narrated = useMemo(() => (overview ? overview.chapters.filter(isNarration) : []), [overview]);
  const nameOf = useCallback(
    (chapterId: string) => {
      const chapter = narrated.find((c) => c.id === chapterId);
      return chapter ? chapterName(chapter) : chapterId;
    },
    [narrated],
  );

  const stages = useStageRecommendations({ refreshKey: manuscriptKey, notify, onStatus: () => void read() });
  const refreshStages = stages.refresh;
  const onChanged = useCallback(() => {
    void read();
    void refreshStages();
    onManuscriptChanged?.();
  }, [read, refreshStages, onManuscriptChanged]);

  const onGo = (target: GoTarget | OverviewTarget, chapterId?: string) => {
    // A credits row is not a chapter: Script opens its card, the Booth reads it, Editing's check is the credits panel, and Proof has no chapter for it.
    const credits = chapterId ? creditsKindOfId(chapterId) : undefined;
    if (target === 'script') return credits ? go(addressPath({ page: 'script', credits })) : chapterId ? goToScript(chapterId) : go('/script');
    if (target === 'booth') return goToBooth(chapterId);
    if (target === 'editing') return credits ? tools.openCredits(credits) : chapterId ? tools.openEditingCheck(chapterId) : go('/editing');
    if (target === 'proof') return go(proofAt(credits ? undefined : chapterId));
    if (target === 'pickups') return go('/pickups');
    if (target === 'master') return go('/master');
    return go('/schedule');
  };

  // The opening and closing credits are rows of the pipeline, in the places the mock puts them and the Script list draws them.
  const credits = useCreditsRows(manuscriptKey, (error) => notify(describeApiError(error), 'error'));
  const ownsOpening = ownsOpeningCredits(overview?.chapters);
  const entries = useMemo(() => creditsEntries(credits.rows, ownsOpening), [credits.rows, ownsOpening]);
  const pipelineRows = useMemo(() => (overview ? pipelineChapters(overview.chapters, entries) : []), [overview, entries]);

  const tools = useChapterTools({
    rows: pipelineRows,
    credits,
    notify,
    go: { script: (id) => goToScript(id), booth: (id) => goToBooth(id), proof: (id) => go(proofAt(id)), master: () => go('/master') },
    goToScript,
    goToEditing,
    active: found,
    refreshKey: manuscriptKey,
    onChanged,
    daw: {
      name: caps && caps.daw !== 'none' ? caps.daw : 'your DAW',
      unavailable: !caps
        ? 'Checking the audio engine…'
        : caps.capabilities.track_select?.available
          ? undefined
          : caps.capabilities.track_select?.message || 'This audio engine cannot select a track.',
    },
  });

  // Chapter sync: the batch toast with Undo, and a re-read of the chapters on every later `chaptersync:state`.
  const sync = useChapterSyncToast({
    api: chapterSyncPort,
    notify,
    trackName: (guid) => tools.trackLinks?.tracks.find((track) => track.guid === guid)?.name,
    onState: () => {
      tools.reload();
      onChanged();
    },
  });

  // The narrator saving the project in the DAW while the page stays open.
  useRefreshOnFocus(() => {
    tools.reload();
    onChanged();
  }, stages.busy);

  if (!found) {
    return (
      <>
        {manuscriptImport.dialogs}
        <NoManuscript projectName={data.projectName} importButton={manuscriptImport.chooseButton} onSetDueDate={() => go('/schedule')} />
      </>
    );
  }

  const record = caps
    ? { ok: Boolean(caps.capabilities.record?.available), reason: caps.capabilities.record?.message ?? '' }
    : { ok: false, reason: 'Checking the audio engine…' };
  const due = plan?.deadline ? parseIso(plan.deadline) : null;
  const k = calc(scheduleChapters(narrated), today, due, openPickups);
  const start = planStart(today);
  const log = measured.answers?.takeLog ?? { ok: false as const, reason: 'Reading the take log…' };
  const narrationIds = new Set(narrated.map((c) => c.id));
  const counts = checkCounts(sync?.chapters ?? [], narrationIds);
  const recordingChapter = narrated.find((c) => c.status === 'recording');
  const finishedOf = (words: number) => (words / WPH) * 3600;
  const recordedHours = narrated.reduce((a, c) => a + (c.recordedSeconds ?? 0), 0) / 3600;
  const recommendations = stages.state.byChapter;
  // Open lines per chapter from the Pickups list, so a chapter's Pickups cell and the tile above add up. Nothing is claimed until the list is read.
  const pickupsByChapter = openLines ? Object.fromEntries(narrated.map((c) => [c.id, openLines.filter((line) => line.chapterId === c.id).length])) : undefined;
  const rows = buildPipelineRows(pipelineRows, {
    proof: pipelineSources.proof,
    master: pipelineSources.master,
    pickups: pickupsByChapter,
    // A chapter's Prep is the Script page's prep record; a credits row's is its template's tokens. Absent until read: "Not measured yet".
    prep: {
      ...pipelineSources.prep,
      ...Object.fromEntries([entries.opening, entries.closing].flatMap((entry) => (entry ? [[entry.id, entry.prep] as const] : []))),
    },
    checks: Object.fromEntries(
      narrated.map((c) => {
        const link = tools.trackLinks?.chapters.find((entry) => entry.chapterId === c.id);
        const syncRow = sync?.chapters.find((entry) => entry.chapterId === c.id);
        return [c.id, chapterCheckStatus(link, syncRow, syncRow?.checking ?? false)];
      }),
    ),
  });
  const pickupMinutes = measured.answers
    ? measured.answers.pickupSessionSeconds.ok
      ? { ok: true as const, value: Math.round(measured.answers.pickupSessionSeconds.value / 60) }
      : measured.answers.pickupSessionSeconds
    : { ok: false as const, reason: 'Reading the pickup sessions…' };

  return (
    <div className="mx-auto flex max-w-[96rem] flex-col gap-4">
      {caps && !caps.reachable && caps.daw !== 'none' && (
        <DawBanner
          reachable={false}
          daw={caps.daw}
          onRetry={retryDaw}
          onConnect={connectDaw}
          connecting={connecting}
          settling={settling}
          onUseBuiltIn={() => go('/settings')}
        />
      )}
      <PageHeader
        chapters={narrated.length}
        words={k.words}
        k={k}
        today={today}
        due={due}
        record={record}
        timerRunning={Boolean(overview?.running)}
        stopping={timer.stopping}
        onStopTimer={() => void timer.stop(nameOf)}
        onStartSession={() => goToBooth(recordingChapter?.id)}
        onExport={() => openReportDialog({ projectName: data.projectName, asOf: fmtD(today) })}
        onOpenSchedule={() => go('/schedule')}
      />
      {manuscriptImport.dialogs}
      {manuscriptImport.creditsBanner}
      {load.status === 'loading' && (
        <p role="status" className="text-sm text-[var(--text-muted)]">
          Reading the production log…
        </p>
      )}
      {load.status === 'error' && (
        <p role="alert" className="text-sm" style={DANGER}>
          The production overview could not be read: {load.message}
        </p>
      )}
      {timer.problem && (
        <p role="alert" className="text-sm" style={DANGER}>
          {timer.problem}
        </p>
      )}
      {timer.notice && !overview?.running && (
        <p role="status" className="text-sm">
          {timer.notice}
        </p>
      )}
      {overview && (
        <>
          <KpiRow
            k={k}
            wph={WPH}
            recordedSeconds={recordedHours * 3600}
            due={due}
            openPickups={openPickups}
            pickupMinutes={pickupMinutes}
            delivery={deliveryCounts([...narrationIds], pipelineSources.master)}
            onGo={(target) => onGo(target)}
            targetInfo={<TargetInfoButton />}
          />
          <TimerFigures overview={overview} />
          <div className="grid grid-cols-[minmax(0,1fr)] gap-4 min-[1024px]:grid-cols-3">
            <StageBar segments={stageSegments(narrated, WPH)} wph={WPH} />
            <WeekCard figures={weekFigures(log, today, start, due, k.words / WPH)} />
            <CheckCountsCard
              counts={counts}
              nameOf={nameOf}
              unavailable={caps && !caps.reachable ? `${caps.daw} is not running.` : undefined}
              onCheck={(ids) => openCheckRecordings(ids)}
            />
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-4 min-[1280px]:grid-cols-[minmax(0,1fr)_21.25rem]">
            <div className="flex min-w-0 flex-col gap-4">
              <Panel title="Chapter pipeline" flush>
                <div {...{ [PIPELINE_AREA]: '' }}>
                  <PipelineTable
                    rows={rows}
                    recommendations={recommendations}
                    onGo={(target, chapterId) => onGo(target, chapterId)}
                    notify={notify}
                    onStatus={() => onChanged()}
                  />
                </div>
              </Panel>
              {tools.panels}
            </div>
            <div className="flex min-w-0 flex-col gap-4">
              <Panel title="Next up">
                <NextUp
                  inputs={{
                    recording: recordingChapter
                      ? {
                          chapterId: recordingChapter.id,
                          stage: recordingChapter.status as ChapterStatus,
                          name: chapterName(recordingChapter),
                          words: recordingChapter.wordCount,
                          share:
                            recordingChapter.recordedSeconds !== null && recordingChapter.wordCount > 0
                              ? Math.min(1, recordingChapter.recordedSeconds / finishedOf(recordingChapter.wordCount))
                              : null,
                        }
                      : null,
                    pickups: openPickups > 0 ? { lines: openPickups, chapters: pickupChapters(openLines ?? [], nameOf) } : null,
                    failing: pipelineSources.failing,
                    changed: null,
                  }}
                  record={record}
                  onGo={(target, chapterId) => onGo(target, chapterId)}
                  timer={{ running: Boolean(overview.running), starting: timer.starting, onStart: (id, stage) => void timer.start(id, stage) }}
                />
              </Panel>
              <ProgressChart k={k} wph={WPH} start={start} today={today} due={due} recordedHours={recordedHours} series={recordedSeries(log, start)} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
