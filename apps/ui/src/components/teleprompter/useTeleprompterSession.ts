import { useCallback, useEffect, useMemo, useReducer, useState } from 'react';
import { useApi } from '../../api/ApiContext';
import { useAssetInstall } from '../../hooks/useAssetInstall';
import { buildRows, hydrateSession, initialSession, previewRows, reduceEvent, type Session } from './readerModel';
import { usePacedCursor } from './usePacedCursor';
import type {
  ManuscriptChapter,
  ManuscriptParagraph,
  TeleprompterDevice,
  TeleprompterEvent,
  TeleprompterPhase,
  TeleprompterStartResult,
  TeleprompterState,
  WhisperInstallJob,
} from '../../types';

export type ModelPrompt = Extract<TeleprompterStartResult, { status: 'asset_required' }>;
type SessionAction = { kind: 'event'; event: TeleprompterEvent } | { kind: 'hydrate'; state: TeleprompterState } | { kind: 'reset' };

export const MODELS = [
  { value: 'tiny', label: 'Tiny', caption: 'Fastest - keeps up with your voice on most computers' },
  { value: 'small', label: 'Small', caption: 'More accurate - needs a faster computer to keep up' },
];
// The pre-Phase-2 (input devices PRD) browser-storage device value: migrated once into the global settings file
// (docs/prds/teleprompter-engines-and-input-devices.prd.md, "Where the device, engine and model choices are stored")
// and then removed, so it is never read again once the settings value exists. Only the standalone page migrates it
// (see `migrateLegacyDevice` below) - the read-aloud modal (teleprompter-manuscript-integration.prd.md Phase 2) is
// new and never had a browser-storage value of its own to migrate.
const LEGACY_DEVICE_KEY = 'narration.teleprompter.device';
const SETTINGS_TOOL = 'Teleprompter';
const INPUT_DEVICE_KEY = 'input_device';
const MODEL_KEY = 'model';
export const ACTIVE_PHASES: TeleprompterPhase[] = ['starting', 'running', 'stopping'];
const IDLE_STATE: TeleprompterState = { phase: 'idle', message: '', engine: null, chapter: null, script: null, position: null };

function sessionReducer(session: Session, action: SessionAction): Session {
  switch (action.kind) {
    case 'event':
      return reduceEvent(session, action.event);
    case 'hydrate':
      return hydrateSession(session, action.state);
    case 'reset':
      return initialSession;
  }
}

function readLegacyDevice(): string {
  try {
    return window.localStorage.getItem(LEGACY_DEVICE_KEY) ?? '';
  } catch {
    return '';
  }
}

function clearLegacyDevice() {
  try {
    window.localStorage.removeItem(LEGACY_DEVICE_KEY);
  } catch {
    /* nothing to clean up if storage is unavailable */
  }
}

export const errorText = (reason: unknown): string => (reason instanceof Error ? reason.message : String(reason));

export function statusText(host: TeleprompterState, session: Session): string {
  if (host.phase === 'starting') return 'Starting…';
  if (host.phase === 'stopping') return 'Stopping…';
  if (host.phase === 'stopped') return 'Stopped';
  if (host.phase !== 'running') return '';
  if (session.position?.status === 'waiting') return 'Waiting for you to return to the script';
  if (session.position?.status === 'done') return 'Done - that is the end of the chapter';
  return 'Listening';
}

export type UseTeleprompterSessionOptions = {
  /** Empty when nothing is chosen yet (the standalone page before a chapter loads). */
  chapterId: string;
  chapter: Pick<ManuscriptChapter, 'title' | 'subtitle'> | undefined;
  /** The standalone page migrates the pre-Phase-2 browser-storage device value once; the read-aloud modal does not (see above). */
  migrateLegacyDevice?: boolean;
};

/**
 * The reading session: host subscription, device and model choice, model-download prompt, start/stop and the rows the
 * reader shows. Extracted from `TeleprompterPage` (teleprompter-manuscript-integration.prd.md Phase 2) so the standalone
 * page and the `ReadAloudDialog` modal share one implementation until the page is retired (Phase 13). Chapter *choice* stays
 * with each caller (the page has a picker; the modal is opened already pointed at one chapter) - callers pass `reset()`
 * after changing `chapterId` themselves, matching the page's existing behavior.
 */
export function useTeleprompterSession({ chapterId, chapter, migrateLegacyDevice = true }: UseTeleprompterSessionOptions) {
  const api = useApi();
  const [device, setDevice] = useState('');
  const [devices, setDevices] = useState<TeleprompterDevice[]>([]);
  const [devicesError, setDevicesError] = useState<string | null>(null);
  const [devicesLoading, setDevicesLoading] = useState(false);
  const [model, setModel] = useState('tiny');
  const [host, setHost] = useState<TeleprompterState>(IDLE_STATE);
  const [session, dispatch] = useReducer(sessionReducer, initialSession);
  const [loaded, setLoaded] = useState<{ chapterId: string; paragraphs: ManuscriptParagraph[] }>();
  const [error, setError] = useState('');
  const [prompt, setPrompt] = useState<ModelPrompt>();
  // The model download: the shared install-poll hook (D4). A session must not start on a view the narrator has already left: the hook
  // stops and never calls onSuccess once this hook's owner has unmounted.
  const modelInstall = useAssetInstall<WhisperInstallJob>({
    start: () => {
      if (!prompt) return Promise.reject(new Error('Start reading first.'));
      return api.whisperInstall(prompt.model.id);
    },
    state: (jobId) => api.whisperInstallState(jobId),
    cancel: (jobId) => api.whisperInstallCancel(jobId),
    onSuccess: async () => {
      setPrompt(undefined);
      await start();
    },
  });

  const active = ACTIVE_PHASES.includes(host.phase);
  const cursor = usePacedCursor(session.cursor);

  useEffect(() => {
    const stopEvents = api.subscribeTeleprompterEvent((event) => dispatch({ kind: 'event', event }));
    const stopState = api.subscribeTeleprompterState((next) => {
      setHost(next);
      if (next.phase === 'starting') dispatch({ kind: 'reset' });
    });
    void api
      .teleprompterState()
      .then((state) => {
        setHost((current) => (current.phase === 'idle' ? state : current));
        dispatch({ kind: 'hydrate', state });
      })
      .catch(() => {});
    return () => {
      stopEvents();
      stopState();
    };
  }, [api]);

  const loadDevices = useCallback(() => {
    setDevicesLoading(true);
    void api
      .teleprompterDevices()
      .then((result) => {
        setDevices(result.devices);
        setDevicesError(result.error);
      })
      .catch((reason) => setDevicesError(errorText(reason)))
      .finally(() => setDevicesLoading(false));
  }, [api]);

  useEffect(() => {
    loadDevices();
  }, [loadDevices]);

  // Loads the persisted device once (global settings, "Where the device, engine and model choices are stored"), and
  // migrates the pre-Phase-2 browser-storage value into it exactly once (page only, see `migrateLegacyDevice`).
  // Also reads the Teleprompter settings section's default model so a session starts with whichever model the
  // narrator set in Settings, without forcing a per-session choice here.
  useEffect(() => {
    let live = true;
    void api
      .settingsForScope('global')
      .then((settings) => {
        if (!live) return;
        const fields = settings[SETTINGS_TOOL] ?? [];
        const deviceField = fields.find((item) => item.key === INPUT_DEVICE_KEY);
        if (deviceField?.isSet) {
          setDevice(deviceField.value);
        } else if (migrateLegacyDevice) {
          const legacy = readLegacyDevice();
          if (legacy) {
            setDevice(legacy);
            clearLegacyDevice();
            void api.saveSettings(SETTINGS_TOOL, 'global', { [INPUT_DEVICE_KEY]: legacy }).catch(() => {});
          }
        }
        const modelField = fields.find((item) => item.key === MODEL_KEY);
        if (modelField?.effectiveValue) setModel(modelField.effectiveValue);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [api, migrateLegacyDevice]);

  useEffect(() => {
    if (!chapterId) return;
    let live = true;
    void api
      .manuscriptParagraphs(chapterId)
      .then((paragraphs) => live && setLoaded({ chapterId, paragraphs }))
      .catch((reason) => live && setError(errorText(reason)));
    return () => {
      live = false;
    };
  }, [api, chapterId]);

  const paragraphs = loaded?.chapterId === chapterId ? loaded.paragraphs : undefined;
  const rows = useMemo(() => {
    if (!chapter || !paragraphs) return [];
    return session.script ? buildRows(session.script, chapter, paragraphs) : previewRows(chapter, paragraphs);
  }, [chapter, paragraphs, session.script]);

  const start = async () => {
    setError('');
    try {
      const result = await api.teleprompterStart({ chapter: chapterId, device: device.trim(), model });
      if (result.status === 'asset_required') {
        modelInstall.reset();
        setPrompt(result);
      }
    } catch (reason) {
      setError(errorText(reason));
    }
  };
  const stop = () => void api.teleprompterStop().catch((reason) => setError(errorText(reason)));

  const closeModelPrompt = () => {
    setPrompt(undefined);
    modelInstall.reset();
  };

  const changeDevice = (value: string) => {
    setDevice(value);
    void api.saveSettings(SETTINGS_TOOL, 'global', { [INPUT_DEVICE_KEY]: value }).catch((reason) => setError(errorText(reason)));
  };

  const reset = () => dispatch({ kind: 'reset' });

  const status = statusText(host, session);
  // A failed or empty device listing blocks the phase (the input-devices PRD's "Microphone is never typed" decision):
  // there is no typed fallback to start with, so Start stays disabled until a device can be chosen from the list.
  const micBlockedReason = devices.length === 0 ? (devicesError ? "Couldn't list microphones." : 'No microphone found.') : undefined;
  const canStart = Boolean(chapterId) && device.trim() !== '' && !micBlockedReason;
  const startReason = !chapterId
    ? 'Choose a chapter first.'
    : micBlockedReason
      ? micBlockedReason
      : device.trim() === ''
        ? 'Choose a microphone first.'
        : 'Start reading';

  return {
    host,
    session,
    device,
    devices,
    devicesError,
    devicesLoading,
    loadDevices,
    model,
    setModel,
    rows,
    cursor,
    active,
    status,
    error,
    prompt,
    modelInstall,
    start,
    stop,
    changeDevice,
    closeModelPrompt,
    reset,
    canStart,
    startReason,
  };
}

export type TeleprompterSession = ReturnType<typeof useTeleprompterSession>;
