import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faMicrophone, faStop } from '@fortawesome/free-solid-svg-icons';
import { useApi } from '../../api/ApiContext';
import { Button } from '../primitives/Button';
import { ConfirmDialog } from '../primitives/ConfirmDialog';
import { Heading } from '../primitives/Heading';
import { Panel } from '../primitives/Panel';
import { Pill } from '../primitives/Pill';
import { ReaderText } from './ReaderText';
import { buildRows, hydrateSession, initialSession, previewRows, reduceEvent, type Session } from './readerModel';
import { usePacedCursor } from './usePacedCursor';
import type {
  ManuscriptChapter,
  ManuscriptParagraph,
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
const DEVICE_KEY = 'narration.teleprompter.device';
const ACTIVE_PHASES: TeleprompterPhase[] = ['starting', 'running', 'stopping'];
const IDLE_STATE: TeleprompterState = { phase: 'idle', message: '', engine: null, chapter: null, script: null, position: null };

const FIELD_CLASS =
  'mt-1 min-h-[var(--control-height)] w-full rounded-[var(--control-radius)] border border-[var(--border)] bg-[var(--surface)] px-3 py-[0.6rem] text-[0.88rem] leading-[1.35] text-[var(--text)] focus:outline-2 focus:outline-offset-1 focus:outline-[var(--accent)]';
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

function readDevice(): string {
  try {
    return window.localStorage.getItem(DEVICE_KEY) ?? '';
  } catch {
    return '';
  }
}

function rememberDevice(value: string) {
  try {
    window.localStorage.setItem(DEVICE_KEY, value);
  } catch {
    /* the field still works for this visit */
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

function ModelDownloadDialog({ prompt, job, confirm, cancel }: { prompt: ModelPrompt; job?: WhisperInstallJob; confirm: () => void; cancel: () => void }) {
  const downloading = job?.phase === 'running';
  return (
    <ConfirmDialog
      title={downloading ? 'Downloading Whisper model' : 'Download local Whisper model?'}
      body={
        downloading
          ? job.message
          : `The ${prompt.model.displayName} Whisper model listens for your voice. It is not bundled with Narration Utils and will be stored in your per-user asset cache.`
      }
      confirmLabel={downloading ? 'Downloading…' : 'Download model'}
      confirm={confirm}
      cancel={cancel}
    >
      <p className="mt-3 text-xs" style={{ color: 'var(--text-muted)' }}>
        {Math.ceil(prompt.downloadSize / (1024 * 1024))} MB · {prompt.model.publisher} ·{' '}
        <a className="link" href={prompt.model.licenseUrl} target="_blank" rel="noreferrer">
          {prompt.model.license}
        </a>
      </p>
    </ConfirmDialog>
  );
}

export function TeleprompterPage() {
  const api = useApi();
  const [chapters, setChapters] = useState<ManuscriptChapter[]>();
  const [chosenChapter, setChosenChapter] = useState('');
  const [device, setDevice] = useState(readDevice);
  const [model, setModel] = useState('tiny');
  const [host, setHost] = useState<TeleprompterState>(IDLE_STATE);
  const [session, dispatch] = useReducer(sessionReducer, initialSession);
  const [loaded, setLoaded] = useState<{ chapterId: string; paragraphs: ManuscriptParagraph[] }>();
  const [error, setError] = useState('');
  const [prompt, setPrompt] = useState<ModelPrompt>();
  const [job, setJob] = useState<WhisperInstallJob>();

  const active = ACTIVE_PHASES.includes(host.phase);
  // A session in progress (or just finished) decides which chapter is shown.
  const chapterId = session.script?.chapter.id ?? chosenChapter;
  const chapter = chapters?.find((item) => item.id === chapterId);
  const cursor = usePacedCursor(session.cursor);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

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
        setJob(undefined);
        setPrompt(result);
      }
    } catch (reason) {
      setError(errorText(reason));
    }
  };
  const stop = () => void api.teleprompterStop().catch((reason) => setError(errorText(reason)));

  const installModel = async () => {
    if (!prompt || job?.phase === 'running') return;
    try {
      let current = await api.whisperInstall(prompt.model.id);
      setJob(current);
      while (current.id && current.phase === 'running' && mounted.current) {
        await new Promise((resolve) => window.setTimeout(resolve, 400));
        current = await api.whisperInstallState(current.id);
        setJob(current);
      }
      // A session must not start on a page the narrator has already left.
      if (!mounted.current) return;
      if (current.phase === 'success') {
        setPrompt(undefined);
        setJob(undefined);
        await start();
      } else if (current.phase !== 'cancelled') setError(current.message);
    } catch (reason) {
      setError(errorText(reason));
    }
  };
  const cancelModelDownload = async () => {
    if (job?.id && job.phase === 'running') {
      try {
        setJob(await api.whisperInstallCancel(job.id));
      } catch (reason) {
        setError(errorText(reason));
      }
      return;
    }
    setPrompt(undefined);
    setJob(undefined);
  };

  const selectChapter = (id: string) => {
    setChosenChapter(id);
    dispatch({ kind: 'reset' });
  };
  const changeDevice = (value: string) => {
    setDevice(value);
    rememberDevice(value);
  };

  const status = statusText(host, session);
  const canStart = Boolean(chapterId) && device.trim() !== '';
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Heading title="Teleprompter">Read a chapter aloud and follow along - the highlight moves with your voice.</Heading>
      {chapters?.length === 0 && (
        <Panel>
          <div className="font-semibold">This manuscript has no chapters to read</div>
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
                  <select id="teleprompter-chapter" className={FIELD_CLASS} value={chapterId} onChange={(event) => selectChapter(event.target.value)}>
                    {chapters.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.subtitle ? `${item.title}: ${item.subtitle}` : item.title}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={LABEL_CLASS} htmlFor="teleprompter-device">
                    Microphone
                  </label>
                  <input
                    id="teleprompter-device"
                    aria-describedby="teleprompter-device-hint"
                    className={FIELD_CLASS}
                    value={device}
                    placeholder="Microphone (USB Audio Device)"
                    onChange={(event) => changeDevice(event.target.value)}
                  />
                  <span id="teleprompter-device-hint" className="mt-1 block text-xs" style={{ color: 'var(--text-faint)' }}>
                    The device name exactly as Windows lists it under Sound settings.
                  </span>
                </div>
                <div className="md:col-span-2">
                  <span className={LABEL_CLASS}>Whisper model</span>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {MODELS.map((option) => (
                      <Pill
                        key={option.value}
                        label={option.label}
                        title={option.caption}
                        active={model === option.value}
                        onClick={() => setModel(option.value)}
                      />
                    ))}
                  </div>
                </div>
              </div>
            )}
            <div className={`flex flex-wrap items-center justify-between gap-3 ${active ? '' : 'mt-4'}`}>
              <div className="min-w-0 text-sm">
                <span role="status" className="font-semibold" style={{ color: session.position?.status === 'waiting' && active ? 'var(--warn)' : undefined }}>
                  {status}
                </span>
                {session.script && (
                  <span className="ml-2 font-['IBM_Plex_Mono',ui-monospace,monospace] text-xs whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>
                    {session.cursor.toLocaleString()} of {session.script.tokens.toLocaleString()} words
                  </span>
                )}
                {active && session.heard && (
                  <div className="truncate text-xs" style={{ color: 'var(--text-faint)' }}>
                    Heard: {session.heard}
                  </div>
                )}
              </div>
              {active ? (
                <Button variant="danger" onClick={stop} disabled={host.phase === 'stopping'}>
                  <FontAwesomeIcon icon={faStop} /> Stop
                </Button>
              ) : (
                <Button onClick={() => void start()} disabled={!canStart}>
                  <FontAwesomeIcon icon={faMicrophone} /> Start reading
                </Button>
              )}
            </div>
          </Panel>
        </div>
      )}
      {(error || host.phase === 'error') && (
        <p role="alert" className="text-sm" style={{ color: 'var(--danger)' }}>
          {error || host.message}
        </p>
      )}
      {rows.length > 0 && (
        <Panel>
          <ReaderText rows={rows} cursor={cursor} skipped={session.skipped} follow={active} />
        </Panel>
      )}
      {prompt && <ModelDownloadDialog prompt={prompt} job={job} confirm={() => void installModel()} cancel={() => void cancelModelDownload()} />}
    </div>
  );
}
