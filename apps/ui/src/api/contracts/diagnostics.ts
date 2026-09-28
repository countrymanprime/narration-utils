// Diagnostics (diagnostics-delivery-and-cleanup-tools.prd.md Phase 6): the windowed analyzers (ADR 0158) over files the
// narrator picked for measuring (MeasurePickFiles, ADR 0156), as a job with real progress (ADR 0015). Each file answers
// a summary and its findings; every finding carries the threshold that raised it and whether the audio is a raw
// recording or a processed render. Field names inside the thresholds, a summary and a finding are the wire's own
// snake_case, as internal/measure and internal/findings write them; the job around them is camelCase like the host's
// other jobs. Nothing here is saved or changed: the findings are unreviewed until the review store ingests them.

import type { Finding } from './findings';
import type { MeasureJob } from './measure';

/** What the narrator says the checked files are: room tone and level mean different things for each. */
export type DiagnosticsSourceKind = 'raw_recording' | 'processed_render';

/**
 * The silence cleanup analyzer's own thresholds (diagnostics-delivery-and-cleanup-tools.prd.md Phase 9 remainder,
 * ADR 0238 decision 4; internal/measure.CleanupOptions), read from the narrator's settings ("Cleanup" tool) and
 * shown the same way as `thresholds`: even before a check, so they are never hidden.
 */
export type DiagnosticsCleanupThresholds = {
  /** Kept at each side of a cut silence, in seconds. */
  pad_seconds: number;
  /** The shortest run read as a breath, in seconds. */
  min_breath_seconds: number;
  /** The longest run read as a breath, in seconds. */
  max_breath_seconds: number;
  /** How far below the read's speech level a breath sits, in dB. */
  breath_below_speech_db: number;
  /** How far above the silence around it a click's peak stands, in dB. */
  click_above_silence_db: number;
};

/** The thresholds the analyzers use (internal/measure.DiagnosticOptions). */
export type DiagnosticsThresholds = {
  /** At or above this, a sample counts towards clipping; 0 is the format's full scale. */
  clip_ceiling_dbfs: number;
  /** A 50 ms window whose RMS is below this is silent. */
  silence_floor_dbfs: number;
  /** The shortest silence the map keeps. */
  min_silence_seconds: number;
  /** The change in short-term loudness, before and after a point, that is a level shift. */
  level_shift_lu: number;
  /** The change in the level of the silences that starts a new room-tone segment. */
  room_tone_step_db: number;
  /** Pause thresholds, used only with transcript timing. */
  pauses: { min_pause_seconds: number; long_pause_seconds: number };
};

/** Measured, or unavailable with why (internal/measure.Evidence). */
export type DiagnosticsEvidence = { status: 'measured' | 'unavailable'; reason?: string };

/** What the analyzers found in one file, as counts (internal/measure.DiagnosticSummary). */
export type DiagnosticsSummary = {
  duration_seconds: number;
  sample_rate: number;
  channels: number;
  clip_regions: number;
  level_shifts: number;
  silences: number;
  silence_seconds: number;
  room_tone_segments: number;
  /** Pacing needs transcript timing; without it the reason says so. */
  pacing: DiagnosticsEvidence;
  /** Only with transcript timing, never estimated from silence. */
  words_per_minute: number | null;
};

export type DiagnosticsFileStatus = 'pending' | 'checking' | 'checked' | 'failed' | 'cancelled';

/**
 * One file of a check: its summary and findings once checked (an empty list when nothing crossed a threshold), or why
 * it could not be. `cleanupFindings` are the silence cleanup analyzer's own candidates (ADR 0238 decision 3), apart
 * from `findings` so the Diagnostics tab's own list is unchanged; read-only, like every finding here.
 */
export type DiagnosticsFileResult = {
  path: string;
  name: string;
  status: DiagnosticsFileStatus;
  summary: DiagnosticsSummary | null;
  findings: Finding[];
  cleanupFindings: Finding[];
  error?: string;
};

/**
 * The diagnostics job (DiagnosticsAnalyze/State/Cancel), in the shape of the measurement job. `sourceKind` is null
 * before any check; `thresholds` and `cleanupThresholds` are the ones a check uses, answered even when idle so they
 * are never hidden.
 */
export type DiagnosticsJob = Omit<MeasureJob, 'kind' | 'files' | 'profile' | 'bookRules' | 'profileNotice'> & {
  kind: 'diagnostics';
  sourceKind: DiagnosticsSourceKind | null;
  thresholds: DiagnosticsThresholds;
  cleanupThresholds: DiagnosticsCleanupThresholds;
  files: DiagnosticsFileResult[];
};

export interface DiagnosticsApi {
  /** Checks files chosen with measurePickFiles; rejects a path that was not picked, too many files, or while a check runs. */
  diagnosticsAnalyze(paths: string[], sourceKind: DiagnosticsSourceKind): Promise<DiagnosticsJob>;
  /** The check: idle with its thresholds, running with real progress, or how it ended with every file's findings. */
  diagnosticsState(): Promise<DiagnosticsJob>;
  /** Stops a running check; files already checked keep their results. Answers the job. */
  diagnosticsCancel(): Promise<DiagnosticsJob>;
}
