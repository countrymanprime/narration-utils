import { Button } from '../primitives/Button';
import { Panel } from '../primitives/Panel';
import { DELIVERY_METRICS, formatLevel, setLimitCount, type DeliveryLimits, type MetricLimit } from './deliveryLimits';

export type LimitsState = { status: 'loading' } | { status: 'ready'; limits: DeliveryLimits } | { status: 'error'; message: string };

function describeLimit({ min, max }: MetricLimit, unit: string): string | undefined {
  if (min !== undefined && max !== undefined) return `${formatLevel(min)} to ${formatLevel(max)} ${unit}`;
  if (min !== undefined) return `at least ${formatLevel(min)} ${unit}`;
  if (max !== undefined) return `at most ${formatLevel(max)} ${unit}`;
  return undefined;
}

const MUTED = { color: 'var(--text-muted)' };

/**
 * The narrator's own limits as the page judges against them (ADR 0155): none ship, so with nothing set the page says every value is
 * only reported rather than implying a pass. "Change limits" opens Settings at its Delivery category.
 */
export function DeliveryLimitsPanel({ state, openSettings }: { state: LimitsState; openSettings: () => void }) {
  const set = state.status === 'ready' ? setLimitCount(state.limits) : 0;
  return (
    <Panel
      title="Your limits"
      actions={
        <Button variant="ghost" onClick={openSettings}>
          Change limits
        </Button>
      }
    >
      {state.status === 'loading' && (
        <p className="mt-2 text-sm" style={MUTED}>
          Reading your limits…
        </p>
      )}
      {state.status === 'error' && (
        <p role="alert" className="mt-2 text-sm" style={{ color: 'var(--danger-text)' }}>
          Your limits could not be read, so every value is only reported: {state.message}
        </p>
      )}
      {state.status === 'ready' && set === 0 && (
        <p className="mt-2 text-sm" style={MUTED}>
          No limits set. Every value is reported without being checked, so nothing here says a file passes.
        </p>
      )}
      {state.status === 'ready' && set > 0 && (
        <>
          <ul className="mt-2 grid [grid-template-columns:repeat(auto-fill,minmax(15rem,1fr))] gap-x-8 gap-y-1 text-sm">
            {DELIVERY_METRICS.map((metric) => {
              const described = describeLimit(state.limits[metric.key], metric.unit);
              return (
                <li key={metric.key} className="flex justify-between gap-3">
                  <span>{metric.label}</span>
                  {described ? (
                    <span className="font-['IBM_Plex_Mono',ui-monospace,monospace] text-[0.8rem]">{described}</span>
                  ) : (
                    <span style={MUTED}>no limit</span>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="mt-2 text-xs" style={MUTED}>
            These are your own limits: no distributor&apos;s numbers are built in. A value outside one is marked for you to review.
          </p>
        </>
      )}
    </Panel>
  );
}
