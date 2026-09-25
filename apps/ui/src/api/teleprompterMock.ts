// The browser mock's teleprompter. It replays a stream recorded from the real
// ScriptTracker (see sidecars/manuscript-teleprompter/spikes/record_mock_stream.py),
// rescaled onto whichever chapter is being read, so the highlight moves the way
// it does against the live sidecar: it leads the confirmed words, pauses, and
// re-reads an earlier sentence.
import recordedStream from './teleprompterRecording.json';
import { recordedStreamSchema } from './schemas/teleprompter';
import { parseWire } from './wire/parseWire';
import { CREDITS_LABEL, creditsParagraphs, tokenize, wordOffsets, type CreditsKind } from '../components/teleprompter/readerModel';
import { mockRecordedEnd } from './chapterTrackMatchMock';
import { seedLastReading, seedLocateResult, seedTrackMatch, type LocateDraft, type MockResumeSeed } from './resumeMockSeed';
import type {
  ChapterTrackMatch,
  ManuscriptChapter,
  ManuscriptParagraph,
  ReadAloudReaperState,
  TeleprompterApi,
  TeleprompterReaperInput,
  TeleprompterDevice,
  TeleprompterEngine,
  TeleprompterEvent,
  TeleprompterFlag,
  TeleprompterFlagFinding,
  TeleprompterFlagSave,
  TeleprompterLocateResult,
  TeleprompterLocated,
  TeleprompterModelRequired,
  TeleprompterPosition,
  TeleprompterReading,
  TeleprompterResumePlace,
  TeleprompterResumeVerdict,
  TeleprompterScript,
  TeleprompterStartResult,
  TeleprompterState,
  TracksProject,
} from '../types';

const recording = parseWire(recordedStreamSchema, recordedStream, { boundary: 'mock.recording', payload: 'teleprompterRecording.json' });
const recordingSeconds = recording.events.at(-1)?.t ?? 1;

const MIN_REPLAY_SECONDS = 8;
const MAX_REPLAY_SECONDS = 90;
const REPLAY_SECONDS_PER_WORD = 0.45;
const HEARD_WORDS = 6;
const SEED_WORDS_INTO_TEXT = 30;
// Where the mock's tail-audio locate says a recorded chapter stopped (a fraction of its words), how many words before
// that it "heard", and how much it "transcribed" (the host's teleprompter.DefaultTailSeconds).
const MOCK_RESUME_FRACTION = 0.6;
const MOCK_HEARD_WORDS = 70;
const MOCK_TAIL_SECONDS = 30;
const SENTENCE_END = /[.!?…]["'”’)\]]*$/;

/**
 * `ended` is a session that stopped itself at the end of the chapter (the host's auto-stop, ADR 0106); `flagged` is `listening`
 * further into the text, with a session's suspected flags already raised (Phase 7).
 */
export type TeleprompterSeed = 'listening' | 'waiting' | 'done' | 'ended' | 'flagged';

/** `?mockReaperState=`: what `readAloudReaperState` answers for every chapter (each status, plus the experimental switch being off). */
export const MOCK_REAPER_SEEDS = [
  'ready',
  'not_armed',
  'other_armed',
  'several_armed',
  'no_link',
  'recording_elsewhere',
  'unavailable',
  'experimental_off',
] as const;
export type MockReaperSeed = (typeof MOCK_REAPER_SEEDS)[number];

/** `?mockReaperInput=`: what `teleprompterReaperInput` answers (unset: REAPER records from the first microphone listed). */
export const MOCK_REAPER_INPUT_SEEDS = ['matched', 'uncertain', 'no_match', 'reaper_no_device', 'experimental_off'] as const;
export type MockReaperInputSeed = (typeof MOCK_REAPER_INPUT_SEEDS)[number];

// The host's answers (apps/desktop/teleprompterinput.go), in the same words, over the mock's own microphone list.
function mockReaperInput(seed: MockReaperInputSeed, devices: string[]): TeleprompterReaperInput {
  const [first = 'Microphone Array (Realtek(R) Audio)'] = devices;
  switch (seed) {
    case 'matched':
      return { status: 'matched', reaperDevice: first, device: first, candidates: [], message: `REAPER records from "${first}", so "${first}" is selected.` };
    case 'uncertain':
      return {
        status: 'uncertain',
        reaperDevice: 'Focusrite USB ASIO',
        candidates: devices,
        message: `REAPER records from "Focusrite USB ASIO", which could be any of ${devices.length} microphones here. Choose the one REAPER uses.`,
      };
    case 'no_match':
      return {
        status: 'no_match',
        reaperDevice: 'ASIO4ALL v2',
        candidates: [],
        message: 'REAPER records from "ASIO4ALL v2", which does not match a microphone here. Choose the microphone yourself.',
      };
    case 'reaper_no_device':
      return {
        status: 'unavailable',
        reason: 'reaper_no_device',
        candidates: [],
        message: 'REAPER did not say which input device it has open. Choose the microphone yourself.',
      };
    case 'experimental_off':
      return {
        status: 'unavailable',
        reason: 'experimental_off',
        candidates: [],
        message: "Reading REAPER's tracks is an experimental action. Turn on Experimental REAPER actions in Settings to use it.",
      };
  }
}

// The host's auto-stop (apps/desktop/internal/teleprompter/autostop.go): the same delay and messages, so a replay that
// reaches the end of the chapter ends itself the way a live session does.
const AUTO_STOP_MS = 5000;
const LISTENING = 'Listening…';
const AUTO_STOP_ARMED = 'Reached the end of the chapter. Stopping in 5 seconds unless you keep reading.';
const AUTO_STOPPED = 'Stopped at the end of the chapter.';
const FLAGGED_WORDS_INTO_TEXT = 70;

type Deps = {
  ready: Promise<unknown>;
  chapters: () => ManuscriptChapter[];
  paragraphs: () => ManuscriptParagraph[];
  /** The rendered opening or closing credits text, as the host's creditsScript renders it; undefined when there is no template of the kind. */
  creditsText: (kind: CreditsKind) => string | undefined;
  /** The first-use gate's answer for the engine's model, or undefined when it is installed. */
  assetRequired: (engine: TeleprompterEngine) => Extract<TeleprompterStartResult, { status: 'asset_required' }> | undefined;
  /** The chapter's track match, as the mock's ChapterTrackMatch answers it (the locate starts from it). */
  trackMatch: (chapterId: string) => ChapterTrackMatch;
  tracksProject: TracksProject;
  /** Boots already part-way through a chapter, as a session the host kept running. */
  seed?: TeleprompterSeed;
  /** What `teleprompterDevices` reports (an empty list exercises the picker's no-devices fallback). */
  devices: TeleprompterDevice[];
  /** Which resume card state `teleprompterLocate` answers (see `MockResumeSeed`); unset, the mock project's tracks decide. */
  resume?: MockResumeSeed;
  /** `?mockLevel=`: every level the mock sends is this RMS in dBFS (a still meter for a capture); unset, it moves like speech. */
  level?: number;
  /** `?mockReaperState=`: what `readAloudReaperState` answers; unset, the chapter's track is ready. */
  reaper?: MockReaperSeed;
  /** `?mockReaperInput=`: what `teleprompterReaperInput` answers; unset, REAPER records from the first microphone listed. */
  reaperInput?: MockReaperInputSeed;
};

const MOCK_REAPER_TRACK = '{11111111-1111-4111-8111-111111111111}';

// The host's answers (apps/desktop/readaloudreaper.go), in the same words, for a chapter titled `title`.
function mockReaperState(seed: MockReaperSeed, title: string): ReadAloudReaperState {
  const asked = (status: ReadAloudReaperState['status'], armedCount: number, message: string, recording = false): ReadAloudReaperState => ({
    status,
    message,
    trackGuid: MOCK_REAPER_TRACK,
    armedCount,
    playing: recording,
    recording,
  });
  switch (seed) {
    case 'ready':
      return asked('ready', 1, `The track for "${title}" is armed and ready.`);
    case 'not_armed':
      return asked('not_armed', 0, `The track for "${title}" is not armed in REAPER.`);
    case 'other_armed':
      return asked('other_armed', 1, `Another track is armed in REAPER, not the one for "${title}".`);
    case 'several_armed':
      return asked('several_armed', 3, `3 tracks are armed in REAPER. Only the track for "${title}" should be.`);
    case 'recording_elsewhere':
      return asked('recording_elsewhere', 1, 'REAPER is already recording. Stop it in REAPER before recording with reading.', true);
    case 'no_link':
      return {
        status: 'no_link',
        reason: 'unlinked',
        message: `"${title}" has no linked track. Link it to its REAPER track on the Tracks page.`,
        playing: false,
        recording: false,
      };
    case 'unavailable':
      return {
        status: 'unavailable',
        reason: 'standalone',
        message: 'REAPER is not connected to this app. To record with reading, open this app from the Narration Utils action in REAPER.',
        playing: false,
        recording: false,
      };
    case 'experimental_off':
      return {
        status: 'unavailable',
        reason: 'experimental_off',
        message: "Reading REAPER's tracks is an experimental action. Turn on Experimental REAPER actions in Settings to use it.",
        playing: false,
        recording: false,
      };
  }
}

// A level as `levels.py` sends it: the peak sits about 9 dB over the RMS (a sine is 3 dB; speech is peakier), both in [-100, 0].
function mockLevelEvent(rms: number): TeleprompterEvent {
  const clamp = (value: number) => Math.round(Math.min(0, Math.max(-100, value)) * 10) / 10;
  return { type: 'level', peak: clamp(rms + 9), rms: clamp(rms) };
}

const idle: TeleprompterState = {
  phase: 'idle',
  message: 'Choose a chapter to start the teleprompter.',
  engine: null,
  chapter: null,
  paused: false,
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

/** The sentence holding word `last`, bounded the way locate.py bounds it (sentence ends and paragraph starts). */
function sentenceAround(words: string[], last: number, breaks: Set<number>): { start: number; end: number; text: string } {
  let start = last;
  while (start > 0 && !breaks.has(start) && !SENTENCE_END.test(words[start - 1])) start -= 1;
  let end = last + 1;
  while (end < words.length && !breaks.has(end) && !SENTENCE_END.test(words[end - 1])) end += 1;
  return { start, end, text: words.slice(start, end).join(' ') };
}

// The browser mock's stand-in for TeleprompterLocate (apps/desktop/teleprompterlocate.go, ADR 0111): the host's statuses
// from the mock project's track match, and for a readable track a confident resume word part-way into the chapter. The
// real placement (Whisper over the tail, the tracker's alignment) happens only in the sidecar.
function mockLocate(
  match: ChapterTrackMatch,
  project: TracksProject,
  { script, words }: { script: TeleprompterScript; words: string[] },
  trackGuid: string | undefined,
  modelRequired: TeleprompterModelRequired | undefined,
): LocateDraft {
  const picked = trackGuid ?? match.track?.trackGuid;
  const track = picked === undefined ? undefined : project.tracks.find((entry) => entry.guid === picked);
  if (picked !== undefined && !track) throw new Error('that track is not in the selected REAPER project');
  const base = { match, track: track ? { guid: track.guid, name: track.name, index: track.index } : null, recordedEnd: null, tail: null, located: null };
  if (!track) return { ...base, status: 'no_track' };
  const recordedEnd = mockRecordedEnd(track);
  if (!recordedEnd) return { ...base, status: 'no_recording' };
  if (!recordedEnd.sourceAvailable) return { ...base, recordedEnd, status: 'source_missing' };
  if (!recordedEnd.supported) return { ...base, recordedEnd, status: 'source_unsupported' };
  if (modelRequired) return modelRequired;
  const word = Math.max(1, Math.round(words.length * MOCK_RESUME_FRACTION));
  const heard = words.slice(Math.max(0, word - MOCK_HEARD_WORDS), word);
  const located: TeleprompterLocated = {
    word,
    last: word - 1,
    sentence: sentenceAround(words, word - 1, new Set(script.spans.map((span) => span.start))),
    confidence: 0.84,
    confident: true,
    matched: heard.length,
    heard: heard.length,
    runnerUp: 4,
    tokens: words.length,
    heardText: heard.join(' '),
  };
  const tail = { from: Math.max(recordedEnd.sourceStart, recordedEnd.sourceTime - MOCK_TAIL_SECONDS), to: recordedEnd.sourceTime };
  return { ...base, recordedEnd, tail, located, status: 'found' };
}

// The host's teleprompter.ResumeTolerance: how many words apart the two places may be and still agree.
const RESUME_TOLERANCE = 10;
const WORD_CHAR = /[\p{L}\p{N}_']/u;

/**
 * The mock's stand-in for teleprompter.Reconcile (apps/desktop/internal/teleprompter/reconcile.go), so every verdict the
 * resume prompt renders can be seen without a host. The Go function is the one that is tested; this follows its rules.
 */
function mockReconcile(
  located: TeleprompterLocated | null,
  reading: TeleprompterReading | null,
  words: string[],
  breaks: Set<number>,
): TeleprompterResumeVerdict {
  const tokens = words.length;
  const wordsLeft = (from: number) => words.slice(Math.max(0, from)).some((word) => WORD_CHAR.test(word));
  const sentenceStart = (word: number) => sentenceAround(words, Math.min(Math.max(word - 1, 0), tokens - 1), breaks).start;
  const place = (word: number, confident: boolean): TeleprompterResumePlace => ({
    word,
    number: word + 1,
    sentence: tokens > 0 ? sentenceAround(words, Math.min(Math.max(word - 1, 0), tokens - 1), breaks) : null,
    confident,
  });
  const daw = located?.word != null && located.tokens === tokens ? { ...place(located.word, located.confident), source: 'saved' as const } : null;
  const prompter = reading && reading.tokens === tokens && reading.read > 0 ? place(reading.read, true) : null;
  const verdict: TeleprompterResumeVerdict = { kind: 'none', start: null, daw, prompter, tokens };
  if (!daw && !prompter) return verdict;
  if (!daw) return prompter && wordsLeft(prompter.word) ? { ...verdict, kind: 'prompter_only' } : verdict;
  if (!prompter) return { ...verdict, kind: wordsLeft(daw.word) ? 'daw_only' : 'complete' };
  const near = Math.abs(daw.word - prompter.word) <= RESUME_TOLERANCE || sentenceStart(daw.word) === sentenceStart(prompter.word);
  if (!wordsLeft(daw.word)) {
    if (daw.confident) return { ...verdict, kind: 'complete' };
    return near ? { ...verdict, kind: 'complete', confirmedBy: 'prompter' } : { ...verdict, kind: 'disagree' };
  }
  if (!near) return { ...verdict, kind: 'disagree' };
  return { ...verdict, kind: 'agree', start: daw.word, ...(daw.confident ? {} : { confirmedBy: 'prompter' as const }) };
}

/** The locate draft with the chapter's seeded last reading and the verdict, as the host's `withResumeVerdict` adds them. */
function withMockVerdict(
  draft: LocateDraft,
  seed: MockResumeSeed | undefined,
  chapterId: string,
  { script, words }: { script: TeleprompterScript; words: string[] },
): TeleprompterLocateResult {
  if (draft.status === 'asset_required') return draft;
  const lastReading = seedLastReading(seed, chapterId, draft.located?.word ?? null, words.length);
  const breaks = new Set(script.spans.map((span) => span.start));
  return { ...draft, lastReading, verdict: mockReconcile(draft.located, lastReading, words, breaks) };
}

/** The mock of the sidecar's `text_script` for the credits (ADR 0150): one paragraph span per line with words, no title span. */
function buildCreditsScript(kind: CreditsKind, text: string): { script: TeleprompterScript; words: string[] } {
  const words: string[] = [];
  const spans: TeleprompterScript['spans'] = creditsParagraphs(kind, text).map((paragraph) => {
    const lineWords = tokenize(paragraph.text);
    const span = { kind: 'paragraph' as const, id: paragraph.id, index: null, start: words.length, count: lineWords.length };
    words.push(...lineWords);
    return span;
  });
  return { script: { type: 'script', chapter: { id: `credits-${kind}`, title: CREDITS_LABEL[kind] }, tokens: words.length, spans }, words };
}

const position = (read: number, status: TeleprompterPosition['status']): TeleprompterPosition => ({
  type: 'position',
  read,
  committed: read,
  status,
  jump: null,
  skipped: null,
});

/** A recorded flag moved onto a chapter of another length; a flag over words keeps at least one word, an extra stays zero-width. */
function scaleFlag(flag: TeleprompterFlag, scale: (value: number) => number): TeleprompterFlag {
  const start = scale(flag.start);
  const end = flag.kind === 'extra' ? start : Math.max(start + 1, scale(flag.end));
  return { ...flag, start, end };
}

const FLAG_CONFIDENCE_REASON =
  'Suspected from live speech recognition while reading aloud: the engine can mishear a correct read, so this has no score and is not proof. Transcript Compare over the recorded take is authoritative.';

/**
 * The mock of `TeleprompterSaveFlags` (`apps/desktop/teleprompterflags.go`, ADR 0117): the same id rule in spirit (chapter,
 * paragraph, kind and words, so a repeat is one finding), a dismissal kept per id and heard text, and the same record shape.
 */
function createFlagStore(deps: Pick<Deps, 'chapters' | 'paragraphs'>) {
  const dismissed = new Set<string>();
  return async (chapterId: string, flags: TeleprompterFlagSave[]): Promise<TeleprompterFlagFinding[]> => {
    await Promise.resolve();
    const chapter = deps.chapters().find((item) => item.id === chapterId);
    return flags.map((flag) => {
      const paragraph = deps.paragraphs().find((item) => item.id === flag.paragraphId && item.chapterId === chapterId);
      if (!paragraph) throw new Error(`paragraph "${flag.paragraphId}" is not in chapter "${chapterId}"`);
      const offsets = wordOffsets(paragraph.text);
      if (flag.wordStart < 0 || flag.wordEnd <= flag.wordStart || flag.wordEnd > offsets.length)
        throw new Error(`words [${flag.wordStart}, ${flag.wordEnd}) are not within the paragraph`);
      const words = offsets.slice(flag.wordStart, flag.wordEnd).map(([from, to]) => paragraph.text.slice(from, to));
      const extra = flag.kind === 'extra';
      const start = offsets[flag.wordStart][0];
      const id = `${chapterId}:${paragraph.id}:${flag.kind}:${flag.wordStart}-${flag.wordEnd}`;
      const version = flag.heard.trim().toLowerCase();
      if (flag.dismissed) dismissed.add(`${id}\u001f${version}`);
      return {
        schema_version: 1,
        id,
        analyzer: 'teleprompter',
        project: { path: 'C:/Projects/Alice', output_path: `narration-utils/findings/teleprompter/${chapterId}.json` },
        source: {},
        manuscript: {
          chapter_id: chapterId,
          ...(chapter ? { chapter_title: chapter.title } : {}),
          ...(extra ? {} : { expected: words.join(' ') }),
          ...(flag.heard ? { recorded: flag.heard } : {}),
          span: { paragraph_id: paragraph.id, start, end: extra ? start : offsets[flag.wordEnd - 1][1] },
        },
        category: flag.kind === 'restart' ? 'pickup' : 'transcript_discrepancy',
        severity: flag.kind === 'misread' || flag.kind === 'skipped' ? 'warning' : 'info',
        confidence: null,
        evidence_version: `mock:${version}`,
        confidence_reason: FLAG_CONFIDENCE_REASON,
        evidence: {
          kind: flag.kind,
          heard: flag.heard,
          suspected: true,
          script_words: [flag.scriptStart, flag.scriptEnd],
          ...(extra ? { before: words.join(' ') } : {}),
        },
        review: { status: dismissed.has(`${id}\u001f${version}`) ? 'dismissed' : 'unreviewed' },
      };
    });
  };
}

/** A chapter's last reading as the host writes it at session end (ADR 0205), for the mock of Phase 3's locate result. */
export function mockLastReading(chapterId: string, read: number, tokens: number): TeleprompterReading {
  return { version: 1, chapterId, read: Math.min(read, tokens), tokens, scriptHash: '0'.repeat(64), status: 'listening', endedAt: '2026-09-24T21:04:00Z' };
}

export function createTeleprompterMock(deps: Deps): TeleprompterApi {
  const stateSubscribers = new Set<(state: TeleprompterState) => void>();
  const eventSubscribers = new Set<(event: TeleprompterEvent) => void>();
  let state: TeleprompterState = { ...idle };
  let timers: ReturnType<typeof setTimeout>[] = [];
  let autoStop: ReturnType<typeof setTimeout> | undefined;
  let seeding: Promise<void> | undefined;
  let metering = false;
  // The words of the session running now, so a resume replays on from where the pause left it.
  let sessionWords: string[] = [];
  // The replay's steps carry a level each (no timer of their own), so a session's meter moves and ends with it.
  const levelAt = (step: number) => mockLevelEvent(deps.level ?? -24 + 6 * Math.sin(step * 1.7));

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
  const stopMeter = () => {
    if (!metering) return;
    metering = false;
    emit({ type: 'meter_stopped', error: null });
  };
  const findChapter = (query: string) => deps.chapters().find((chapter) => chapter.id === query || chapter.title === query);
  type Planned = { id: string; built: ReturnType<typeof buildScript> };
  const planChapter = (query: string): Planned => {
    const chapter = findChapter(query);
    if (!chapter) throw new Error(`Chapter ${query} was not found among the narration chapters.`);
    return { id: query, built: buildScript(chapter, deps.paragraphs()) };
  };
  // The host's creditsScript and StartScript refusals (ADR 0150), in the same words.
  const planCredits = (kind: CreditsKind): Planned => {
    const name = CREDITS_LABEL[kind].toLowerCase();
    const text = deps.creditsText(kind);
    if (text === undefined) throw new Error(`there is no ${name} template: add one in Settings > Credits`);
    if (tokenize(text).length === 0) throw new Error(`the ${name} text has no words to read`);
    return { id: `credits-${kind}`, built: buildCreditsScript(kind, text) };
  };

  // Replays the recorded read-through over words `from`..end, so a session started at a word (a resume) never goes back before it.
  const replay = (words: string[], from = 0) => {
    const total = words.length;
    const seconds = Math.min(MAX_REPLAY_SECONDS, Math.max(MIN_REPLAY_SECONDS, (total - from) * REPLAY_SECONDS_PER_WORD));
    const scale = (value: number) => from + Math.round((value / recording.tokens) * (total - from));
    for (const [step, { t, event }] of recording.events.entries()) {
      const at = (t / recordingSeconds) * seconds;
      if (event.type === 'flag') {
        timers.push(setTimeout(() => emit(scaleFlag(event, scale)), at * 1000));
        continue;
      }
      const read = scale(event.read);
      const skipped: [number, number] | null = event.skipped ? [scale(event.skipped[0]), scale(event.skipped[1])] : null;
      const scaled: TeleprompterPosition = { ...event, read, committed: scale(event.committed), skipped: skipped && skipped[0] < skipped[1] ? skipped : null };
      timers.push(
        setTimeout(() => {
          emit(levelAt(step));
          const heard = words.slice(Math.max(0, read - HEARD_WORDS), read);
          if (heard.length > 0) emit({ type: 'partial', segment: 0, words: heard.map((word) => ({ word, start: at, end: at })) });
          emit(scaled);
        }, at * 1000),
      );
    }
  };

  // The flags a `flagged` session raised: the recorded ones (the recording's word numbers counted from the chapter's first
  // paragraph, which is where its 100 words were read), plus an extra, which the recorded session did not raise.
  let seededFlags: TeleprompterFlag[] = [];
  const seedState = async () => {
    await deps.ready;
    const chapter = deps.chapters()[0];
    if (!chapter || !deps.seed) return;
    const { script, words } = buildScript(chapter, deps.paragraphs());
    sessionWords = words;
    const firstParagraph = script.spans[1]?.start ?? 0;
    const atEnd = deps.seed === 'done' || deps.seed === 'ended';
    const into = deps.seed === 'flagged' ? FLAGGED_WORDS_INTO_TEXT : SEED_WORDS_INTO_TEXT;
    const read = atEnd ? script.tokens : Math.min(firstParagraph + into, script.tokens - 1);
    const status = deps.seed === 'ended' ? 'done' : deps.seed === 'flagged' ? 'listening' : deps.seed;
    state =
      deps.seed === 'ended'
        ? { phase: 'stopped', message: AUTO_STOPPED, engine: 'whisper', chapter: chapter.id, script, position: position(read, status) }
        : { phase: 'running', message: LISTENING, engine: 'whisper', chapter: chapter.id, script, position: position(read, status) };
    if (deps.seed !== 'flagged') return;
    const recorded = recording.events.flatMap(({ event }) => (event.type === 'flag' ? [event] : []));
    const extra: TeleprompterFlag = { type: 'flag', id: recorded.length + 1, kind: 'extra', start: 55, end: 55, heard: 'um, so' };
    seededFlags = [...recorded, extra]
      .map((flag) => ({ ...flag, start: flag.start + firstParagraph, end: flag.end + firstParagraph }))
      .filter((flag) => flag.end <= read);
  };

  return {
    teleprompterStart: async (options) => {
      const engine = options.engine ?? 'whisper';
      const needed = deps.assetRequired(engine);
      if (needed) return needed;
      if (!options.device.trim()) throw new Error('Choose a microphone.');
      await deps.ready;
      const { id, built } = options.credits ? planCredits(options.credits) : planChapter(options.chapter);
      cancelReplay();
      stopMeter();
      state = { phase: 'starting', message: 'Starting the teleprompter…', engine, chapter: id, paused: false, script: null, position: null };
      publish();
      const { script, words } = built;
      sessionWords = words;
      state = { ...state, phase: 'running', message: LISTENING };
      publish();
      emit(script);
      const from = Math.min(Math.max(0, options.startWord ?? 0), words.length);
      if (from > 0) emit(position(from, 'listening'));
      replay(words, from);
      return { status: 'started' };
    },
    teleprompterStop: async () => {
      cancelReplay();
      if (state.phase === 'starting' || state.phase === 'running') {
        state = { ...state, phase: 'stopped', message: 'Stopped.', paused: false };
        publish();
      }
    },
    // The host's Pause (service.go): only a running session; the replay stops and a resume replays on from the current word.
    teleprompterPause: async (paused) => {
      if (state.phase !== 'running') throw new Error('no teleprompter session is running');
      if (Boolean(state.paused) === paused) return;
      cancelReplay();
      state = { ...state, paused, message: paused ? 'Paused.' : LISTENING };
      publish();
      if (!paused) replay(sessionWords, state.position?.read ?? 0);
    },
    teleprompterSeek: async (word) => {
      if (state.phase !== 'running') throw new Error('no teleprompter session is running');
      emit({ type: 'position', read: word, committed: word, status: 'listening', jump: 'restart', skipped: null });
    },
    teleprompterSaveFlags: createFlagStore(deps),
    teleprompterState: async () => {
      // Concurrent first callers (React StrictMode mounts twice) must share one seeding.
      if (deps.seed) await (seeding ??= seedState());
      return clone();
    },
    teleprompterDevices: async () => ({ devices: deps.devices.map((device) => ({ ...device })), error: null }),
    // The host's meter (meter.go): refused while a session runs, one level straight away (no timer, so a capture is still),
    // then `meter_stopped` when it is stopped or replaced.
    teleprompterMeterStart: async (device) => {
      if (!device.trim()) throw new Error('choose a microphone');
      if (state.phase === 'starting' || state.phase === 'running' || state.phase === 'stopping')
        throw new Error('the reading session is using the microphone; its level shows in the bar');
      stopMeter();
      metering = true;
      emit(levelAt(0));
    },
    teleprompterMeterStop: async () => stopMeter(),
    teleprompterReaperInput: async () =>
      mockReaperInput(
        deps.reaperInput ?? 'matched',
        deps.devices.map((device) => device.name),
      ),
    readAloudReaperState: async (chapterId) => {
      await deps.ready;
      const chapter = findChapter(chapterId);
      if (!chapter) throw new Error('that chapter is not part of the current manuscript');
      return mockReaperState(
        deps.reaper ?? 'ready',
        chapter.title
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean)
          .join(': '),
      );
    },
    teleprompterLocate: async (chapterId, options) => {
      await deps.ready;
      if (deps.resume === 'error') throw new Error('Narration Utils could not read Alice.rpp: the file is locked by another program.');
      const match = seedTrackMatch(deps.trackMatch(chapterId), deps.resume);
      const chapter = findChapter(chapterId);
      if (!chapter) throw new Error('that chapter is not part of the current manuscript');
      const script = buildScript(chapter, deps.paragraphs());
      const result = mockLocate(match, deps.tracksProject, script, options?.trackGuid, whisperModelRequired(deps.assetRequired('whisper')));
      return structuredClone(withMockVerdict(seedLocateResult(result, deps.resume), deps.resume, chapterId, script));
    },
    subscribeTeleprompterEvent: (onEvent) => {
      eventSubscribers.add(onEvent);
      // A view that opens on a `flagged` session hears the flags it raised so far, as it would have while listening.
      if (deps.seed === 'flagged')
        void (seeding ??= seedState()).then(() => {
          if (eventSubscribers.has(onEvent)) seededFlags.forEach((flag) => onEvent({ ...flag }));
        });
      return () => eventSubscribers.delete(onEvent);
    },
    subscribeTeleprompterState: (onState) => {
      stateSubscribers.add(onState);
      return () => stateSubscribers.delete(onState);
    },
  };
}

/** A locate only ever runs Whisper, and its answer carries no engine (`TeleprompterModelRequired`). */
function whisperModelRequired(required: Extract<TeleprompterStartResult, { status: 'asset_required' }> | undefined): TeleprompterModelRequired | undefined {
  if (!required) return undefined;
  const { status, model, installState, downloadSize, diskSize, installPath } = required;
  return { status, model, installState, downloadSize, diskSize, installPath };
}
