import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useApi } from '../../api/ApiContext';
import { useAssetInstall } from '../../hooks/useAssetInstall';
import { isInstallRunning } from '../../types';
import { buildRows, creditsRows, hydrateSession, initialSession, previewRows, reduceEvent, type CreditsKind, type Session } from './readerModel';
import { usePacedCursor } from './usePacedCursor';
import type {
  ManuscriptChapter,
  ManuscriptParagraph,
  AssetInstallJob,
  TeleprompterDevice,
  TeleprompterEngine,
  TeleprompterEvent,
  TeleprompterPhase,
  TeleprompterStartResult,
  TeleprompterState,
} from '../../types';

export type ModelPrompt = Extract<TeleprompterStartResult, { status: 'asset_required' }>;
type SessionAction = { kind: 'event'; event: TeleprompterEvent } | { kind: 'hydrate'; state: TeleprompterState } | { kind: 'reset' };

/** The live engines by name. Which of them this computer offers is the host's `Teleprompter.engine` choices. */
export const ENGINE_LABELS: Record<TeleprompterEngine, string> = { whisper: 'Whisper', moonshine: 'Moonshine' };
const ENGINE_CAPTIONS: Record<TeleprompterEngine, string> = {
  whisper: 'OpenAI Whisper, run on this computer - the default',
  moonshine: 'Moonshine, a streaming engine run on this computer',
};
const DEFAULT_ENGINE: TeleprompterEngine = 'whisper';
const isEngine = (value: string): value is TeleprompterEngine => value === 'whisper' || value === 'moonshine';
/** The engines the host offers, in its order, as toggle options; an engine this UI does not know is left out. */
const engineOptions = (choices: string[]) =>
  choices.filter(isEngine).map((engine) => ({ value: engine, label: ENGINE_LABELS[engine], title: ENGINE_CAPTIONS[engine] }));
// The earlier browser-storage device value: migrated once into the global settings file and then removed, so it is never read again once the settings value exists. Only the standalone page migrates it
// (see `migrateLegacyDevice` below) - the read-aloud modal never
// had a browser-storage value of its own to migrate.
const LEGACY_DEVICE_KEY = 'narration.teleprompter.device';
const SETTINGS_TOOL = 'Teleprompter';
const INPUT_DEVICE_KEY = 'input_device';
const MODEL_KEY = 'model';
const ENGINE_KEY = 'engine';
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

function statusText(host: TeleprompterState, session: Session): string {
  if (host.phase === 'starting') return 'Starting…';
  if (host.phase === 'stopping') return 'Stopping…';
  // The host says why a session stopped (the narrator pressed Stop, or it stopped itself at the end of the chapter).
  if (host.phase === 'stopped') return host.message.trim() || 'Stopped';
  if (host.phase !== 'running') return '';
  // Paused: the tracker's clock is frozen, so it never reports `waiting` or `done` while paused.
  if (host.paused) return 'Paused';
  if (session.position?.status === 'waiting') return 'Waiting for you to return to the script';
  if (session.position?.status === 'done')
    return session.script?.chapter.id.startsWith('credits-')
      ? 'Done - the end of the credits; stopping in a few seconds unless you read on'
      : 'Done - stopping in a few seconds unless you read on';
  return 'Listening';
}

export type UseTeleprompterSessionOptions = {
  /** Empty when nothing is chosen yet (the standalone page before a chapter loads), and while `credits` is chosen. */
  chapterId: string;
  chapter: Pick<ManuscriptChapter, 'title' | 'subtitle'> | undefined;
  /**
   * The opening or closing credits instead of a chapter, with the
   * text the host's one renderer produced (`creditsPreview`); the host renders the same text again for the sidecar.
   */
  credits?: { kind: CreditsKind; text: string };
  /** The standalone page migrates the earlier browser-storage device value once; the read-aloud modal does not (see above). */
  migrateLegacyDevice?: boolean;
};

/**
 * The reading session: host subscription, device and model choice, model-download prompt, start/stop and the rows the
 * reader shows. The Booth page's session and the Companion host call it. Chapter *choice* stays
 * with each caller (the page has a picker; the modal is opened already pointed at one chapter) - callers pass `reset()`
 * after changing `chapterId` themselves.
 */
export function useTeleprompterSession({ chapterId, chapter, credits, migrateLegacyDevice = true }: UseTeleprompterSessionOptions) {
  const api = useApi();
  const [device, setDevice] = useState('');
  // True once the saved device (if any) has been read, so a caller that fills in a missing device never races the saved one.
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [devices, setDevices] = useState<TeleprompterDevice[]>([]);
  const [devicesError, setDevicesError] = useState<string | null>(null);
  const [devicesLoading, setDevicesLoading] = useState(false);
  const [model, setModel] = useState('tiny');
  const [engine, setEngine] = useState<TeleprompterEngine>(DEFAULT_ENGINE);
  const [engines, setEngines] = useState(() => engineOptions([DEFAULT_ENGINE]));
  const [host, setHost] = useState<TeleprompterState>(IDLE_STATE);
  const [session, dispatch] = useReducer(sessionReducer, initialSession);
  const [loaded, setLoaded] = useState<{ chapterId: string; paragraphs: ManuscriptParagraph[] }>();
  const [error, setError] = useState('');
  const [prompt, setPrompt] = useState<ModelPrompt>();
  // The last start found the speech model missing: kept after the question is answered, so a narrator who declined is still told why the text does not follow.
  const [modelMissing, setModelMissing] = useState(false);
  // Where the next Start begins (the read-aloud dialog's resume card):
  // null is the top. Passed to the host as `startWord` (start at a word), so a resumed session
  // never reads from the top first.
  const [startWord, setStartWord] = useState<number | null>(null);
  // The model download: the shared install-poll hook, through the generic asset bindings, since the missing model is either
  // engine's (the gate's answer names the engine, which is also the asset kind). A session must not start on a view the narrator has
  // already left: the hook stops and never calls onSuccess once this hook's owner has unmounted.
  // The install question was asked by a choice or by Record, not by a session that already started: when it is answered the model is
  // only installed, nothing starts. `revert` puts a choice back when the question is closed without a download.
  const gate = useRef<{ revert?: () => void } | null>(null);
  const modelInstall = useAssetInstall<AssetInstallJob>({
    start: () => {
      if (!prompt) return Promise.reject(new Error('Start reading first.'));
      return api.assetsInstall(prompt.engine, prompt.model.id);
    },
    state: (jobId) => api.assetsInstallState(jobId),
    cancel: (jobId) => api.assetsInstallCancel(jobId),
    onSuccess: async () => {
      setPrompt(undefined);
      if (gate.current) {
        gate.current = null;
        return;
      }
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

  // Loads the persisted device once (global settings), and
  // migrates the earlier browser-storage value into it exactly once (page only, see `migrateLegacyDevice`).
  // Also reads the Teleprompter settings section's default model so a session starts with whichever model the
  // narrator set in Settings, without forcing a per-session choice here.
  useEffect(() => {
    let live = true;
    void api
      .settingsForScope('global')
      .then((settings) => {
        if (!live) return;
        const fields = settings[SETTINGS_TOOL] ?? [];
        setSettingsLoaded(true);
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
        // The engines are the ones the host can launch on this computer (its choices for the setting), so an engine it
        // does not offer is never shown or sent.
        const engineField = fields.find((item) => item.key === ENGINE_KEY);
        const offered = engineOptions(engineField?.choices ?? [DEFAULT_ENGINE]);
        if (offered.length > 0) setEngines(offered);
        const chosen = engineField?.effectiveValue ?? '';
        if (isEngine(chosen) && offered.some((option) => option.value === chosen)) setEngine(chosen);
      })
      .catch(() => live && setSettingsLoaded(true));
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
  const creditsKind = credits?.kind;
  const creditsText = credits?.text;
  const rows = useMemo(() => {
    if (creditsKind && creditsText !== undefined) {
      // A session still describing a chapter (or the other credits) is not these credits' script.
      const script = session.script?.chapter.id === `credits-${creditsKind}` ? session.script : null;
      return creditsRows(creditsKind, creditsText, script);
    }
    if (!chapter || !paragraphs) return [];
    return session.script ? buildRows(session.script, chapter, paragraphs) : previewRows(chapter, paragraphs);
  }, [creditsKind, creditsText, chapter, paragraphs, session.script]);

  const start = async () => {
    setError('');
    setModelMissing(false);
    try {
      const source = creditsKind ? { credits: creditsKind } : { chapter: chapterId };
      const result = await api.teleprompterStart({ ...source, device: device.trim(), engine, model, ...(startWord === null ? {} : { startWord }) });
      if (result.status === 'asset_required') {
        setModelMissing(true);
        modelInstall.reset();
        setPrompt(result);
      }
    } catch (reason) {
      setError(errorText(reason));
    }
  };
  const stop = () => void api.teleprompterStop().catch((reason) => setError(errorText(reason)));
  // Pause (true) or resume (false) a running session's listening without ending it: the phase stays `running`, so `active` and every "is a session running" check stay as they are; only
  // `host.paused` changes. Flags are kept on Stop only (docs/architecture/findings-contract.md unchanged).
  const pause = (paused: boolean) => void api.teleprompterPause(paused).catch((reason) => setError(errorText(reason)));
  // Moves a running tracker straight to a chosen script word ("Start here" / "Go back to here", wired to a word click through
  // `ReaderText`'s `onSeek`). `useCallback` keeps this a stable
  // reference across renders: `ReaderText` passes it into a `memo`-wrapped per-row component, and a fresh closure every
  // render would defeat that row-level memoization (see `ReaderText.tsx`).
  const seek = useCallback((word: number) => void api.teleprompterSeek(word).catch((reason) => setError(errorText(reason))), [api]);

  const closeModelPrompt = () => {
    // A choice that asked for a download and was closed without one is put back, so the app never holds an engine it cannot run.
    if (gate.current?.revert && !isInstallRunning(modelInstall.job ?? { phase: 'success' })) gate.current.revert();
    gate.current = null;
    setPrompt(undefined);
    modelInstall.reset();
  };

  /**
   * Asks the install question when `engine` and `model` are not on this computer: the host's asset list says, and a list that cannot be read
   * claims nothing. True when the model is there (or unknown), false when the question was opened instead. `revert` runs if it is closed
   * without a download. A take must never begin behind this question, so Record calls this first.
   */
  const ensureModel = async (which: { engine: string; model: string } = { engine, model }, revert?: () => void): Promise<boolean> => {
    if (!isEngine(which.engine)) return true;
    try {
      const catalog = await api.assetsList();
      const asset = catalog.assets.find((item) => item.kind === which.engine && item.id === which.model);
      if (!asset || asset.installState === 'installed') return true;
      gate.current = { revert };
      setModelMissing(true);
      modelInstall.reset();
      setPrompt({
        status: 'asset_required',
        engine: which.engine,
        model: {
          id: asset.id,
          provider: asset.kind,
          displayName: asset.displayName,
          version: asset.version,
          publisher: asset.publisher,
          license: asset.license,
          licenseUrl: asset.licenseUrl,
          modelCardUrl: asset.modelCardUrl,
          provenanceUrl: asset.provenanceUrl,
          attribution: asset.attribution,
        },
        installState: asset.installState,
        downloadSize: asset.downloadSize,
        diskSize: asset.diskSize,
        installPath: asset.path,
      });
      return false;
    } catch {
      return true;
    }
  };

  // Device, engine and model are machine facts kept in the global settings, so a choice made
  // here is the one Settings shows and the next session starts with. Choosing never downloads: a missing model is asked for at Start.
  const saveChoice = (key: string, value: string) =>
    void api.saveSettings(SETTINGS_TOOL, 'global', { [key]: value }).catch((reason) => setError(errorText(reason)));
  const changeDevice = (value: string) => {
    setDevice(value);
    saveChoice(INPUT_DEVICE_KEY, value);
  };
  const changeEngine = (value: string) => {
    if (!isEngine(value)) return;
    const before = engine;
    setEngine(value);
    saveChoice(ENGINE_KEY, value);
    // Choosing an engine whose model is not here asks for the download now, and puts the engine back if it is not downloaded.
    void ensureModel({ engine: value, model }, () => {
      setEngine(before);
      saveChoice(ENGINE_KEY, before);
    });
  };
  const changeModel = (value: string) => {
    const before = model;
    setModel(value);
    saveChoice(MODEL_KEY, value);
    void ensureModel({ engine, model: value }, () => {
      setModel(before);
      saveChoice(MODEL_KEY, before);
    });
  };

  const reset = () => dispatch({ kind: 'reset' });

  const status = statusText(host, session);
  // A failed or empty device listing blocks Start (the microphone is never typed):
  // there is no typed fallback to start with, so Start stays disabled until a device can be chosen from the list.
  const micBlockedReason = devices.length === 0 ? (devicesError ? "Couldn't list microphones." : 'No microphone found.') : undefined;
  const hasSource = Boolean(chapterId || creditsKind);
  const canStart = hasSource && device.trim() !== '' && !micBlockedReason;
  const startReason = !hasSource
    ? 'Choose a chapter first.'
    : micBlockedReason
      ? micBlockedReason
      : device.trim() === ''
        ? 'Choose a microphone first.'
        : 'Start reading';

  return {
    host,
    paused: Boolean(host.paused),
    pause,
    session,
    device,
    settingsLoaded,
    devices,
    devicesError,
    devicesLoading,
    loadDevices,
    model,
    changeModel,
    engine,
    engines,
    changeEngine,
    paragraphs,
    rows,
    cursor,
    active,
    status,
    error,
    prompt,
    modelMissing,
    modelInstall,
    start,
    stop,
    seek,
    changeDevice,
    closeModelPrompt,
    ensureModel,
    startWord,
    setStartWord,
    reset,
    canStart,
    startReason,
  };
}

export type TeleprompterSession = ReturnType<typeof useTeleprompterSession>;
