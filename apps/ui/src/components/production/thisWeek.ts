import type { ProductionBurndownPoint } from '../../api/contracts/production';

const DAY = 86_400_000;
const dateOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export type WeekDay = { date: string; hours: number };

/**
 * Hours logged on each of the last seven days, today last, worked out from the book's cumulative log (`productionBurndown`), and their
 * total. `null` when the log could not be read: the card then says so instead of drawing an empty week.
 */
export function weekHours(points: readonly ProductionBurndownPoint[] | null, today: string): { days: WeekDay[]; total: number } | null {
  if (points === null) return null;
  const cumulativeBy = (date: string) => points.filter((point) => point.date <= date).at(-1)?.hoursLogged ?? 0;
  const end = Date.parse(`${today}T00:00:00Z`);
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = dateOf(end - (6 - index) * DAY);
    return { date, hours: cumulativeBy(date) - cumulativeBy(dateOf(Date.parse(`${date}T00:00:00Z`) - DAY)) };
  });
  return { days, total: days.reduce((sum, day) => sum + day.hours, 0) };
}
