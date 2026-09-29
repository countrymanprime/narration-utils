import type { ProductionBurndownPoint, ProductionDeadline, ProductionTotals } from '../../api/contracts/production';
import type { StatusTone } from '../primitives/StatusBadge';

// The pace pill's projection (mock 01: "On track · at current pace done Oct 9"). It is a projection, worded as one, from two things
// the app measures: the day the first hours were logged and the chapters finalized since. Unknown until both exist, so it is
// never a guess; ADR 0320's rule (no estimate in PFH or the rate) is untouched, this is not either figure (owner, #510, 2026-09-29).

const DAY = 86_400_000;
const dayNumber = (date: string) => Math.floor(Date.parse(`${date}T00:00:00Z`) / DAY);
const dateOf = (day: number) => new Date(day * DAY).toISOString().slice(0, 10);

export type Pace = { kind: 'unknown'; reason: string } | { kind: 'done' } | { kind: 'projected'; finishDate: string; daysLate: number | null };

/** `points` is the book's burndown (`null` when it could not be read); `today` and the deadline are calendar dates. */
export function paceOf({
  points,
  totals,
  deadline,
  today,
}: {
  points: readonly ProductionBurndownPoint[] | null;
  totals: Pick<ProductionTotals, 'chapters' | 'finalizedChapters'>;
  deadline: ProductionDeadline | null;
  today: string;
}): Pace {
  const unfinished = totals.chapters - totals.finalizedChapters;
  if (totals.chapters > 0 && unfinished === 0) return { kind: 'done' };
  if (points === null) return { kind: 'unknown', reason: 'the hours could not be read' };
  if (points.length === 0) return { kind: 'unknown', reason: 'no hours logged yet' };
  if (totals.finalizedChapters === 0) return { kind: 'unknown', reason: 'no chapter finalized yet' };
  const elapsedDays = Math.max(1, dayNumber(today) - dayNumber(points[0].date) + 1);
  const daysToGo = Math.ceil((unfinished * elapsedDays) / totals.finalizedChapters);
  const finish = dayNumber(today) + daysToGo;
  return { kind: 'projected', finishDate: dateOf(finish), daysLate: deadline === null ? null : finish - dayNumber(deadline.date) };
}

const shortDate = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

/** The pill's tone and words: on track through the delivery date, a warning up to a week late, then danger. */
export function paceLine(pace: Pace): { tone: StatusTone; label: string } {
  if (pace.kind === 'done') return { tone: 'success', label: 'All chapters finalized' };
  if (pace.kind === 'unknown') return { tone: 'neutral', label: `Pace unknown · ${pace.reason}` };
  const done = `at current pace done ${shortDate(pace.finishDate)}`;
  if (pace.daysLate === null) return { tone: 'info', label: `At current pace done ${shortDate(pace.finishDate)}` };
  if (pace.daysLate <= 0) return { tone: 'success', label: `On track · ${done}` };
  return { tone: pace.daysLate <= 7 ? 'warning' : 'danger', label: `Behind · ${done} (${pace.daysLate} ${pace.daysLate === 1 ? 'day' : 'days'} late)` };
}

/** Today as a calendar date: the host's own (the delivery date less the days left) when a date is set, else the UTC day. */
export function todayOf(deadline: ProductionDeadline | null): string {
  return deadline === null ? new Date().toISOString().slice(0, 10) : dateOf(dayNumber(deadline.date) - deadline.daysLeft);
}
