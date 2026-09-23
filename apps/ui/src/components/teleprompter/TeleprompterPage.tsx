import { useCallback, useEffect, useMemo, useReducer, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faMicrophone, faStop } from '@fortawesome/free-solid-svg-icons';
import { useApi } from '../../api/ApiContext';
import { useAssetInstall } from '../../hooks/useAssetInstall';
import { AssetFacts } from '../assets/AssetFacts';
import { AssetInstallPrompt } from '../assets/AssetInstallPrompt';
import { Button } from '../primitives/Button';
import { Heading } from '../primitives/Heading';
import { Panel } from '../primitives/Panel';
import { ToggleGroup } from '../primitives/ToggleGroup';
import { Select } from '../primitives/Select';
import { TooltipTarget } from '../primitives/Tooltip';
import { MicrophoneField } from './MicrophoneField';
import { ReaderText } from './ReaderText';
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

type ModelPrompt = Extract<TeleprompterStartResult, { status: 'asset_required' }>;
type SessionAction = { kind: 'event'; event: TeleprompterEvent } | { kind: 'hydrate'; state: TeleprompterState } | { kind: 'reset' };

const MODELS = [
  { value: 'tiny', label: 'Tiny', caption: 'Fastest - keeps up with your voice on most computers' },
  { value: 'small', label: 'Small', caption: 'More accurate - needs a faster computer to keep up' },
];
// The pre-Phase-2 browser-storage device value: migrated once into the global settings file
// (docs/prds/teleprompter-engines-and-input-devices.prd.md, "Where the device, engine and model choices are stored")
// and then removed, so it is never read again once the settings value exists.
const LEGACY_DEVICE_KEY = 'narration.teleprompter.device';
const SETTINGS_TOOL = 'Teleprompter';
const INPUT_DEVICE_KEY = 'input_device';
const MODEL_KEY = 'model';
const ACTIVE_PHASES: TeleprompterPhase[] = ['starting', 'running', 'stopping'];
const IDLE_STATE: TeleprompterState = { phase: 'idle', message: '', engine: null, chapter: null, script: null, position: null };

const LABEL_CLASS = 'block text-[0.82rem] font-medium text-[var(--text-muted)]';

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

const errorText = (reason: unknown): string => (reason instanceof Error ? reason.message : String(reason));

function statusText(host: TeleprompterState, session: Session): string {
  if (host.phase === 'starting') return 'Starting…';
  if (host.phase === 'stopping') return 'Stopping…';
  if (host.phase === 'stopped') return 'Stopped';
  if (host.phase !== 'running') return '';
  if (session.position?.status === 'waiting') return 'Waiting for you to return to the script';
  if (session.position?.status === 'done') return 'Done - that is the end of the chapter';
  return 'Listening';
}

export function TeleprompterPage() {
  const api = useApi();
  const [chapters, setChapters] = useState<ManuscriptChapter[]>();
  const [chosenChapter, setChosenChapter] = useState('');
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
  // The model download: the shared install-poll hook (D4). A session must not start on a page the narrator has already left: the hook
  // stops and never calls onSuccess once this page has gone.
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
  // A session in progress (or just finished) decides which chapter is shown.
  const chapterId = session.script?.chapter.id ?? chosenChapter;
  const chapter = chapters?.find((item) => item.id === chapterId);
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
  // migrates the pre-Phase-2 browser-storage value into it exactly once: only when the settings value has never been
  // set, so a narrator who has already picked a device from the new picker is never overwritten by a stale browser value.
  // Also reads the Teleprompter settings section's default model (Phase 3) so a session starts with whichever model
  // the narrator set in Settings, without forcing a per-session choice here.
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
        } else {
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
  }, [api]);

  useEffect(() => {
    let live = true;
    void Promise.all([api.manuscriptChapters(), api.readerState().catch(() => undefined)])
      .then(([all, reader]) => {
        if (!live) return;
        const narration = all.filter((item) => (item.contentKind ?? 'narration') === 'narration');
        setChapters(narration);
        const last = narration.find((item) => item.id === reader?.activeChapter || item.title === reader?.activeChapter);
        setChosenChapter((current) => current || (last ?? narration[0])?.id || '');
      })
      .catch((reason) => live && setError(errorText(reason)));
    return () => {
      live = false;
    };
  }, [api]);

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

  const selectChapter = (id: string) => {
    setChosenChapter(id);
    dispatch({ kind: 'reset' });
  };
  const changeDevice = (value: string) => {
    setDevice(value);
    void api.saveSettings(SETTINGS_TOOL, 'global', { [INPUT_DEVICE_KEY]: value }).catch((reason) => setError(errorText(reason)));
  };

  const status = statusText(host, session);
  // A failed or empty device listing blocks the phase (the PRD's "Microphone is never typed" decision): there is no
  // typed fallback to start with, so Start stays disabled until a device can be chosen from the list.
  const micBlockedReason = devices.length === 0 ? (devicesError ? "Couldn't list microphones." : 'No microphone found.') : undefined;
  const canStart = Boolean(chapterId) && device.trim() !== '' && !micBlockedReason;
  const startReason = !chapterId
    ? 'Choose a chapter first.'
    : micBlockedReason
      ? micBlockedReason
      : device.trim() === ''
        ? 'Choose a microphone first.'
        : 'Start reading';
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Heading title="Teleprompter">Read a chapter aloud and follow along - the highlight moves with your voice.</Heading>
      {chapters?.length === 0 && (
        <Panel title="This manuscript has no chapters to read">
          <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
            The teleprompter reads narration chapters. Import a manuscript with at least one narration chapter first.
          </p>
        </Panel>
      )}
      {chapters && chapters.length > 0 && (
        <div className={active ? 'sticky top-0 z-10' : ''}>
          <Panel>
            {!active && (
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className={LABEL_CLASS} htmlFor="teleprompter-chapter">
                    Chapter
                  </label>
                  <Select
                    id="teleprompter-chapter"
                    className="mt-1"
                    fullWidth
                    value={chapterId}
                    onChange={selectChapter}
                    options={chapters.map((item) => ({ value: item.id, label: item.subtitle ? `${item.title}: ${item.subtitle}` : item.title }))}
                  />
                </div>
                <MicrophoneField
                  value={device}
                  onChange={changeDevice}
                  devices={devices}
                  error={devicesError}
                  onRefresh={loadDevices}
                  refreshing={devicesLoading}
                />
                <div className="md:col-span-2">
                  <span className={LABEL_CLASS}>Whisper model</span>
                  <ToggleGroup
                    label="Whisper model"
                    className="mt-1.5 flex-wrap gap-1.5"
                    value={model}
                    onChange={setModel}
                    options={MODELS.map((option) => ({ value: option.value, label: option.label, title: option.caption }))}
                  />
                </div>
              </div>
            )}
            <div className={`flex flex-wrap items-center justify-between gap-3 ${active ? '' : 'mt-4'}`}>
              <div className="min-w-0 text-sm">
                <span
                  role="status"
                  className="font-semibold"
                  style={{ color: session.position?.status === 'waiting' && active ? 'var(--warn-text)' : undefined }}
                >
                  {status}
                </span>
                {session.script && (
                  <span className="ml-2 font-['IBM_Plex_Mono',ui-monospace,monospace] text-xs whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>
                    {session.cursor.toLocaleString()} of {session.script.tokens.toLocaleString()} words
                  </span>
                )}
                {active && session.heard && (
                  <div className="truncate text-xs" style={{ color: 'var(--text-muted)' }}>
                    Heard: {session.heard}
                  </div>
                )}
              </div>
              {active ? (
                <Button variant="danger" onClick={stop} disabled={host.phase === 'stopping'}>
                  <FontAwesomeIcon icon={faStop} /> Stop
                </Button>
              ) : (
                <TooltipTarget text={startReason}>
                  <Button onClick={() => void start()} disabled={!canStart}>
                    <FontAwesomeIcon icon={faMicrophone} /> Start reading
                  </Button>
                </TooltipTarget>
              )}
            </div>
          </Panel>
        </div>
      )}
      {(error || host.phase === 'error') && (
        <p role="alert" className="text-sm" style={{ color: 'var(--danger-text)' }}>
          {error || host.message}
        </p>
      )}
      {rows.length > 0 && (
        <Panel>
          <ReaderText rows={rows} cursor={cursor} skipped={session.skipped} follow={active} />
        </Panel>
      )}
      {prompt && (
        <AssetInstallPrompt
          ask={{
            title: 'Download local Whisper model?',
            body: `The ${prompt.model.displayName} Whisper model listens for your voice. It is not bundled with Narration Utils and will be stored in your per-user asset cache.`,
            confirmLabel: 'Download model',
          }}
          workTitle="Downloading Whisper model"
          install={modelInstall}
          dismiss={closeModelPrompt}
        >
          <AssetFacts
            label="Model"
            name={prompt.model.displayName}
            version={prompt.model.version}
            publisher={prompt.model.publisher}
            license={prompt.model.license}
            licenseUrl={prompt.model.licenseUrl}
            modelCardUrl={prompt.model.modelCardUrl}
            provenanceUrl={prompt.model.provenanceUrl}
            downloadSize={prompt.downloadSize}
            diskSize={prompt.diskSize}
            installPath={prompt.installPath}
          />
        </AssetInstallPrompt>
      )}
    </div>
  );
}
