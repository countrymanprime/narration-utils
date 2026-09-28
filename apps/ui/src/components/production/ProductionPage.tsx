import { useCallback, useEffect, useState } from 'react';
import { useApi } from '../../api/ApiContext';
import { apiErrorMessage } from '../../api/errorMessage';
import type { ProductionNextUpItem, ProductionOverview, ProductionTotals } from '../../api/contracts/production';
import type { Bootstrap } from '../../types';
import { chapterName } from '../../chapterName';
import { STATUS_LABELS } from '../../chapterStatus';
import { estimateFinishedHours } from '../../state';
import { Button } from '../primitives/Button';
import { Heading } from '../primitives/Heading';
import { Panel } from '../primitives/Panel';
import { StatTile } from '../primitives/StatTile';
import type { Notify } from '../primitives/Toast';
import { Tooltip } from '../primitives/Tooltip';
import { ChapterBoard } from './ChapterBoard';
import { useManuscriptImport } from './ManuscriptImport';
import { PlanPanel } from './PlanPanel';
import { StatusReportPanel } from './StatusReportPanel';
import { deadlineFigure, deliveryDue, formatClock, formatPfh, formatRate, nextUpLine, stageHoursHint } from './productionFormat';

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

  const read = useCallback(async () => {
    try {
      const overview = await api.productionOverview();
      setLoad({ status: 'ready', overview });
      onOverview?.(overview);
    } catch (error) {
      setLoad({ status: 'error', message: apiErrorMessage(error) });
    }
  }, [api, onOverview]);
  const reread = useCallback(() => void read(), [read]);

  useEffect(() => {
    if (!found) return;
    let active = true;
    api
      .productionOverview()
      .then((overview) => {
        if (!active) return;
        setLoad({ status: 'ready', overview });
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
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
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
        <div role="group" aria-label="Production actions" className="flex flex-wrap items-center gap-2">
          {found && (
            <Button variant="ghost" onClick={() => void read()}>
              Refresh
            </Button>
          )}
          {found && manuscriptImport.chooseButton}
          {overview && (
            <Button variant="ghost" onClick={() => setReportOpen(true)}>
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
          <Figures overview={overview} />
          {/* Next up leads when stacked (it is where a timer starts); side by side only once the board fits beside it. minmax(0, 1fr)
              lets the board's panel shrink to the window, its grid scrolling inside it. */}
          <div className="grid grid-cols-[minmax(0,1fr)] gap-4 min-[1600px]:grid-cols-[minmax(0,1fr)_20rem]">
            <ChapterBoard
              overview={overview}
              notify={notify}
              goToScript={goToScript}
              goToProofChapter={goToProofChapter}
              refreshKey={manuscriptKey}
              onChanged={reread}
            />
            <div className="-order-1 min-[1600px]:order-none">
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
