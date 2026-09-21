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

export type TeleprompterSeed = 'listening' | 'waiting' | 'done';

type Deps = {
  ready: Promise<unknown>;
  chapters: () => ManuscriptChapter[];
  paragraphs: () => ManuscriptParagraph[];
  assetRequired: () => Extract<TeleprompterStartResult, { status: 'asset_required' }> | undefined;
  /** Boots already part-way through a chapter, as a session the host kept running. */
  seed?: TeleprompterSeed;
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
  let seeding: Promise<void> | undefined;

  const clone = (): TeleprompterState => JSON.parse(JSON.stringify(state));
  const publish = () => stateSubscribers.forEach((notify) => notify(clone()));
  const emit = (event: TeleprompterEvent) => {
    if (event.type === 'script') state = { ...state, script: event, position: null };
    if (event.type === 'position') state = { ...state, position: event };
    eventSubscribers.forEach((notify) => notify(JSON.parse(JSON.stringify(event))));
  };
  const cancelReplay = () => {
    timers.forEach(clearTimeout);
    timers = [];
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
    const read = deps.seed === 'done' ? script.tokens : Math.min((firstParagraph?.start ?? 0) + SEED_WORDS_INTO_TEXT, script.tokens - 1);
    state = { phase: 'running', message: 'Listening…', engine: 'whisper', chapter: chapter.id, script, position: position(read, deps.seed) };
  };

  return {
    teleprompterStart: async (options) => {
      const needed = deps.assetRequired();
      if (needed) return needed;
      if (!options.device.trim()) throw new Error('Choose a microphone.');
      await deps.ready;
      const chapter = findChapter(options.chapter);
      if (!chapter) throw new Error(`Chapter ${options.chapter} was not found among the narration chapters.`);
      cancelReplay();
      state = { phase: 'starting', message: 'Starting the teleprompter…', engine: 'whisper', chapter: options.chapter, script: null, position: null };
      publish();
      const { script, words } = buildScript(chapter, deps.paragraphs());
      state = { ...state, phase: 'running', message: 'Listening…' };
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
    teleprompterState: async () => {
      // Concurrent first callers (React StrictMode mounts twice) must share one seeding.
      if (deps.seed) await (seeding ??= seedState());
      return clone();
    },
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
