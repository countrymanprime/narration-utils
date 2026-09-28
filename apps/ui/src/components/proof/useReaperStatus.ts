import { useCallback, useEffect, useState } from 'react';
import { useApi } from '../../api/ApiContext';
import { apiErrorMessage } from '../../api/errorMessage';
import type { ReaperStatus } from '../../types';

/**
 * How often the Review page asks whether REAPER is there. The answer is read from the heartbeat REAPER's script already sends
 * every 1.5 s (ADR 0092), so asking costs REAPER nothing; a few seconds is soon enough to notice REAPER closing or coming back.
 */
const REAPER_STATUS_POLL_MS = 3000;

/**
 * Whether Go to and Loop can work now (review dashboard Phase 7), while the Review page is open: read on opening, every
 * REAPER_STATUS_POLL_MS, and on `refresh` after an action. Until the first answer the controls wait (`undefined`); a failed read
 * counts as not connected and says why, so the buttons are never enabled on a guess.
 */
export function useReaperStatus(): { status: ReaperStatus | undefined; refresh: () => Promise<void> } {
  const api = useApi();
  const [status, setStatus] = useState<ReaperStatus>();

  const refresh = useCallback(async () => {
    try {
      setStatus(await api.findingsReaperStatus());
    } catch (error) {
      setStatus({ connection: 'not_running', message: `Could not check whether REAPER is connected: ${apiErrorMessage(error)}` });
    }
  }, [api]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), REAPER_STATUS_POLL_MS);
    return () => window.clearInterval(timer);
  }, [refresh]);

  return { status, refresh };
}
