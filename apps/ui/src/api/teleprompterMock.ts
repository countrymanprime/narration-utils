// The browser mock's teleprompter. It replays a stream recorded from the real
// ScriptTracker (see sidecars/manuscript-teleprompter/spikes/record_mock_stream.py),
// rescaled onto whichever chapter is being read, so the highlight moves the way
// it does against the live sidecar: it leads the confirmed words, pauses, and
// re-reads an earlier sentence.
import recordedStream from './teleprompterRecording.json';
import { recordedStreamSchema } from './schemas/teleprompter';
import { parseWire } from './wire/parseWire';
import { tokenize } from '../components/teleprompter/readerModel';
import type {
  ManuscriptChapter,
  ManuscriptParagraph,
  TeleprompterApi,
  TeleprompterDevice,
  TeleprompterEngine,
  TeleprompterEvent,
  TeleprompterPosition,
  TeleprompterScript,
  TeleprompterStartResult,
  TeleprompterState,
} from '../types';

const recording = parseWire(recordedStreamSchema, recordedStream, { boundary: 'mock.recording', payload: 'teleprompterRecording.json' });
const recordingSeconds = recording.events.at(-1)?.t ?? 1;

const MIN_REPLAY_SECONDS = 8;
const MAX_REPLAY_SECONDS = 90;
const REPLAY_SECONDS_PER_WORD = 0.45;
const HEARD_WORDS = 6;
const SEED_WORDS_INTO_TEXT = 30;

/** `ended` is a session that stopped itself at the end of the chapter (the host's auto-stop, ADR 0106). */
export type TeleprompterSeed = 'listening' | 'waiting' | 'done' | 'ended';

// The host's auto-stop (apps/desktop/internal/teleprompter/autostop.go): the same delay and messages, so a replay that
// reaches the end of the chapter ends itself the way a live session does.
const AUTO_STOP_MS = 5000;
const LISTENING = 'Listening…';
const AUTO_STOP_ARMED = 'Reached the end of the chapter. Stopping in 5 seconds unless you keep reading.';
const AUTO_STOPPED = 'Stopped at the end of the chapter.';

type Deps = {
  ready: Promise<unknown>;
  chapters: () => ManuscriptChapter[];
  paragraphs: () => ManuscriptParagraph[];
  /** The first-use gate's answer for the engine's model, or undefined when it is installed. */
  assetRequired: (engine: TeleprompterEngine) => Extract<TeleprompterStartResult, { status: 'asset_required' }> | undefined;
  /** Boots already part-way through a chapter, as a session the host kept running. */
  seed?: TeleprompterSeed;
  /** What `teleprompterDevices` reports (an empty list exercises the picker's no-devices fallback). */
  devices: TeleprompterDevice[];
};

const idle: TeleprompterState = {
  phase: 'idle',
  message: 'Choose a chapter to start the teleprompter.',
  engine: null,
  chapter: null,
  script: null,
  position: null,
};

function buildScript(chapter: ManuscriptChapter, paragraphs: ManuscriptParagraph[]): { script: TeleprompterScript; words: string[] } {
  const titleWords = tokenize(chapter.subtitle ? `${chapter.title} ${chapter.subtitle}` : chapter.title);
  const words = [...titleWords];
  const spans: TeleprompterScript['spans'] = [{ kind: 'title', id: chapter.id, index: null, start: 0, count: titleWords.length }];
  for (const paragraph of paragraphs.filter((item) => item.chapterId === chapter.id)) {
    const paragraphWords = tokenize(paragraph.text);
    spans.push({ kind: 'paragraph', id: paragraph.id, index: paragraph.index, start: words.length, count: paragraphWords.length });
    words.push(...paragraphWords);
  }
  return { script: { type: 'script', chapter: { id: chapter.id, title: chapter.title }, tokens: words.length, spans }, words };
}

const position = (read: number, status: TeleprompterPosition['status']): TeleprompterPosition => ({
  type: 'position',
  read,
  committed: read,
  status,
  jump: null,
  skipped: null,
});

export function createTeleprompterMock(deps: Deps): TeleprompterApi {
  const stateSubscribers = new Set<(state: TeleprompterState) => void>();
  const eventSubscribers = new Set<(event: TeleprompterEvent) => void>();
  let state: TeleprompterState = { ...idle };
  let timers: ReturnType<typeof setTimeout>[] = [];
  let autoStop: ReturnType<typeof setTimeout> | undefined;
  let seeding: Promise<void> | undefined;

  const clone = (): TeleprompterState => JSON.parse(JSON.stringify(state));
  const publish = () => stateSubscribers.forEach((notify) => notify(clone()));
  const emit = (event: TeleprompterEvent) => {
    if (event.type === 'script') state = { ...state, script: event, position: null };
    if (event.type === 'position') state = { ...state, position: event };
    eventSubscribers.forEach((notify) => notify(JSON.parse(JSON.stringify(event))));
    if (event.type === 'position') trackAutoStop(event.status === 'done');
  };
  const cancelAutoStop = () => {
    clearTimeout(autoStop);
    autoStop = undefined;
  };
  // Armed by the first done position of a running session, cancelled by any later position that is not done.
  const trackAutoStop = (done: boolean) => {
    if (!done) {
      if (autoStop === undefined) return;
      cancelAutoStop();
      state = { ...state, message: LISTENING };
      publish();
      return;
    }
    if (autoStop !== undefined || state.phase !== 'running') return;
    autoStop = setTimeout(() => {
      autoStop = undefined;
      cancelReplay();
      state = { ...state, phase: 'stopped', message: AUTO_STOPPED };
      publish();
    }, AUTO_STOP_MS);
    state = { ...state, message: AUTO_STOP_ARMED };
    publish();
  };
  const cancelReplay = () => {
    timers.forEach(clearTimeout);
    timers = [];
    cancelAutoStop();
  };
  const findChapter = (query: string) => deps.chapters().find((chapter) => chapter.id === query || chapter.title === query);

  const replay = (words: string[]) => {
    const total = words.length;
    const seconds = Math.min(MAX_REPLAY_SECONDS, Math.max(MIN_REPLAY_SECONDS, total * REPLAY_SECONDS_PER_WORD));
    const scale = (value: number) => Math.round((value / recording.tokens) * total);
    for (const { t, event } of recording.events) {
      const at = (t / recordingSeconds) * seconds;
      const read = scale(event.read);
      const skipped: [number, number] | null = event.skipped ? [scale(event.skipped[0]), scale(event.skipped[1])] : null;
      const scaled: TeleprompterPosition = { ...event, read, committed: scale(event.committed), skipped: skipped && skipped[0] < skipped[1] ? skipped : null };
      timers.push(
        setTimeout(() => {
          const heard = words.slice(Math.max(0, read - HEARD_WORDS), read);
          if (heard.length > 0) emit({ type: 'partial', segment: 0, words: heard.map((word) => ({ word, start: at, end: at })) });
          emit(scaled);
        }, at * 1000),
      );
    }
  };

  const seedState = async () => {
    await deps.ready;
    const chapter = deps.chapters()[0];
    if (!chapter || !deps.seed) return;
    const { script } = buildScript(chapter, deps.paragraphs());
    const firstParagraph = script.spans[1];
    const atEnd = deps.seed === 'done' || deps.seed === 'ended';
    const read = atEnd ? script.tokens : Math.min((firstParagraph?.start ?? 0) + SEED_WORDS_INTO_TEXT, script.tokens - 1);
    const status = deps.seed === 'ended' ? 'done' : deps.seed;
    state =
      deps.seed === 'ended'
        ? { phase: 'stopped', message: AUTO_STOPPED, engine: 'whisper', chapter: chapter.id, script, position: position(read, status) }
        : { phase: 'running', message: LISTENING, engine: 'whisper', chapter: chapter.id, script, position: position(read, status) };
  };

  return {
    teleprompterStart: async (options) => {
      const engine = options.engine ?? 'whisper';
      const needed = deps.assetRequired(engine);
      if (needed) return needed;
      if (!options.device.trim()) throw new Error('Choose a microphone.');
      await deps.ready;
      const chapter = findChapter(options.chapter);
      if (!chapter) throw new Error(`Chapter ${options.chapter} was not found among the narration chapters.`);
      cancelReplay();
      state = { phase: 'starting', message: 'Starting the teleprompter…', engine, chapter: options.chapter, script: null, position: null };
      publish();
      const { script, words } = buildScript(chapter, deps.paragraphs());
      state = { ...state, phase: 'running', message: LISTENING };
      publish();
      emit(script);
      replay(words);
      return { status: 'started' };
    },
    teleprompterStop: async () => {
      cancelReplay();
      if (state.phase === 'starting' || state.phase === 'running') {
        state = { ...state, phase: 'stopped', message: 'Stopped.' };
        publish();
      }
    },
    teleprompterSeek: async (word) => {
      if (state.phase !== 'running') throw new Error('no teleprompter session is running');
      emit({ type: 'position', read: word, committed: word, status: 'listening', jump: 'restart', skipped: null });
    },
    teleprompterState: async () => {
      // Concurrent first callers (React StrictMode mounts twice) must share one seeding.
      if (deps.seed) await (seeding ??= seedState());
      return clone();
    },
    teleprompterDevices: async () => ({ devices: deps.devices.map((device) => ({ ...device })), error: null }),
    subscribeTeleprompterEvent: (onEvent) => {
      eventSubscribers.add(onEvent);
      return () => eventSubscribers.delete(onEvent);
    },
    subscribeTeleprompterState: (onState) => {
      stateSubscribers.add(onState);
      return () => stateSubscribers.delete(onState);
    },
  };
}
