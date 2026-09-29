import type { ProductionBurndownPoint, ProductionDeadline } from '../../api/contracts/production';
import { SectionLabel } from '../primitives/SectionLabel';
import { formatClock } from './productionFormat';

const MUTED = { color: 'var(--text-muted)' };
const DAY = 86_400_000;
const WIDTH = 520;
const HEIGHT = 64;
const PAD = 4;

const day = (date: string) => Math.floor(Date.parse(`${date}T00:00:00Z`) / DAY);
const shortDate = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

/**
 * Mock 01's chart under the board, drawn from what the app has: the book's hours logged, added up day by day
 * (`productionBurndown`), to today, with the delivery date marked. The mock's "finished hours vs plan" needs a per-day history of
 * finished audio and a plan the app does not keep (asked on #510), so there is no plan line and nothing is projected here.
 * `points` is `null` when the hours could not be read.
 */
export function HoursLoggedChart({
  points,
  deadline,
  today,
}: {
  points: readonly ProductionBurndownPoint[] | null;
  deadline: ProductionDeadline | null;
  today: string;
}) {
  const label = (
    <div className="min-w-0">
      <SectionLabel as="h3">Hours logged</SectionLabel>
      <p className="text-[0.9375rem] leading-[1.35]">cumulative{deadline ? ` · delivery ${shortDate(deadline.date)}` : ''}</p>
    </div>
  );
  if (points === null || points.length === 0) {
    return (
      <div className="flex flex-wrap items-center gap-x-8 gap-y-2 border-t border-[var(--border)] p-4">
        {label}
        <p className="text-sm" style={MUTED}>
          {points === null ? 'The hours logged could not be read.' : 'No hours logged yet: start a timer on a chapter.'}
        </p>
      </div>
    );
  }
  const first = day(points[0].date);
  const last = day(points[points.length - 1].date);
  const end = Math.max(last, day(today), deadline ? day(deadline.date) : 0);
  const span = Math.max(1, end - first);
  const peak = Math.max(1, ...points.map((point) => point.hoursLogged));
  const x = (d: number) => PAD + ((d - first) / span) * (WIDTH - 2 * PAD);
  const y = (hours: number) => HEIGHT - PAD - (hours / peak) * (HEIGHT - 2 * PAD);
  const drawn = points.map((point) => `${x(day(point.date)).toFixed(1)},${y(point.hoursLogged).toFixed(1)}`);
  const total = points[points.length - 1].hoursLogged;
  const nowX = x(Math.max(last, day(today)));
  const name = `Hours logged: ${formatClock(total, 'hours')} over ${points.length} ${points.length === 1 ? 'day' : 'days'}${
    deadline ? `, delivery due ${shortDate(deadline.date)}` : ''
  }`;
  return (
    <div className="flex flex-wrap items-center gap-x-8 gap-y-2 border-t border-[var(--border)] p-4">
      {label}
      <svg role="img" aria-label={name} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="h-16 min-w-0 flex-1 basis-64 overflow-visible">
        <line x1={PAD} x2={WIDTH - PAD} y1={HEIGHT - PAD} y2={HEIGHT - PAD} stroke="var(--border)" strokeWidth="1" />
        {deadline && (
          <line
            x1={x(day(deadline.date))}
            x2={x(day(deadline.date))}
            y1={PAD}
            y2={HEIGHT - PAD}
            stroke="var(--text-muted)"
            strokeWidth="1"
            strokeDasharray="2 3"
          />
        )}
        <polyline
          points={(day(today) > last ? [...drawn, `${nowX.toFixed(1)},${y(total).toFixed(1)}`] : drawn).join(' ')}
          fill="none"
          stroke="var(--accent)"
          strokeWidth="2"
          strokeLinejoin="round"
        />
        <circle cx={nowX} cy={y(total)} r="3.5" fill="var(--accent)" />
      </svg>
    </div>
  );
}
