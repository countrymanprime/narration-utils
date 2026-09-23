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
export type TeleprompterEvent =
  | TeleprompterScript
  | TeleprompterPosition
  | TeleprompterFlag
  | { type: 'partial'; segment: number; words: HeardWord[] }
  | ({ type: 'word'; segment: number } & HeardWord)
  | { type: 'segment_end'; segment: number };

export type TeleprompterState = {
  phase: TeleprompterPhase;
  message: string;
  engine: string | null;
  /** The chapter id or title the session was started with. */
  chapter: string | null;
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
    }
  | TeleprompterModelRequired;

export type TeleprompterLocateOptions = {
  /** Read this track instead of the matcher's (the narrator's pick when the match is not confident). */
  trackGuid?: string;
  /** Whisper model id; the host defaults to the smallest. */
  model?: string;
};

/** One input device the sidecar's `--list-devices` reported, by the exact name its capture path opens it under. */
export type TeleprompterDevice = { name: string };

/**
 * `TeleprompterDevices` never fails Start-style (see `apps/desktop/bindings.go`): a listing problem comes back as
 * `{devices: [], error: "..."}`, not a rejected promise, so a caller can always still try to start with a
 * previously-chosen device.
 */
export type TeleprompterDevicesResult = { devices: TeleprompterDevice[]; error: string | null };

export interface TeleprompterApi {
  teleprompterStart(options: TeleprompterStartOptions): Promise<TeleprompterStartResult>;
  teleprompterStop(): Promise<void>;
  /** Move a running session's tracker straight to script word `word` ("Start here" / "Go back to here"). */
  teleprompterSeek(word: number): Promise<void>;
  /** Keep a session's flags as suspected, unreviewed findings; answers one finding per flag, in order (ADR 0117). */
  teleprompterSaveFlags(chapterId: string, flags: TeleprompterFlagSave[]): Promise<TeleprompterFlagFinding[]>;
  teleprompterState(): Promise<TeleprompterState>;
  teleprompterDevices(): Promise<TeleprompterDevicesResult>;
  /** Where to resume `chapterId` from its recorded audio (the last seconds of its track, placed in the chapter); read-only. */
  teleprompterLocate(chapterId: string, options?: TeleprompterLocateOptions): Promise<TeleprompterLocateResult>;
  subscribeTeleprompterEvent(onEvent: (event: TeleprompterEvent) => void): () => void;
  subscribeTeleprompterState(onState: (state: TeleprompterState) => void): () => void;
}
