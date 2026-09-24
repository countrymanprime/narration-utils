// Measurement (diagnostics-delivery-and-cleanup-tools.prd.md Phase 1, ADR 0156): the narrator picks rendered audio
// files in the operating system's picker, and the host measures them as a job with real progress (ADR 0015). Field
// names inside a report and a fingerprint are the wire's own snake_case, as internal/measure writes them; the job
// around them is camelCase like the host's other jobs.

import type { Finding } from './findings';
import type { WorkJob } from './manuscript';

/** A stretch of a source file in seconds (internal/measure.Range). */
export type MeasureRange = { start_seconds: number; length_seconds: number };

/** A run of three or more full-scale samples on one channel, timed from the start of what was measured. */
export type MeasureClipRun = { channel: number; start_seconds: number; duration_seconds: number; samples: number };

/**
 * One measurement (internal/measure.Report). A level that cannot be measured (silence, audio too short) is null, never
 * a number (ADR 0025); the counts are measurements too, so clean audio has 0 and an empty list.
 */
export type MeasureReport = {
  file?: string;
  sample_rate: number;
  channels: number;
  duration_seconds: number;
  integrated_lufs: number | null;
  rms_dbfs: number | null;
  sample_peak_dbfs: number | null;
  true_peak_dbtp: number | null;
  noise_floor_dbfs: number | null;
  digital_silent_windows: number;
  full_scale_samples: number;
  clip_run_count: number;
  clip_runs: MeasureClipRun[];
  range?: MeasureRange;
};

/** The exact bytes a report was measured from: size, modified time (UTC, RFC 3339) and the SHA-256 of the whole file. */
export type MeasureFingerprint = { size_bytes: number; modified_at: string; sha256: string };

export type MeasureFileStatus = 'pending' | 'measuring' | 'measured' | 'failed' | 'cancelled';

/**
 * One file of a measurement: its report and fingerprint once measured, or why it could not be. `findings` are the host's
 * judgement of the report against the narrator's limits as they are when the job is read (measure.Evaluate, diagnostics PRD
 * Phase 7): `delivery_qc` findings, one for each value outside a limit or not measurable against one, with the IDs an
 * exported report carries. Empty when nothing is outside a limit, or no limit is set.
 */
export type MeasureFileResult = {
  path: string;
  name: string;
  status: MeasureFileStatus;
  report: MeasureReport | null;
  fingerprint: MeasureFingerprint | null;
  findings: Finding[];
  error?: string;
};

/**
 * The measurement job (MeasureAnalyze/State/Cancel), in the shape of the host's other jobs. The percent is the share of
 * all the files' bytes read so far. `error` is a measurement that broke; a file it could not measure is a `failed` file
 * of a successful job.
 */
export type MeasureJob = Omit<WorkJob, 'kind' | 'phase' | 'preview' | 'requiresReset' | 'result' | 'detail'> & {
  kind: 'measurement';
  phase: 'idle' | 'running' | 'success' | 'cancelled' | 'error';
  files: MeasureFileResult[];
  /** Why the narrator's limits could not be read (a hand-edited settings file); no file is then judged. */
  limitsError?: string;
};

/** What the picker chose; empty when the narrator closed it. */
export type MeasurePickResult = { paths: string[] };

/**
 * What one report export wrote (DeliveryExportReport, diagnostics PRD Phase 7): the folder relative to the project
 * (`narration-utils/delivery`), the two file names in it, and what the report counts. `openFindings` are the findings not
 * dismissed.
 */
export type DeliveryReportExport = {
  folder: string;
  htmlFile: string;
  jsonFile: string;
  files: number;
  findings: number;
  openFindings: number;
  pathsIncluded: boolean;
};

export interface MeasureApi {
  /** Opens the picker for the audio files to measure. Only paths chosen here can be measured. */
  measurePickFiles(): Promise<MeasurePickResult>;
  /** Measures picked files as a job; rejects a path that was not picked, too many files, or while a measurement runs. */
  measureAnalyze(paths: string[]): Promise<MeasureJob>;
  /** The measurement job: idle, running with real progress, or how it ended with every file's result. */
  measureState(): Promise<MeasureJob>;
  /** Stops a running measurement; files already measured keep their results. Answers the job. */
  measureCancel(): Promise<MeasureJob>;
  /**
   * Writes an HTML and a JSON report of the last measurement and diagnostics check into the project's sidecar folder.
   * `includePaths` writes each file's full path; otherwise only file names. Rejects without a project, while a job runs, or
   * when nothing was measured or checked.
   */
  deliveryExportReport(includePaths: boolean): Promise<DeliveryReportExport>;
}
