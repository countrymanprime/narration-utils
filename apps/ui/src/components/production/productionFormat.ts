import type { ChapterStatus, RecordedUnavailable } from '../../api/contracts/manuscript';
import type { ProductionChapter, ProductionDeadline, ProductionNextUpItem } from '../../api/contracts/production';
import { STATUS_LABELS, STATUS_ORDER } from '../../chapterStatus';
import type { StageGridCell } from '../primitives/StageGrid';
import type { StatTileTone } from '../primitives/StatTile';

// The Production page's words and figures (production-tracking.prd.md Phase 4). Every figure is measured or logged (ADR 0320): an
// undefined one is a dash, never 0 and never an estimate, and nothing here projects a pace from the time logged so far.

const DASH = '—';

/** Hours or seconds as h:mm, to the nearest minute. */
export function formatClock(amount: number, unit: 'hours' | 'seconds'): string {
  const minutes = Math.round(unit === 'hours' ? amount * 60 : amount / 60);
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
}

/** A chapter's length as m:ss, to the nearest second. */
export function formatLength(seconds: number): string {
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

/** Hours worked per finished hour, to one decimal. */
export const formatPfh = (pfh: number | null) => (pfh === null ? DASH : pfh.toFixed(1));

/** The effective rate as a bare whole number: the amount is in the narrator's own currency, so no symbol is guessed. */
export const formatRate = (rate: number | null) => (rate === null ? DASH : Math.round(rate).toLocaleString('en-US'));

const STAGE_WORD: Record<ChapterStatus, string> = { not_started: 'prep', recording: 'record', editing: 'edit', proofing: 'proof', finalized: 'final' };

/** "record 5:40 · edit 3:55": the hours logged per stage, in pipeline order. */
export function stageHoursHint(hoursByStage: Partial<Record<ChapterStatus, number>>): string {
  return STATUS_ORDER.flatMap((stage) => {
    const hours = hoursByStage[stage];
    return hours === undefined || hours <= 0 ? [] : [`${STAGE_WORD[stage]} ${formatClock(hours, 'hours')}`];
  }).join(' · ');
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** How close the deadline is (ADR 0404): overdue is danger, a week or less with chapters still unfinished is a warning. */
export function deadlineFigure(deadline: ProductionDeadline | null, unfinished: number): { value: string; hint: string; tone: StatTileTone } {
  if (deadline === null) return { value: DASH, hint: 'No delivery date set yet', tone: 'neutral' };
  const due = new Date(`${deadline.date}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  const hint = `Due ${due}`;
  const { daysLeft } = deadline;
  const value = daysLeft < 0 ? `${plural(-daysLeft, 'day', 'days')} over` : daysLeft === 0 ? 'Today' : plural(daysLeft, 'day', 'days');
  if (unfinished === 0) return { value, hint, tone: 'success' };
  return { value, hint, tone: daysLeft < 0 ? 'danger' : daysLeft <= 7 ? 'warning' : 'neutral' };
}

type BoardColumn = { name: string; kind: 'recorded' } | { name: string; kind: 'stage'; stage: ChapterStatus } | { name: string; kind: 'unavailable' };

/**
 * The board's columns, in mock 01's order (ADR 0645): the length, then the stages in the order the work goes. Record, Edit and
 * Proof come from the chapter's status and its current stage's readiness (the stage recommendations, read live, Q8 A). Prep and
 * Delivery have no per-chapter producer yet (prep depth, and a delivery check tied to a chapter's file), so they are a dash rather
 * than a guess (the PRD's risk table).
 */
export const BOARD_COLUMNS: readonly BoardColumn[] = [
  { name: 'Recorded', kind: 'recorded' },
  { name: 'Prep', kind: 'unavailable' },
  { name: 'Record', kind: 'stage', stage: 'recording' },
  { name: 'Edit', kind: 'stage', stage: 'editing' },
  { name: 'Proof', kind: 'stage', stage: 'proofing' },
  { name: 'Delivery', kind: 'unavailable' },
];

// Why a chapter has no Recorded length, short enough for a board cell (actual-recorded-column.prd.md's reasons).
const UNRECORDED: Record<RecordedUnavailable, StageGridCell> = {
  unlinked: { tone: 'neutral', label: 'No track' },
  multiple_tracks: { tone: 'warning', label: '2+ tracks' },
  track_missing: { tone: 'danger', label: 'Track missing' },
  no_project: { tone: 'neutral', label: 'No project' },
};

/** Whether a stage column is the chapter's current stage: its own status, or Record for a chapter not started yet. */
export function isCurrentStage(chapter: Pick<ProductionChapter, 'status'>, column: BoardColumn): boolean {
  if (column.kind !== 'stage') return false;
  return column.stage === chapter.status || (chapter.status === 'not_started' && column.stage === 'recording');
}

/** What the board knows live, beyond the overview: a recording check running on the chapter (its percent, or `null` for a
 * background check with no percent yet), and evidence that changed since the narrator confirmed the stage. */
export type LiveCell = { checkingPercent?: number | null; contradiction?: boolean };

/** One board cell. It only reads the chapter: the board never sets a status. Done and empty cells are the mock's compact
 * glyphs (PR10); a stage still being worked keeps its full word, and so does a Recorded cell that says why it has no length. */
export function boardCell(chapter: ProductionChapter, column: BoardColumn, live: LiveCell = {}): StageGridCell {
  if (column.kind === 'unavailable') return { tone: 'neutral', label: DASH };
  if (column.kind === 'recorded') {
    return chapter.recordedSeconds === null
      ? UNRECORDED[chapter.recordedUnavailable ?? 'unlinked']
      : { tone: 'neutral', label: formatLength(chapter.recordedSeconds) };
  }
  if (column.stage === 'recording' && live.checkingPercent !== undefined) {
    // The percent alone, as mock 01 draws a stage under way: the cell is 58 px (ADR 0645) and the slide-over says what runs.
    return { tone: 'progress', label: live.checkingPercent === null ? 'Checking' : `${Math.floor(live.checkingPercent)}%` };
  }
  const at = STATUS_ORDER.indexOf(chapter.status);
  const stage = STATUS_ORDER.indexOf(column.stage);
  if (at > stage) return { tone: 'success', label: '✓' };
  if (at < stage) return { tone: 'neutral', label: DASH };
  // "Changed": the summary chip over the board says whose evidence changed, and the cell is 58 px (ADR 0645).
  if (live.contradiction) return { tone: 'warning', label: 'Changed' };
  switch (chapter.readiness?.verdict) {
    case 'recommended':
      return { tone: 'info', label: 'Ready' };
    case 'not_ready':
      return { tone: 'warning', label: 'Not ready' };
    case 'unknown':
      return { tone: 'progress', label: 'Not checked' };
    default:
      return { tone: 'progress', label: 'In progress' };
  }
}

/** A credits row's cell (credits-in-chapter-table.prd.md): its status, and, since Phase 3, its own measured Recorded
 * figure - the same track-based measurement a manuscript row's Recorded cell shows (ADR 0193), never an estimate. */
export function creditsCell(
  row: { status: ChapterStatus; template?: unknown; recordedSeconds?: number; recordedUnavailable?: RecordedUnavailable },
  column: BoardColumn,
): StageGridCell {
  if (column.kind === 'unavailable') return { tone: 'neutral', label: DASH };
  if (column.kind === 'recorded') {
    if (!row.template) return { tone: 'neutral', label: 'Not set up' };
    return row.recordedSeconds === undefined
      ? UNRECORDED[row.recordedUnavailable ?? 'unlinked']
      : { tone: 'neutral', label: formatLength(row.recordedSeconds) };
  }
  const at = STATUS_ORDER.indexOf(row.status);
  const stage = STATUS_ORDER.indexOf(column.stage);
  if (at > stage) return { tone: 'success', label: '✓' };
  if (at < stage) return { tone: 'neutral', label: DASH };
  return { tone: 'progress', label: 'In progress' };
}

const ACTION: Partial<Record<ChapterStatus, string>> = {
  not_started: 'Start recording',
  recording: 'Finish recording',
  editing: 'Finish editing',
  proofing: 'Finish proofing',
};

/** What to do next on a listed chapter, and why it is listed. */
export function nextUpLine(item: ProductionNextUpItem): { action: string; reason: string } {
  const action = ACTION[item.stage] ?? STATUS_LABELS[item.stage];
  if (item.stage === 'not_started') return { action, reason: 'Not started yet.' };
  const readiness = item.readiness;
  if (readiness?.verdict === 'recommended' && readiness.target) {
    return { action, reason: `Looks ready to move to ${STATUS_LABELS[readiness.target]}: confirm it from its cell on the board.` };
  }
  return { action, reason: readiness?.reason || 'In progress.' };
}

/** The page subtitle's delivery part (mock 01: "delivery due Oct 14 (18 days)"); empty with no delivery date set. */
export function deliveryDue(deadline: ProductionDeadline | null): string {
  if (deadline === null) return '';
  const due = new Date(`${deadline.date}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const { daysLeft } = deadline;
  if (daysLeft < 0) return `delivery was due ${due} (${plural(-daysLeft, 'day', 'days')} over)`;
  return `delivery due ${due} (${daysLeft === 0 ? 'today' : plural(daysLeft, 'day', 'days')})`;
}
