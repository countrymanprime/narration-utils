import { useCallback, useEffect, useState } from 'react';
import { useApi } from '../../api/ApiContext';
import { apiErrorMessage } from '../../api/errorMessage';
import type { ProductionBurndownPoint, ProductionNextUpItem, ProductionOverview, ProductionTotals } from '../../api/contracts/production';
import type { Bootstrap } from '../../types';
import { chapterName } from '../../chapterName';
import { STATUS_LABELS } from '../../chapterStatus';
import { estimateFinishedHours } from '../../state';
import { Button } from '../primitives/Button';
import { Heading } from '../primitives/Heading';
import { Panel } from '../primitives/Panel';
import { StatusBadge } from '../primitives/StatusBadge';
import { StatStrip } from '../primitives/StatStrip';
import type { Notify } from '../primitives/Toast';
import { Tooltip } from '../primitives/Tooltip';
import { usePickupsRemaining, type PickupsRemaining } from './usePickupsRemaining';
import { ChapterBoard } from './ChapterBoard';
import { HoursLoggedChart } from './HoursLoggedChart';
import { paceLine, paceOf, todayOf } from './productionPace';
import { useManuscriptImport } from './ManuscriptImport';
import { PlanPanel } from './PlanPanel';
import { StatusReportPanel } from './StatusReportPanel';
import { deliveryDue, formatClock, formatPfh, formatRate, nextUpLine, stageHoursHint } from './productionFormat';

const MUTED = { color: 'var(--text-muted)' };
const DANGER = { color: 'var(--danger-text)' };

/** `burndown` is `null` when the hours logged could not be read: the pace and the chart say so instead of showing an empty book. */
type Load =
  { status: 'loading' } | { status: 'ready'; overview: ProductionOverview; burndown: ProductionBurndownPoint[] | null } | { status: 'error'; message: string };

/** The KPI row (mock 01): every figure measured or logged; the only estimate, the target runtime, says it is one. */
function Figures({ overview, pickups }: { overview: ProductionOverview; pickups: PickupsRemaining }) {
  const totals: ProductionTotals = overview.totals;
  const target = estimateFinishedHours(totals.wordCount);
  const rateHint =
    totals.effectiveRate !== null
      ? `${formatRate(totals.contractedAmount)} contracted ÷ hours logged`
      : totals.contractedAmount === null
        ? 'No contracted amount set yet'
        : 'No hours logged yet';
  const tiles = [
    {
      label: 'Finished audio',
      value: formatClock(totals.recordedSeconds, 'seconds'),
      unit: target > 0 ? `/ ~${formatClock(target, 'hours')}` : undefined,
      // One line, as mock 01's tile: the "~" on the target says it is estimated (from the words).
      hint: `${totals.measuredChapters} of ${totals.chapters} chapters measured`,
      progress: target > 0 ? Math.min(1, totals.recordedSeconds / 3600 / target) : undefined,
    },
    {
      label: 'Work time logged',
      value: formatClock(totals.hoursLogged, 'hours'),
      hint: stageHoursHint(totals.hoursByStage) || 'Nothing logged yet: start a timer on a chapter',
    },
    {
      label: 'Hours per finished hour',
      value: formatPfh(totals.bookPfh),
      unit: totals.bookPfh === null ? undefined : ': 1',
      hint: totals.bookPfh === null ? 'Not enough measured time and logged hours yet' : 'Hours logged ÷ measured audio',
    },
    { label: 'Effective rate', value: formatRate(totals.effectiveRate), unit: totals.effectiveRate === null ? undefined : '/hr', hint: rateHint },
    {
      label: 'Open pickups',
      value: pickups ? String(pickups.remaining) : '—',
      hint: pickups ? `of ${pickups.total} total` : 'Not counted yet: open Pickups with REAPER running',
    },
    // The ACX checks run on the mastered package, not per chapter, and nothing reports a result here yet (Master & QC owns them).
    { label: 'Delivery check', value: '—', hint: 'No delivery check run yet' },
  ];
  // Mock 01 draws the six figures as one card, its tiles divided by rules (StatStrip, ADR 0615).
  return <StatStrip label="Production figures" items={tiles.map((tile) => ({ key: tile.label, ...tile }))} />;
}

function NextUp({
  items,
  timerRunning,
  starting,
  onStart,
}: {
  items: ProductionNextUpItem[];
  timerRunning: boolean;
  starting: string | undefined;
  onStart: (item: ProductionNextUpItem) => void;
}) {
  return (
    <Panel
      title="Next up"
      subtitle={
        <span className="inline-flex items-center gap-1">
          ranked by deadline risk
          <Tooltip
            label="About this order"
            text="Held-back chapters first, then the least advanced (the book has one delivery date, so no chapter has its own)."
          />
        </span>
      }
    >
      {items.length === 0 ? (
        <p className="text-sm" style={MUTED}>
          Every chapter is finalized.
        </p>
      ) : (
        // Mock 01's list: each item a bold line and a muted one, split by rules. Stacked above the board (below 1280 px) it runs in
        // two columns, so the board still starts on the first screen.
        <ol aria-label="Next up" className="-my-2 grid gap-x-6 min-[768px]:grid-cols-2 min-[1280px]:grid-cols-1">
          {items.map((item) => {
            const name = chapterName(item);
            const { action, reason } = nextUpLine(item);
            return (
              <li
                key={item.chapterId}
                className="flex min-w-0 flex-col gap-0.5 border-t border-[var(--border)] py-2.5 first:border-t-0 min-[768px]:max-[1279px]:nth-2:border-t-0"
              >
                <span className="text-[0.9375rem] leading-[1.35] font-semibold [overflow-wrap:anywhere]">{name}</span>
                <span className="text-[0.8125rem] leading-[1.4] [overflow-wrap:anywhere]" style={MUTED}>
                  {action} · {reason}
                </span>
                {!timerRunning && (
                  <Button
                    variant="secondary"
                    size="sm"
                    className="mt-1.5 self-start"
                    aria-label={`Start timer on ${name}, ${STATUS_LABELS[item.stage]}`}
                    pending={starting === item.chapterId}
                    disabled={starting !== undefined && starting !== item.chapterId}
                    onClick={() => onStart(item)}
                  >
                    Start timer
                  </Button>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </Panel>
  );
}

/**
 * The Production home at `/` (stage-navigation-and-page-replacement.prd.md Phase 2, mock 01; production tracking PRD Phase 4,
 * delivered and deleted, ADR 0028): the book's figures, the chapter pipeline whose cells open each stage for the chapter, and the
 * chapters that most threaten the delivery date. It replaced Home: with no manuscript yet it is the import, and the import and the
 * credits prompt stay here. It reads one overview when it opens and after anything that changes it (Q8 A); readiness is the stage
 * suggestions' own verdict, never recomputed here. Only the stage timer and the narrator's own choices on the board write.
 */
export function ProductionPage({
  data,
  go,
  notify,
  goToScript,
  goToProofChapter,
  refreshBootstrap,
  onOverview,
}: {
  data: Bootstrap;
  go: (page: string) => void;
  notify: Notify;
  goToScript: (chapter: string, paragraph?: number) => void;
  goToProofChapter: (chapterId: string) => void;
  refreshBootstrap: () => Promise<void>;
  /** Every overview this page reads, for the header's running-timer chip. */
  onOverview?: (overview: ProductionOverview) => void;
}) {
  const api = useApi();
  const found = Boolean(data.manuscript);
  const manuscriptKey = data.manuscript ? `${data.manuscript.id}:${data.manuscript.importedAt}` : 'no-manuscript';
  const manuscriptImport = useManuscriptImport({ data, go, notify, refreshBootstrap });
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [problem, setProblem] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [starting, setStarting] = useState<string>();
  const [stopping, setStopping] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const pickups = usePickupsRemaining();

  const read = useCallback(async () => {
    try {
      const [overview, burndown] = await Promise.all([api.productionOverview(), api.productionBurndown().catch(() => null)]);
      setLoad({ status: 'ready', overview, burndown });
      onOverview?.(overview);
    } catch (error) {
      setLoad({ status: 'error', message: apiErrorMessage(error) });
    }
  }, [api, onOverview]);
  const reread = useCallback(() => void read(), [read]);

  useEffect(() => {
    if (!found) return;
    let active = true;
    Promise.all([api.productionOverview(), api.productionBurndown().catch(() => null)])
      .then(([overview, burndown]) => {
        if (!active) return;
        setLoad({ status: 'ready', overview, burndown });
        onOverview?.(overview);
      })
      .catch((error) => active && setLoad({ status: 'error', message: apiErrorMessage(error) }));
    return () => {
      active = false;
    };
  }, [api, found, manuscriptKey, onOverview]);

  const start = async (item: ProductionNextUpItem) => {
    setStarting(item.chapterId);
    setProblem(undefined);
    setNotice(undefined);
    try {
      const answer = await api.productionStartTimer(item.chapterId, item.stage);
      if (answer.status === 'refused') setProblem(answer.message);
      await read();
    } catch (error) {
      setProblem(apiErrorMessage(error));
    } finally {
      setStarting(undefined);
    }
  };

  const stop = async () => {
    setStopping(true);
    setProblem(undefined);
    try {
      const answer = await api.productionStopTimer();
      if (answer.stopped && load.status === 'ready') {
        const chapter = load.overview.chapters.find((candidate) => candidate.id === answer.session.chapterId);
        setNotice(`Timer stopped: the session on ${chapter ? chapterName(chapter) : answer.session.chapterId} is logged.`);
      }
      await read();
    } catch (error) {
      setProblem(apiErrorMessage(error));
    } finally {
      setStopping(false);
    }
  };

  const overview = found && load.status === 'ready' ? load.overview : undefined;
  const burndown = found && load.status === 'ready' ? load.burndown : null;
  const today = todayOf(overview?.deadline ?? null);
  const pace = overview && paceLine(paceOf({ points: burndown, totals: overview.totals, deadline: overview.deadline, today }));
  const running = overview?.running ?? null;
  const subtitle = overview
    ? [
        `${overview.totals.chapters} chapters`,
        `${overview.totals.wordCount.toLocaleString('en-US')} words`,
        deliveryDue(overview.deadline) || 'no delivery date set',
      ].join(' · ')
    : found
      ? 'Your time, pace and delivery date for this book.'
      : 'Import the manuscript to plan, record and deliver this book.';

  return (
    // Mock 01's content fills the window beside the rail (1176 px at 1440); the cap only keeps a very wide window readable.
    <div className="mx-auto flex max-w-[96rem] flex-col gap-4">
      {/* Mock 01 lines the actions up with the foot of the title and its subtitle. */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <Heading title="Production">
            {subtitle}
            {overview && (
              <Tooltip
                label="About these figures"
                text="Time is logged only while you run a timer, and every figure comes from logged hours and measured audio."
              />
            )}
          </Heading>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-2">
          {pace && <StatusBadge tone={pace.tone} label={pace.label} icon={<span aria-hidden className="size-1.5 rounded-full bg-current" />} />}
          <div role="group" aria-label="Production actions" className="flex flex-wrap items-center gap-2">
            {found && (
              <Button variant="secondary" onClick={() => void read()}>
                Refresh
              </Button>
            )}
            {found && manuscriptImport.chooseButton}
            {overview && (
              <Button variant="secondary" onClick={() => setReportOpen(true)}>
                Export status report
              </Button>
            )}
            {running && (
              <Button variant="primary" pending={stopping} onClick={() => void stop()}>
                Stop timer
              </Button>
            )}
          </div>
        </div>
      </div>
      {manuscriptImport.dialogs}
      {manuscriptImport.creditsBanner}
      {!found && (
        <Panel title="No imported manuscript">
          <p className="mt-1 text-sm" style={MUTED}>
            Import a Word, Markdown, plain text or EPUB manuscript to see its chapters here.
          </p>
          <div className="mt-3">{manuscriptImport.chooseButton}</div>
        </Panel>
      )}
      {found && load.status === 'loading' && (
        <p className="text-sm" style={MUTED}>
          Reading the production log…
        </p>
      )}
      {found && load.status === 'error' && (
        <p role="alert" className="text-sm" style={DANGER}>
          The production overview could not be read: {load.message}
        </p>
      )}
      {problem && (
        <p role="alert" className="text-sm" style={DANGER}>
          {problem}
        </p>
      )}
      {notice && !running && (
        <p role="status" className="text-sm">
          {notice}
        </p>
      )}
      {overview && (
        <>
          <Figures overview={overview} pickups={pickups} />
          {/* Mock 01 (ADR 0645): the board with Next up in a column beside it, once the board's six columns fit beside a 340 px
              column; stacked below that, Next up leads (it is where a timer starts). minmax(0, 1fr) lets the board's panel
              shrink to the window, its grid scrolling inside it. */}
          <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-4 min-[1280px]:grid-cols-[minmax(0,1fr)_21rem]">
            <ChapterBoard
              overview={overview}
              notify={notify}
              goToScript={goToScript}
              goToProofChapter={goToProofChapter}
              refreshKey={manuscriptKey}
              onChanged={reread}
              foot={<HoursLoggedChart points={burndown} deadline={overview.deadline} today={today} />}
            />
            <div className="-order-1 min-[1280px]:order-none">
              <NextUp items={overview.nextUp} timerRunning={running !== null} starting={starting} onStart={(item) => void start(item)} />
            </div>
          </div>
          <PlanPanel onSaved={() => void read()} />
          <StatusReportPanel open={reportOpen} onClose={() => setReportOpen(false)} />
        </>
      )}
    </div>
  );
}
