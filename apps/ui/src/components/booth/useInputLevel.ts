import { useEffect, useRef, useState } from 'react';
import { useApi } from '../../api/ApiContext';
import { updateHeldPeak, type HeldPeak } from '../../levelMeter';
import { errorText } from './useTeleprompterSession';

export type InputLevel = { peak: number; rms: number };

/**
 * The bar and microphone popover's live input level (read-aloud-control-bar.prd.md Phase 4, ADR 0247): a running
 * session already relays `level` events on the shared `subscribeTeleprompterEvent` stream (they are deliberately not
 * folded into the session model, `readerModel.ts`, so a burst of ~10 events a second never re-renders the reader's
 * rows) - this hook is the one place they land. Before a session starts, the microphone popover runs its own
 * meter-only child (`teleprompterMeterStart`, refused while a session is active) so the narrator can check the
 * microphone first; it is released the moment the popover closes (Q6) and never started at all while `active`.
 */
export function useInputLevel(device: string, { active, enabled }: { active: boolean; enabled: boolean }) {
  const api = useApi();
  const [level, setLevel] = useState<InputLevel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const held = useRef<HeldPeak>({ peak: -100, at: 0 });

  useEffect(
    () =>
      api.subscribeTeleprompterEvent((event) => {
        if (event.type === 'level') {
          held.current = updateHeldPeak(held.current, event.peak, Date.now());
          setError(null);
          setLevel({ peak: held.current.peak, rms: event.rms });
        } else if (event.type === 'meter_stopped') {
          held.current = { peak: -100, at: 0 };
          setLevel(null);
          setError(event.error);
        }
      }),
    [api],
  );

  useEffect(() => {
    // A running session's own levels arrive on the subscription above; nothing to start or stop here.
    if (active) return;
    if (!enabled || !device.trim()) {
      setLevel(null);
      return;
    }
    let cancelled = false;
    void api.teleprompterMeterStart(device).catch((reason) => {
      if (!cancelled) setError(errorText(reason));
    });
    return () => {
      cancelled = true;
      void api.teleprompterMeterStop().catch(() => {});
      setLevel(null);
    };
  }, [api, device, active, enabled]);

  return { level, error };
}
