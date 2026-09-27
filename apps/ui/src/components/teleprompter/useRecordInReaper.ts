import { useCallback, useEffect, useState } from 'react';
import { useApi } from '../../api/ApiContext';
import { errorText } from './useTeleprompterSession';

const SETTINGS_TOOL = 'ReadAloud';
const ENABLED_KEY = 'record_in_reaper';
const CONFIRMED_KEY = 'record_confirmed';

export type RecordInReaperState = {
  /** The project-scope settings have been read once; the toggle shows its real state only after this. */
  loaded: boolean;
  enabled: boolean;
  /** This app is, as far as it knows, currently recording in REAPER because `beforeStart` told it to. */
  recording: boolean;
  /** The last arm, start or stop refusal's message, cleared at the start of the next attempt. */
  error?: string;
  armPending: boolean;
  /** Turning the toggle on for the first time in this project asks first (Q9); every other change is immediate. */
  confirmPending: boolean;
  toggle: () => void;
  confirm: () => void;
  cancelConfirm: () => void;
  armOnly: () => Promise<void>;
  /** Called before a session starts listening (Play). Resolves true when it is fine to go ahead: the toggle is off, the
   * capability is unavailable, there is no chapter (credits), or REAPER confirmed it started recording. Resolves false
   * only on a genuine refusal or timeout, with `error` set to why. */
  beforeStart: () => Promise<boolean>;
  /** Called after a session has stopped (Stop, or the dialog's "Stop reading?" confirm). A no-op unless this app
   * actually started a REAPER recording for this session. */
  afterStop: () => void;
};

/**
 * The Record-in-REAPER toggle's memory and orchestration (read-aloud-control-bar.prd.md Phase 7, Q7-Q9;
 * booth-actions-enablement.prd.md Phase 2): a per-project on/off (`ReadAloud.record_in_reaper`, reusing the generic
 * settings mechanism the way `Keymap.overrides` does - no Settings category names this tool, so it never joins the
 * generic Settings page) with a first-time confirm (`record_confirmed`), "Arm `<chapter>` only" (Q7 A), and what Play
 * and Stop do while it is on: `ReadAloudRecordStart` before a session starts listening, `ReadAloudRecordStop` after it
 * stops (Q8). Reading with the toggle off, with the record capability unavailable, or with no chapter (credits mode)
 * never touches REAPER: `beforeStart` answers true at once, exactly like today, so a narrator whose REAPER access
 * lapses can still just read.
 */
export function useRecordInReaper(chapterId: string | undefined, capabilityAvailable: boolean): RecordInReaperState {
  const api = useApi();
  const [loaded, setLoaded] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [confirmPending, setConfirmPending] = useState(false);
  const [armPending, setArmPending] = useState(false);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let live = true;
    void api
      .settingsForScope('project')
      .then((fields) => {
        if (!live) return;
        const rows = fields[SETTINGS_TOOL] ?? [];
        setEnabled(rows.find((row) => row.key === ENABLED_KEY)?.effectiveValue === 'true');
        setConfirmed(rows.find((row) => row.key === CONFIRMED_KEY)?.effectiveValue === 'true');
        setLoaded(true);
      })
      .catch((reason) => live && setError(errorText(reason)));
    return () => {
      live = false;
    };
  }, [api]);

  const save = useCallback(
    (values: Record<string, string>) => void api.saveSettings(SETTINGS_TOOL, 'project', values).catch((reason) => setError(errorText(reason))),
    [api],
  );

  const toggle = useCallback(() => {
    if (enabled) {
      setEnabled(false);
      save({ [ENABLED_KEY]: 'false' });
      return;
    }
    if (confirmed) {
      setEnabled(true);
      save({ [ENABLED_KEY]: 'true' });
      return;
    }
    setConfirmPending(true);
  }, [enabled, confirmed, save]);

  const confirm = useCallback(() => {
    setConfirmPending(false);
    setEnabled(true);
    setConfirmed(true);
    save({ [ENABLED_KEY]: 'true', [CONFIRMED_KEY]: 'true' });
  }, [save]);

  const cancelConfirm = useCallback(() => setConfirmPending(false), []);

  // Returns a promise (rather than firing and forgetting) so the caller can re-ask the chapter's REAPER state once
  // arming has actually finished: the indicator's own status text is how the narrator learns arming worked, not a
  // second message here.
  const armOnly = useCallback(async () => {
    if (!chapterId) return;
    setArmPending(true);
    setError(undefined);
    try {
      const result = await api.readAloudArmOnly(chapterId);
      if (result.outcome === 'refused') setError(result.message);
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setArmPending(false);
    }
  }, [api, chapterId]);

  const beforeStart = useCallback(async (): Promise<boolean> => {
    if (!enabled || !capabilityAvailable || !chapterId) return true;
    setError(undefined);
    try {
      const result = await api.readAloudRecordStart(chapterId);
      if (result.outcome === 'started') {
        setRecording(true);
        return true;
      }
      setError(result.message);
      return false;
    } catch (reason) {
      setError(errorText(reason));
      return false;
    }
  }, [api, chapterId, enabled, capabilityAvailable]);

  const afterStop = useCallback(() => {
    if (!recording) return;
    setRecording(false);
    api.readAloudRecordStop().catch((reason) => setError(errorText(reason)));
  }, [api, recording]);

  return { loaded, enabled, recording, error, armPending, confirmPending, toggle, confirm, cancelConfirm, armOnly, beforeStart, afterStop };
}
