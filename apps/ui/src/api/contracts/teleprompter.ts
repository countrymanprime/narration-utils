import type { ChapterTrackMatch, RecordedEnd } from './chapterTrackMap';
import type { WhisperInstallState, WhisperModel } from './whisper';

/**
 * The live engines (ADR 0021): both speak the same event contract. Which of them this computer can launch is the choices of the
 * host's `Teleprompter.engine` setting (Moonshine only on Windows, ADR 0107).
 */
export type TeleprompterEngine = 'whisper' | 'moonshine';

export type TeleprompterPhase = 'idle' | 'starting' | 'running' | 'stopping' | 'stopped' | 'error';
export type TeleprompterStatus = 'listening' | 'waiting' | 'done';

/** Where one title or paragraph sits in the chapter's flat word list (`text.split()` tokens). */
export type TeleprompterSpan = { kind: 'title' | 'paragraph'; id: string; index: number | null; start: number; count: number };
export type TeleprompterScript = { type: 'script'; chapter: { id: string; title: string }; tokens: number; spans: TeleprompterSpan[] };

/** `read` is the index of the next script word to be spoken; word times are advisory, only order is reliable. */
export type TeleprompterPosition = {
  type: 'position';
  read: number;
  committed: number;
  status: TeleprompterStatus;
  jump: 'restart' | 'skip' | null;
  skipped: [number, number] | null;
};

export type TeleprompterFlagKind = 'misread' | 'extra' | 'skipped' | 'restart';

/**
 * A suspected reading error the sidecar raised when a speech segment closed (`flags.py`, ADR 0115). Always only suspected:
 * live recognition is not proof, and Transcript Compare over the recorded take stays authoritative. `start`/`end` are script
 * word indices (the space of `TeleprompterPosition.read`): the misread, skipped or re-read words are `[start, end)`, and an
 * `extra` is zero-width (`start === end`), sitting before the word at `start`. `heard` is what was heard in their place ('' for
 * `skipped`). `id` counts a session's flags from 1. The kind is carried so a view can choose which kinds to show.
 */
export type TeleprompterFlag = { type: 'flag'; id: number; kind: TeleprompterFlagKind; start: number; end: number; heard: string };

/**
 * One flag as the read-aloud dialog sends it to be kept (`TeleprompterSaveFlags`, Phase 7, ADR 0117): its words within one
 * manuscript paragraph (`[wordStart, wordEnd)`, the reader's own word split; an `extra` covers the one word it was heard
 * before), the event's chapter word indices as evidence, what was heard, and whether the narrator dismissed it. The host
 * reads the paragraph itself, so the expected text and the finding's id come from the manuscript.
 */
export type TeleprompterFlagSave = {
  kind: TeleprompterFlagKind;
  paragraphId: string;
  wordStart: number;
  wordEnd: number;
  scriptStart: number;
  scriptEnd: number;
  heard: string;
  dismissed: boolean;
};

/**
 * A kept flag, as the findings store holds it (`apps/desktop/internal/liveflags`, docs/architecture/findings-contract.md). The
 * field names are the contract's own snake_case. Always suspected: `confidence` is null and `confidence_reason` says why.
 */
export type TeleprompterFlagFinding = {
  schema_version: number;
  id: string;
  analyzer: string;
  project: { path?: string; output_path?: string };
  source: { file?: string; track_guid?: string; item_guid?: string; take_guid?: string };
  manuscript: {
    chapter_id?: string;
    chapter_title?: string;
    expected?: string;
    recorded?: string;
    span?: { paragraph_id?: string; start?: number; end?: number; ordinal?: number };
  };
  category: 'transcript_discrepancy' | 'pickup';
  severity: 'info' | 'warning' | 'error';
  confidence: null;
  evidence_version?: string;
  confidence_reason: string;
  evidence: { kind: TeleprompterFlagKind; heard: string; suspected: true; script_words: [number, number]; before?: string };
  review: { status: 'unreviewed' | 'accepted' | 'dismissed' | 'deferred'; note?: string; timestamp?: string };
  not_in_latest_run?: boolean;
};

export type HeardWord = { word: string; start: number; end: number };

/**
 * The microphone's input level (`levels.py`, read-aloud-control-bar PRD Phase 4): every 100 ms of audio, the peak sample and the
 * loudest 50 ms RMS, in dBFS from -100 (silence) to 0 (full scale). A session sends it beside its words; the meter
 * (`teleprompterMeterStart`) sends only this. It is for a meter, never for the session model.
 */
export type TeleprompterLevel = { type: 'level'; peak: number; rms: number };

/** The host's word that the level meter ended: `error` is why when it ended by itself (a microphone that would not open), else null. */
export type TeleprompterMeterStopped = { type: 'meter_stopped'; error: string | null };

export type TeleprompterEvent =
  | TeleprompterScript
  | TeleprompterPosition
  | TeleprompterFlag
  | TeleprompterLevel
  | TeleprompterMeterStopped
  | { type: 'partial'; segment: number; words: HeardWord[] }
  | ({ type: 'word'; segment: number } & HeardWord)
  | { type: 'segment_end'; segment: number };

export type TeleprompterState = {
  phase: TeleprompterPhase;
  message: string;
  engine: string | null;
  /** The chapter id or title the session was started with. */
  chapter: string | null;
  /**
   * A running session whose listening is paused (`teleprompterPause`, ADR 0248): the phase stays `running`, the microphone and
   * its level stay live, the tracker holds its word. Absent from a host before host API 55, which reads as not paused.
   */
  paused?: boolean;
  script: TeleprompterScript | null;
  position: TeleprompterPosition | null;
};

export type TeleprompterStartOptions = (
  | {
      /** Chapter id or title. */
      chapter: string;
      credits?: never;
    }
  | {
      /**
       * Read the opening or closing credits instead of a chapter (audiobook-credits-templates.prd.md Phase 4, ADR 0150).
       * The host renders the text itself from the first template of that kind (ADR 0093), so only the kind is sent; the
       * session's `chapter` and its `script` event's `chapter.id` are then `credits-<kind>`.
       */
      credits: 'opening' | 'closing';
      chapter?: never;
    }
) & {
  /** Capture device name. */
  device: string;
  /** The live engine; the host defaults to Whisper. */
  engine?: TeleprompterEngine;
  /** The engine's model id (`tiny` or `small`, for either engine); the host defaults to tiny. */
  model?: string;
  language?: string;
  /** Start the tracker already at this script word index (the same space as `TeleprompterPosition.read`). */
  startWord?: number;
};

/** The first-use gate's answer for a tail-audio locate (Whisper only): the model it needs is not installed yet. */
export type TeleprompterModelRequired = {
  status: 'asset_required';
  model: Omit<WhisperModel, 'downloadSize' | 'installState'>;
  installState: WhisperInstallState;
  downloadSize: number;
  diskSize: number;
  installPath: string;
};

/**
 * Where a recording's tail sits in the chapter (the sidecar's `locate` line, locate.py): `word` is the next script word to read,
 * in the same index space as `TeleprompterPosition.read`; `last` the last word the tail placed and `sentence` the one holding
 * it (token range `[start, end)`), shown for confirmation. Both are null when the tail could not be placed. `confident` is
 * false for a tail that fits more than one place (a passage the chapter repeats) or too few words.
 */
export type TeleprompterLocated = {
  word: number | null;
  last: number | null;
  sentence: { start: number; end: number; text: string } | null;
  confidence: number;
  confident: boolean;
  matched: number;
  heard: number;
  runnerUp: number;
  tokens: number;
  heardText: string;
};

/**
 * Why a locate has a resume word or not (teleprompter manuscript integration PRD Phase 9, ADR 0111): `found` and
 * `low_confidence` carry one (only `found` is confident); `not_found` heard nothing that fits; `no_track` has no confirmed
 * or confident track (the narrator picks one from `match`); `no_recording` has nothing audible on the track; `source_missing`
 * and `source_unsupported` cannot read the last item's source file.
 */
export type TeleprompterLocateStatus = 'found' | 'low_confidence' | 'not_found' | 'no_track' | 'no_recording' | 'source_missing' | 'source_unsupported';

export type TeleprompterStartResult =
  | { status: 'started' }
  | {
      status: 'asset_required';
      /** The engine the missing model belongs to, which is also the asset kind it installs as (`assetsInstall(engine, model.id)`). */
      engine: TeleprompterEngine;
      /** A Whisper or a Moonshine catalog entry: both describe a model the same way. */
      model: Omit<WhisperModel, 'downloadSize' | 'installState'>;
      installState: WhisperInstallState;
      downloadSize: number;
      diskSize: number;
      installPath: string;
    };

export type TeleprompterLocateResult =
  | {
      status: TeleprompterLocateStatus;
      /** The chapter's track match (candidates, every track, and the .rpp's save time for "as of last save"). */
      match: ChapterTrackMatch;
      /** The track that was read: the match's own, or the narrator's pick. */
      track: { guid: string; name: string; index: number } | null;
      recordedEnd: RecordedEnd | null;
      /** The seconds of the source file that were transcribed. */
      tail: { from: number; to: number } | null;
      located: TeleprompterLocated | null;
      /** Where the prompter last stopped in this chapter, or null (none stored, or the chapter's text changed since). */
      lastReading: TeleprompterReading | null;
      /** The host's reconciliation of `located` with `lastReading` (read-aloud-resume-from-daw PRD Phase 3): render it, never recompute it. */
      verdict: TeleprompterResumeVerdict;
    }
  | TeleprompterModelRequired;

/**
 * What the resume prompt shows (read-aloud-resume-from-daw PRD Phase 3, `teleprompter.Reconcile`):
 * - `agree`: REAPER and the last reading are within ten words or in the same sentence; Start reading is preset to `start`
 *   and a one-line notice says so (with Change and Start from the top).
 * - `disagree`: both places are known and far apart; the narrator picks `daw` or `prompter` (or the top, or a word).
 * - `complete`: the recording reaches the last word; say "recorded to the end" and offer no resume.
 * - `daw_only` / `prompter_only`: one source has a place; offer it in the compact form, never preset it.
 * - `none`: nothing to show; Start reading begins at the top.
 */
export type TeleprompterResumeVerdictKind = 'agree' | 'disagree' | 'complete' | 'daw_only' | 'prompter_only' | 'none';

/**
 * One source's place: `word` is the zero-based next word to read (what `startWord` takes), `number` the same word one-based
 * for display, and `sentence` the sentence holding the last word read before it (token range `[start, end)`). `source` is
 * set on the DAW place: `saved` is the saved project ("as of the project's last save"); Phase 4 adds a live source.
 */
export type TeleprompterResumePlace = {
  word: number;
  number: number;
  sentence: { start: number; end: number; text: string } | null;
  confident: boolean;
  source?: 'saved';
};

export type TeleprompterResumeVerdict = {
  kind: TeleprompterResumeVerdictKind;
  /** Set only for `agree`: the word Start reading begins at without a click. */
  start: number | null;
  /** `prompter` when a low-confidence DAW word was settled by the last reading agreeing with it. */
  confirmedBy?: 'prompter';
  daw: TeleprompterResumePlace | null;
  prompter: TeleprompterResumePlace | null;
  tokens: number;
};

export type TeleprompterLocateOptions = {
  /** Read this track instead of the matcher's (the narrator's pick when the match is not confident). */
  trackGuid?: string;
  /** Whisper model id; the host defaults to the smallest. */
  model?: string;
};

/** One input device the sidecar's `--list-devices` reported, by the exact name its capture path opens it under. */
/** Where the prompter last was in a chapter (read-aloud-resume-from-daw PRD Phase 2, ADR 0205): the host writes it when a
 * chapter session ends and reads it back only while the chapter's text is unchanged (`scriptHash`). `read` is the index
 * space of a position event's `read` and of locate's `word`. Phase 3 carries it on the locate result as `lastReading`. */
export type TeleprompterReading = {
  version: 1;
  chapterId: string;
  read: number;
  tokens: number;
  scriptHash: string;
  status: TeleprompterStatus;
  endedAt: string;
};

export type TeleprompterDevice = { name: string };

/**
 * `TeleprompterDevices` never fails Start-style (see `apps/desktop/bindings.go`): a listing problem comes back as
 * `{devices: [], error: "..."}`, not a rejected promise, so a caller can always still try to start with a
 * previously-chosen device.
 */
export type TeleprompterDevicesResult = { devices: TeleprompterDevice[]; error: string | null };

/**
 * Whether REAPER is ready to record a chapter with reading (`ReadAloudReaperState`, read-aloud-control-bar PRD Phase 6, ADR 0249):
 * `ready` only when the chapter's linked track is the one track armed and REAPER is not recording. `reason` qualifies `no_link`
 * (`unlinked`, `several_links`, `track_missing`) and `unavailable` (`standalone`, `not_running`, `experimental_off`, `failed`).
 * `armedCount`, `playing` and `recording` are what REAPER said; `armedCount` is absent when it was not asked.
 */
export type ReadAloudReaperStatus = 'ready' | 'not_armed' | 'other_armed' | 'several_armed' | 'no_link' | 'recording_elsewhere' | 'unavailable';
export type ReadAloudReaperReason = 'unlinked' | 'several_links' | 'track_missing' | 'standalone' | 'not_running' | 'experimental_off' | 'failed';
export type ReadAloudReaperState = {
  status: ReadAloudReaperStatus;
  reason?: ReadAloudReaperReason;
  message: string;
  trackGuid?: string;
  armedCount?: number;
  playing: boolean;
  recording: boolean;
};

export interface TeleprompterApi {
  teleprompterStart(options: TeleprompterStartOptions): Promise<TeleprompterStartResult>;
  teleprompterStop(): Promise<void>;
  /** Move a running session's tracker straight to script word `word` ("Start here" / "Go back to here"). */
  teleprompterSeek(word: number): Promise<void>;
  /** Keep a session's flags as suspected, unreviewed findings; answers one finding per flag, in order (ADR 0117). */
  teleprompterSaveFlags(chapterId: string, flags: TeleprompterFlagSave[]): Promise<TeleprompterFlagFinding[]>;
  teleprompterState(): Promise<TeleprompterState>;
  teleprompterDevices(): Promise<TeleprompterDevicesResult>;
  /**
   * Show `device`'s level before reading starts: `level` events, then one `meter_stopped`, on `subscribeTeleprompterEvent`. It
   * replaces a meter already running and is refused while a session runs. Stop it when the microphone popover closes.
   */
  teleprompterMeterStart(device: string): Promise<void>;
  teleprompterMeterStop(): Promise<void>;
  /** Pause (true) or resume (false) a running session's listening without ending it; flags are kept only on Stop (ADR 0117). */
  teleprompterPause(paused: boolean): Promise<void>;
  /** Ask REAPER, once, whether it is ready to record `chapterId` with reading; read-only. Ask on open, toggle, Play and Refresh, never on a timer. */
  readAloudReaperState(chapterId: string): Promise<ReadAloudReaperState>;
  /** Where to resume `chapterId` from its recorded audio (the last seconds of its track, placed in the chapter); read-only. */
  teleprompterLocate(chapterId: string, options?: TeleprompterLocateOptions): Promise<TeleprompterLocateResult>;
  subscribeTeleprompterEvent(onEvent: (event: TeleprompterEvent) => void): () => void;
  subscribeTeleprompterState(onState: (state: TeleprompterState) => void): () => void;
}
