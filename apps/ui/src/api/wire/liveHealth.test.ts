import { describe, expect, it, vi } from 'vitest';
import { createLiveHealth, DEGRADED_AFTER, REPORT_EVERY } from './liveHealth';
import { WireError } from './WireError';

const error = () => new WireError('host.event', 'teleprompter:event', [{ path: 'read', message: 'Invalid input: expected number, received string' }]);

describe('createLiveHealth', () => {
  it('counts each dropped event and reports the first few, then one in REPORT_EVERY', () => {
    const report = vi.fn();
    const health = createLiveHealth({ onDropped: report });
    for (let i = 0; i < 3 + REPORT_EVERY; i += 1) health.dropped(error());
    expect(health.count()).toBe(3 + REPORT_EVERY);
    // Events 1, 2 and 3, then event REPORT_EVERY (a multiple), so a stream that is wrong at 60 events a second cannot flood the log.
    expect(report.mock.calls.map(([, count]) => count)).toEqual([1, 2, 3, REPORT_EVERY]);
  });

  it('tells its listeners once when the count reaches the threshold, and not before', () => {
    const health = createLiveHealth();
    const degraded = vi.fn();
    health.subscribe(degraded);
    for (let i = 0; i < DEGRADED_AFTER - 1; i += 1) health.dropped(error());
    expect(degraded).not.toHaveBeenCalled();
    health.dropped(error());
    health.dropped(error());
    expect(degraded).toHaveBeenCalledTimes(1);
    expect(health.isDegraded()).toBe(true);
  });

  it('tells a listener that subscribes after the app is already degraded, and stops after unsubscribe', () => {
    const health = createLiveHealth();
    for (let i = 0; i < DEGRADED_AFTER; i += 1) health.dropped(error());
    const late = vi.fn();
    const stop = health.subscribe(late);
    expect(late).toHaveBeenCalledTimes(1);
    stop();
    const other = vi.fn();
    health.subscribe(other);
    stop();
    expect(late).toHaveBeenCalledTimes(1);
  });

  it('reports an unknown event type once, and does not count it as a dropped event', () => {
    const onIgnored = vi.fn();
    const health = createLiveHealth({ onIgnored });
    health.ignored('ping');
    health.ignored('ping');
    health.ignored('pong');
    expect(onIgnored.mock.calls).toEqual([['ping'], ['pong']]);
    expect(health.count()).toBe(0);
  });
});
