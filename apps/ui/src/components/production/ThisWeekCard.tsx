import type { ProductionBurndownPoint } from '../../api/contracts/production';
import { Panel } from '../primitives/Panel';
import { formatClock } from './productionFormat';
import { weekHours } from './thisWeek';

const MUTED = { color: 'var(--text-muted)' };
const FIGURE = "font-['IBM_Plex_Mono',ui-monospace,monospace] text-[0.8125rem]";
const weekday = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });

function Row({ label, value, children }: { label: string; value: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 border-t border-[var(--border)] py-3 first:border-t-0 first:pt-0 last:pb-0">
      <div className="flex items-baseline justify-between gap-3 text-[0.9375rem]">
        <span>{label}</span>
        <span className={FIGURE}>{value}</span>
      </div>
      {children}
    </div>
  );
}

/**
 * Mock 01's "This week" card, with the rows the app can back: the hours logged in the last seven days, day by day. The mock's booked
 * booth hours, the last 24 hours recorded and the proofer's hand-off have no source yet (asked on #510), so those rows say so
 * instead of showing a number.
 */
export function ThisWeekCard({ points, today }: { points: readonly ProductionBurndownPoint[] | null; today: string }) {
  const week = weekHours(points, today);
  const peak = Math.max(0.01, ...(week?.days.map((day) => day.hours) ?? []));
  return (
    <Panel title="This week">
      <div className="flex flex-col">
        <Row label="Hours logged" value={week ? formatClock(week.total, 'hours') : '—'}>
          {week ? (
            <ol aria-label="Hours logged per day" className="flex h-8 items-end gap-1">
              {week.days.map((day) => (
                <li
                  key={day.date}
                  className="flex h-full min-w-0 flex-1 flex-col justify-end"
                  title={`${weekday(day.date)} ${formatClock(day.hours, 'hours')}`}
                >
                  <span
                    aria-hidden
                    className="block w-full rounded-[var(--radius-tag)] bg-[var(--accent)]"
                    style={{ height: day.hours > 0 ? `${Math.max(8, (day.hours / peak) * 100)}%` : '2px', opacity: day.hours > 0 ? 1 : 0.25 }}
                  />
                  <span className="sr-only">
                    {weekday(day.date)} {formatClock(day.hours, 'hours')}
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm" style={MUTED}>
              The hours logged could not be read.
            </p>
          )}
        </Row>
        <Row label="Voice rest (last 24 h)" value="—">
          <p className="text-sm" style={MUTED}>
            Not measured yet: nothing reports the audio recorded in a day.
          </p>
        </Row>
        <Row label="Proofer" value="—">
          <p className="text-sm" style={MUTED}>
            No proofer set up yet.
          </p>
        </Row>
      </div>
    </Panel>
  );
}
