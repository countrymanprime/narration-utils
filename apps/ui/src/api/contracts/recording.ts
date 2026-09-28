// The built-in recorder (native-recording-suite PRD Phase 2, ADR 0455): the Booth records with REAPER or with the built-in
// recorder, which records a take of the chosen input device into the project's Recordings folder through the capture port's
// wasapi row (Experimental, ADR 0357). Mirrors apps/desktop/bindings_recording.go's RecorderState exactly.
import type { DawCapabilitySupport } from './daw';

/** Which engine the project records with: REAPER (the default) or the built-in recorder. It sets the engine chip. */
export type RecordingEngine = 'daw' | 'builtin';

export type RecorderPhase = 'idle' | 'metering' | 'recording' | 'stopping';

/** One take file in the Recordings folder. */
export type RecorderTake = {
  /** "Take 004". */
  name: string;
  /** The file's path: the media route plays it. */
  path: string;
  seconds: number;
  sampleRate: number;
  channels: number;
  bits: number;
  /** The file's modification time, Unix milliseconds. */
  recordedAt: number;
  /** A partial file a take left when its engine ended without finishing it; it plays up to the last second written. */
  unfinished: boolean;
  /** The manuscript line this take is assigned to (a composed line id), null when it carries none yet. */
  lineId: string | null;
};

/** How the most recent take ended. */
export type RecorderLastTake = {
  name: string;
  seconds: number;
  /** Blocks the engine lost or the recorder dropped. */
  dropouts: number;
  clipped: number;
  /** The engine's reported input latency (hardware monitoring is the recommendation, Q7). */
  latencyMs: number;
  /** Why it ended by itself, or why it kept its partial name; null for a clean take. */
  error: string | null;
  unfinished: boolean;
};

export type RecorderState = {
  hasProject: boolean;
  engine: RecordingEngine;
  /** The wasapi capture row's support here: Experimental, and unavailable off Windows. */
  support: DawCapabilitySupport;
  phase: RecorderPhase;
  /** The device recording or metering, else the one the project last recorded with ("" for none). */
  device: string;
  /** The project's Recordings folder ("" without a project). */
  folder: string;
  /** The take recording now. */
  take: string | null;
  /** When it started, Unix milliseconds. */
  startedAt: number | null;
  /** The last problem in a sentence, "" for none. */
  message: string;
  last: RecorderLastTake | null;
  takes: RecorderTake[];
};

/** The "recording:level" live event: dBFS, about ten a second while the recorder meters or records. */
export type RecorderLevel = { peak: number; rms: number };

export type RecorderDevice = { name: string };

/** A listing problem is `{devices: [], error: "..."}`, never a thrown error (like `TeleprompterDevicesResult`). */
export type RecorderDevicesResult = { devices: RecorderDevice[]; error: string | null };

export interface RecordingApi {
  recorderState(): Promise<RecorderState>;
  /** Saves the project's engine; 'builtin' is refused where its capture row is not available, or while a take records. */
  recorderChooseEngine(engine: RecordingEngine): Promise<RecorderState>;
  recorderDevices(): Promise<RecorderDevicesResult>;
  /** Meters `device` before a take (no file is written); refused while a take records. */
  recorderMeterStart(device: string): Promise<RecorderState>;
  recorderMeterStop(): Promise<RecorderState>;
  /** Records a new take of `device`; its end arrives on subscribeRecorderState. */
  recorderStart(device: string): Promise<RecorderState>;
  /** Asks the take or meter to end; answers at once. */
  recorderStop(): Promise<RecorderState>;
  subscribeRecorderState(onUpdate: (state: RecorderState) => void): () => void;
  subscribeRecorderLevel(onLevel: (level: RecorderLevel) => void): () => void;
}
