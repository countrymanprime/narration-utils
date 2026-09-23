import type { WhisperInstallState, WhisperModel } from './whisper';

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

export type HeardWord = { word: string; start: number; end: number };
export type TeleprompterEvent =
  | TeleprompterScript
  | TeleprompterPosition
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

export type TeleprompterStartOptions = {
  /** Chapter id or title. */
  chapter: string;
  /** Capture device name. */
  device: string;
  /** Whisper model id; the host defaults to the smallest. */
  model?: string;
  language?: string;
};

export type TeleprompterStartResult =
  | { status: 'started' }
  | {
      status: 'asset_required';
      model: Omit<WhisperModel, 'downloadSize' | 'installState'>;
      installState: WhisperInstallState;
      downloadSize: number;
      diskSize: number;
      installPath: string;
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
  teleprompterState(): Promise<TeleprompterState>;
  teleprompterDevices(): Promise<TeleprompterDevicesResult>;
  subscribeTeleprompterEvent(onEvent: (event: TeleprompterEvent) => void): () => void;
  subscribeTeleprompterState(onState: (state: TeleprompterState) => void): () => void;
}
