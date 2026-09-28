import type { ChapterStatus } from '../../api/contracts/manuscript';
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
 * The board's columns. Record, Edit and Proof come from the chapter's status and its current stage's readiness (the stage
 * recommendations, read live, Q8 A). Prep and Delivery have no per-chapter producer yet (prep depth, and a delivery check tied to a
 * chapter's file), so they say "Not available" rather than guess (the PRD's risk table).
 */
export const BOARD_COLUMNS: readonly BoardColumn[] = [
  { name: 'Recorded', kind: 'recorded' },
  { name: 'Record', kind: 'stage', stage: 'recording' },
  { name: 'Edit', kind: 'stage', stage: 'editing' },
  { name: 'Proof', kind: 'stage', stage: 'proofing' },
  // Last, so a narrow window shows the columns with real answers before it scrolls.
  { name: 'Prep', kind: 'unavailable' },
  { name: 'Delivery', kind: 'unavailable' },
];

/** One board cell. It only reads the chapter: the board never sets a status. Done and empty cells are the mock's compact
 * glyphs (PR10); a stage still being worked keeps its full word, since the mock has no glyph for those. */
export function boardCell(chapter: ProductionChapter, column: BoardColumn): StageGridCell {
  if (column.kind === 'unavailable') return { tone: 'neutral', label: DASH };
  if (column.kind === 'recorded') {
    return { tone: 'neutral', label: chapter.recordedSeconds === null ? DASH : formatLength(chapter.recordedSeconds) };
  }
  const at = STATUS_ORDER.indexOf(chapter.status);
  const stage = STATUS_ORDER.indexOf(column.stage);
  if (at > stage) return { tone: 'success', label: '✓' };
  if (at < stage) return { tone: 'neutral', label: DASH };
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
    return { action, reason: `Looks ready to move to ${STATUS_LABELS[readiness.target]}: confirm it on Home.` };
  }
  return { action, reason: readiness?.reason || 'In progress.' };
}
