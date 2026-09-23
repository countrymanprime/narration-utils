import type { TranscriptState } from './transcript';

export type Scope = 'global' | 'project';
export type ScopedSettingField = {
  key: string;
  label: string;
  // A `bool` is stored as the string "true" or "false" (every setting value is a string) and shown as a Switch.
  // A `number` is stored as its decimal text ("-3.5"); clearing one saves `null`, never "". Its range is in `number`.
  kind: 'text' | 'choice' | 'color' | 'bool' | 'number';
  choices: string[];
  value: string;
  isSet: boolean;
  effectiveValue: string;
  effectiveSource: string;
  /** The range of a `number` field (present on every one, absent on every other kind); a null bound or step is unbounded. */
  number?: NumberSettingRange;
};
export type NumberSettingRange = { min: number | null; max: number | null; step: number | null; unit: string };
export type Bootstrap = {
  apiVersion: number;
  diagnosticId: string;
  /** The application's own version, bare semver (`0.2.7`); a development build reports `0.0.0-dev`. */
  version: string;
  projectFolder: string;
  projectName: string;
  daw: string;
  /** Whether the project's manifest records a DAW project file that still resolves to a file on disk (PRD project-workspace-and-daw-link.prd.md, W13). */
  dawFileLinked: boolean;
  /**
   * Whether a running DAW can be confirmed reachable right now. Always `false` ("unknown") until Phase 6 of the PRD lands a bridge
   * liveness check (W10) - there is no heartbeat today, so this can never yet be `true`.
   */
  dawReachable: boolean;
  /**
   * Whether the DAW project currently open matches the linked file. Always `false` ("unknown") for the same reason as `dawReachable`
   * (PRD Phase 6/7, W10, W14).
   */
  dawProjectMatches: boolean;
  manuscript: { id: string; format: string; sourceName: string; importedAt: string; narratableWordCount: number; narratableChapterCount: number } | null;
  /** A manuscript file found in the project folder that has not been imported yet. Offered, never imported automatically (ADR-0019). */
  manuscriptCandidate?: { path: string; name: string } | null;
  runtime: Record<string, Record<string, string>>;
  transcript: TranscriptState;
};
export type HostReady = { apiVersion: number; diagnosticId: string };
export type ProjectAttachState = { attached: boolean; reason?: string };
/**
 * A host job that just ended, sent once per job on the `job:ended` event (ADR 0076). `kind` is `story_bible`, `manuscript_import`, `tts_install`,
 * `whisper_install`, `app_update`, `transcript_compare` or `recording_coverage` (a newer host may add more, so it is a string). `message` is a sentence for the narrator: the
 * failure text for an error. `durationMs` is how long the job ran, for the notification work to decide whether the narrator was waiting.
 */
export type JobEnded = { id: string; kind: string; outcome: 'success' | 'error' | 'cancelled'; message: string; durationMs: number };

export interface SystemApi {
  ready(): Promise<HostReady>;
  bootstrap(): Promise<Bootstrap>;
  saveSettings(tool: string, scope: Scope, values: Record<string, string | null>): Promise<Bootstrap>;
  settingsForScope(scope: Scope): Promise<Record<string, ScopedSettingField[]>>;
  reportClientDiagnostic(kind: string, message: string): Promise<void>;
  /**
   * Asks the host to raise one OS notification (N1-N4). The host silently does nothing when General.notifications is
   * off, and never surfaces a failed or unavailable sender: call this only after deciding the window is unfocused and
   * the job ran long enough to be worth interrupting the narrator for (see `shouldNotifyForJobEnd` in `jobEnded.ts`).
   */
  systemNotify(kind: string, title: string, body: string): Promise<void>;
  subscribeProjectAttach(onUpdate: (state: ProjectAttachState) => void): () => void;
  /** Calls `onNotice` with text the host wants the narrator to read (a file it could not read and kept aside, for one). */
  subscribeNotices(onNotice: (text: string) => void): () => void;
  /** Calls `onEnded` when a host job ends, whatever page the narrator is on. */
  subscribeJobEnded(onEnded: (event: JobEnded) => void): () => void;
  /** Calls `onDegraded` once when live updates from the host have been failing, so the app can say what is on screen may be out of date. */
  subscribeLiveUpdateHealth(onDegraded: () => void): () => void;
}
