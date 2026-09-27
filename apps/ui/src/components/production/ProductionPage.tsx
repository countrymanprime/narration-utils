import { useCallback, useEffect, useState } from 'react';
import { useApi } from '../../api/ApiContext';
import { apiErrorMessage } from '../../api/errorMessage';
import type { ProductionNextUpItem, ProductionOverview, ProductionTotals } from '../../api/contracts/production';
import { chapterName } from '../../chapterName';
import { STATUS_LABELS } from '../../chapterStatus';
import { estimateFinishedHours } from '../../state';
import { Button } from '../primitives/Button';
import { Heading } from '../primitives/Heading';
import { Panel } from '../primitives/Panel';
import { StageGrid } from '../primitives/StageGrid';
import { StatTile } from '../primitives/StatTile';
import { Toolbar, ToolbarButton } from '../primitives/Toolbar';
import { BOARD_COLUMNS, boardCell, deadlineFigure, formatClock, formatPfh, formatRate, nextUpLine, stageHoursHint } from './productionFormat';

const MUTED = { color: 'var(--text-muted)' };
const DANGER = { color: 'var(--danger-text)' };

type Load = { status: 'loading' } | { status: 'ready'; overview: ProductionOverview } | { status: 'error'; message: string };

/** The KPI row (mock 01): every figure measured or logged; the only estimate, the target runtime, says it is one. */
function Figures({ overview }: { overview: ProductionOverview }) {
  const totals: ProductionTotals = overview.totals;
  const target = estimateFinishedHours(totals.wordCount);
  const unfinished = totals.chapters - totals.finalizedChapters;
  const deadline = deadlineFigure(overview.deadline, unfinished);
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
      hint: `${totals.measuredChapters} of ${totals.chapters} chapters measured; target estimated from words`,
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
    { label: 'Delivery date', value: deadline.value, hint: deadline.hint, tone: deadline.tone },
    {
      label: 'Chapters finalized',
      value: `${totals.finalizedChapters} / ${totals.chapters}`,
      progress: totals.chapters > 0 ? totals.finalizedChapters / totals.chapters : undefined,
    },
  ];
  return (
    <ul aria-label="Production figures" className="grid grid-cols-2 gap-3 min-[768px]:grid-cols-3 min-[1400px]:grid-cols-6">
      {tiles.map(({ label, ...tile }) => (
        <li key={label} className="min-w-0 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 shadow-[var(--shadow)]">
          <StatTile label={label} {...tile} />
        </li>
      ))}
    </ul>
  );
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
    <Panel title="Next up">
      <p className="mt-1 text-xs" style={MUTED}>
        Held-back chapters first, then the least advanced (the book has one delivery date, so no chapter has its own).
      </p>
      {items.length === 0 ? (
        <p className="mt-3 text-sm" style={MUTED}>
          Every chapter is finalized.
        </p>
      ) : (
        <ol aria-label="Next up" className="mt-2 grid gap-x-6 min-[768px]:grid-cols-2 min-[1200px]:grid-cols-3 min-[1600px]:grid-cols-1">
          {items.map((item) => {
            const name = chapterName(item);
            const { action, reason } = nextUpLine(item);
            return (
              <li key={item.chapterId} className="flex min-w-0 flex-col gap-1 border-t border-[var(--border)] py-2.5">
                <span className="font-semibold [overflow-wrap:anywhere]">{name}</span>
                <span className="text-sm">{action}</span>
                <span className="text-xs [overflow-wrap:anywhere]" style={MUTED}>
                  {reason}
                </span>
                {!timerRunning && (
                  <Button
                    variant="ghost"
                    className="self-start"
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
 * Production (docs/prds/production-tracking.prd.md Phase 4, mock 01): the book's figures, a chapter by stage board and the chapters
 * that most threaten the delivery date. It reads one overview when it opens and after each timer action (Q8 A); readiness is the stage
 * suggestions' own verdict, never recomputed here. The page never sets a chapter status: only the stage timer writes, and only when
 * the narrator starts or stops it.
 */
export function ProductionPage() {
  const api = useApi();
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [problem, setProblem] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [starting, setStarting] = useState<string>();
  const [stopping, setStopping] = useState(false);

  const read = useCallback(async () => {
    try {
      setLoad({ status: 'ready', overview: await api.productionOverview() });
    } catch (error) {
      setLoad({ status: 'error', message: apiErrorMessage(error) });
    }
  }, [api]);

  useEffect(() => {
    let active = true;
    api
      .productionOverview()
      .then((overview) => active && setLoad({ status: 'ready', overview }))
      .catch((error) => active && setLoad({ status: 'error', message: apiErrorMessage(error) }));
    return () => {
      active = false;
    };
  }, [api]);

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

  const overview = load.status === 'ready' ? load.overview : undefined;
  const running = overview?.running ?? null;
  const runningChapter = running ? overview?.chapters.find((chapter) => chapter.id === running.chapterId) : undefined;
  const chapters = overview?.chapters ?? [];

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Heading title="Production">
            {overview
              ? `${overview.totals.chapters} chapters · ${overview.totals.wordCount.toLocaleString('en-US')} words · ${overview.totals.finalizedChapters} finalized. Time is logged only while you run a timer, and every figure comes from logged hours and measured audio.`
              : 'Your time, pace and delivery date for this book.'}
          </Heading>
        </div>
        <Toolbar label="Production actions">
          <ToolbarButton
            render={
              <Button variant="ghost" onClick={() => void read()}>
                Refresh
              </Button>
            }
          />
        </Toolbar>
      </div>
      {load.status === 'loading' && (
        <p className="text-sm" style={MUTED}>
          Reading the production log…
        </p>
      )}
      {load.status === 'error' && (
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
      {running && (
        <div
          role="status"
          aria-label="Timer running"
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--border)] bg-[var(--accent-soft)] px-4 py-2.5"
        >
          <p className="min-w-0 text-sm [overflow-wrap:anywhere]">
            <span className="font-semibold">Timer running</span> on {runningChapter ? chapterName(runningChapter) : running.chapterId} ·{' '}
            {STATUS_LABELS[running.stage]}
          </p>
          <Button variant="primary" pending={stopping} onClick={() => void stop()}>
            Stop timer
          </Button>
        </div>
      )}
      {overview && (
        <>
          <Figures overview={overview} />
          {/* Next up leads when stacked (it is where a timer starts); side by side only once the board fits beside it. minmax(0, 1fr)
              lets the board's panel shrink to the window, its table scrolling inside it. */}
          <div className="grid grid-cols-[minmax(0,1fr)] gap-4 min-[1600px]:grid-cols-[20rem_minmax(0,1fr)]">
            <NextUp items={overview.nextUp} timerRunning={running !== null} starting={starting} onStart={(item) => void start(item)} />
            <Panel title="Chapter pipeline">
              <p className="mt-1 text-xs" style={MUTED}>
                Each stage&apos;s readiness is the stage suggestion shown on Home. Prep and Delivery are not available yet: no check reports them per chapter.
              </p>
              {chapters.length === 0 ? (
                <p className="mt-3 text-sm" style={MUTED}>
                  No chapters yet. Import a manuscript on Home to see its chapters here.
                </p>
              ) : (
                // tabIndex: the board scrolls sideways in a narrow window, and a scrolling region must be reachable by keyboard.
                <div
                  tabIndex={0}
                  className="mt-2 overflow-x-auto focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:outline-none focus-visible:ring-inset"
                >
                  <StageGrid
                    label="Chapter pipeline"
                    className="w-full [&_td]:whitespace-nowrap"
                    rows={chapters.map((chapter) => chapterName(chapter))}
                    columns={BOARD_COLUMNS.map((column) => column.name)}
                    cell={(row, col) => boardCell(chapters[row], BOARD_COLUMNS[col])}
                  />
                </div>
              )}
            </Panel>
          </div>
        </>
      )}
    </div>
  );
}
