import type { WireError } from './WireError';

/** Dropped events before the narrator is told: one bad event is noise, a run of them means the page may be out of date. */
export const DEGRADED_AFTER = 5;
/** After the first few, one dropped event in this many is written to the host log; a stream at 60 events a second must not flood it. */
export const REPORT_EVERY = 50;
const ALWAYS_REPORT = 3;

type Sinks = {
  /** Called for the first few dropped events and then one in `REPORT_EVERY`, with the running count. */
  onDropped?: (error: WireError, count: number) => void;
  /** Called once for each event type the UI does not know. */
  onIgnored?: (type: string) => void;
};

/**
 * What became of the live events since the app started (ADR 0069, failure class "live event"). An event that does not match its
 * schema is dropped and counted, never thrown inside the event callback; after `DEGRADED_AFTER` of them the listeners are told,
 * once, so the app can say updates may be out of date. An event of a type the UI does not know is a newer sidecar talking:
 * ignored and named once, and not counted, so an additive change never raises the notice.
 */
export function createLiveHealth(sinks: Sinks = {}) {
  let dropped = 0;
  let degraded = false;
  const listeners = new Set<() => void>();
  const seenTypes = new Set<string>();

  return {
    dropped(error: WireError): void {
      dropped += 1;
      if (dropped <= ALWAYS_REPORT || dropped % REPORT_EVERY === 0) sinks.onDropped?.(error, dropped);
      if (dropped >= DEGRADED_AFTER && !degraded) {
        degraded = true;
        listeners.forEach((listener) => listener());
      }
    },
    ignored(type: string): void {
      if (seenTypes.has(type)) return;
      seenTypes.add(type);
      sinks.onIgnored?.(type);
    },
    count: () => dropped,
    isDegraded: () => degraded,
    /** Calls `listener` once when updates become degraded (at once if they already are). Returns the unsubscribe. */
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      if (degraded) listener();
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
