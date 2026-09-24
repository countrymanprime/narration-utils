// The browser mock's diagnostics check (diagnostics-delivery-and-cleanup-tools.prd.md Phase 6), answering the way
// apps/desktop/diagnostics_job.go does: the same refusals (an unknown source kind, nothing chosen, a path the measurement
// picker did not choose, one already running), a running job that reads one more quarter of a file per poll (standing in
// for the bytes the host reads, ADR 0015), and results in the shape tests/fixtures/contracts/diagnostics-success.json
// pins: a chapter with a clip region, a level shift and a room-tone change, a render of digital silence in which nothing
// crossed a threshold, and a file that is not a WAV. The findings are built the way internal/measure's diagnosticfindings.go
// builds them, with the thresholds that raised them and the source kind the narrator chose. `hold` keeps a started check
// part way through; `fails` breaks it at its first poll the way tests/fixtures/contracts/diagnostics-error.json pins.
import type {
  DiagnosticsApi,
  DiagnosticsFileResult,
  DiagnosticsJob,
  DiagnosticsSourceKind,
  DiagnosticsSummary,
  DiagnosticsThresholds,
  Finding,
  JobEnded,
} from '../types';
import { wireClone } from './mockFixtures';

const MAX_FILES = 500;
const QUARTERS_PER_FILE = 4;
const BROKE = 'runtime error: index out of range [4] with length 4';

/** ADR 0158's starting thresholds (measure.DefaultDiagnosticOptions). */
export const MOCK_DIAGNOSTICS_THRESHOLDS: DiagnosticsThresholds = {
  clip_ceiling_dbfs: 0,
  silence_floor_dbfs: -50,
  min_silence_seconds: 0.3,
  level_shift_lu: 4,
  room_tone_step_db: 6,
  pauses: { min_pause_seconds: 0.3, long_pause_seconds: 2 },
};

const NO_TRANSCRIPT = { status: 'unavailable', reason: 'no transcript timing for this audio' } as const;
const label = (kind: DiagnosticsSourceKind) => (kind === 'processed_render' ? 'processed render' : 'raw recording');

function finding(
  path: string,
  id: string,
  start: number,
  end: number,
  fields: Pick<Finding, 'category' | 'severity' | 'confidence' | 'confidence_reason' | 'evidence'>,
): Finding {
  return {
    schema_version: 1,
    id,
    analyzer: 'diagnostics',
    project: {},
    source: { file: path },
    time_range: { start, end, source_start: start, source_end: end },
    ...fields,
    review: { status: 'unreviewed' },
  };
}

/** Chapter 01's three findings, as diagnosticfindings.go words them for the chosen source kind. */
function chapterFindings(path: string, kind: DiagnosticsSourceKind): Finding[] {
  const t = MOCK_DIAGNOSTICS_THRESHOLDS;
  return [
    finding(path, '97b9802a195636050e15f8bf', 612.25, 612.3125, {
      category: 'audio_quality',
      severity: 'warning',
      confidence: 1,
      confidence_reason: `deterministic: runs of 3 or more samples at or above the ceiling in the decoded audio of a ${label(kind)}`,
      evidence: { kind: 'clipping', source_kind: kind, ceiling_dbfs: t.clip_ceiling_dbfs, min_run_samples: 3, channels: [1], longest_run_samples: 9 },
    }),
    finding(path, '80ee6ea529c275f6667a0797', 905, 906, {
      category: 'audio_quality',
      severity: 'warning',
      confidence: null,
      confidence_reason: `a candidate from the mean short-term loudness of the read either side, in a ${label(kind)}; a deliberate change in delivery moves it too, so listen before acting`,
      evidence: {
        kind: 'level_shift',
        source_kind: kind,
        before_lufs: -19.5,
        after_lufs: -25.25,
        delta_lu: -5.75,
        level_shift_lu: t.level_shift_lu,
        context_seconds: 10,
      },
    }),
    finding(path, 'b0d5319b7d6de674d466b7d9', 1180.5, 1201.25, {
      category: 'audio_quality',
      severity: kind === 'processed_render' ? 'info' : 'warning',
      confidence: null,
      confidence_reason: `a candidate from the RMS of the silences either side, in a ${label(kind)}; a pickup session, a noise gate or noise reduction also changes it`,
      evidence: {
        kind: 'room_tone_change',
        source_kind: kind,
        before_dbfs: -68.5,
        after_dbfs: -60.25,
        delta_db: 8.25,
        room_tone_step_db: t.room_tone_step_db,
        silence_floor_dbfs: t.silence_floor_dbfs,
        min_silence_seconds: t.min_silence_seconds,
      },
    }),
  ];
}

function summary(silent: boolean): DiagnosticsSummary {
  if (silent) {
    return {
      duration_seconds: 2,
      sample_rate: 44100,
      channels: 1,
      clip_regions: 0,
      level_shifts: 0,
      silences: 1,
      silence_seconds: 2,
      room_tone_segments: 0,
      pacing: NO_TRANSCRIPT,
      words_per_minute: null,
    };
  }
  return {
    duration_seconds: 1843.5,
    sample_rate: 48000,
    channels: 2,
    clip_regions: 1,
    level_shifts: 1,
    silences: 212,
    silence_seconds: 187.4,
    room_tone_segments: 2,
    pacing: NO_TRANSCRIPT,
    words_per_minute: null,
  };
}

const baseName = (path: string): string => path.split(/[\\/]/).pop() ?? path;
const files = (count: number): string => (count === 1 ? '1 file' : `${count} files`);
const findingsCount = (count: number): string => (count === 1 ? '1 finding' : `${count} findings`);

/** The host's end-of-check sentence (checkedMessage in diagnostics_job.go). */
function checkedMessage(checked: number, failed: number): string {
  if (failed === 0) return `Checked ${files(checked)}.`;
  if (checked === 0) return failed === 1 ? 'The file could not be checked.' : `None of the ${failed} files could be checked.`;
  return `Checked ${checked} of ${files(checked + failed)}; ${failed} could not be checked.`;
}

function checkedResult(file: DiagnosticsFileResult, kind: DiagnosticsSourceKind): DiagnosticsFileResult {
  if (!/\.wave?$/i.test(file.path)) return { ...file, status: 'failed', error: 'not a RIFF/WAVE file' };
  const silent = file.path.includes('silent');
  return { ...file, status: 'checked', summary: summary(silent), findings: silent ? [] : chapterFindings(file.path, kind) };
}

export type MockDiagnosticsSeed = 'hold' | 'fails';

/**
 * `picked` is the measurement mock's picker allowlist: the host checks only paths MeasurePickFiles chose (ADR 0156).
 * `peekDiagnostics` is the check as it stands, without moving it on, for the report export (it is not a binding).
 */
export function createDiagnosticsMock(
  publish: (event: JobEnded) => void,
  picked: ReadonlySet<string>,
  seed?: MockDiagnosticsSeed,
): DiagnosticsApi & { peekDiagnostics(): DiagnosticsJob } {
  let job: DiagnosticsJob = {
    id: null,
    kind: 'diagnostics',
    phase: 'idle',
    message: 'Choose the files to check.',
    percent: 0,
    logs: [],
    elapsed: 0,
    sourceKind: null,
    thresholds: MOCK_DIAGNOSTICS_THRESHOLDS,
    files: [],
  };
  let quarters = 0;

  const end = (phase: 'success' | 'cancelled' | 'error', message: string) => {
    job = { ...job, phase, message, logs: [...job.logs, message], percent: phase === 'success' ? 100 : job.percent };
    publish({ id: job.id ?? '', kind: 'diagnostics', outcome: phase, message, durationMs: Math.round(job.elapsed * 1000) });
  };

  const checking = (index: number): Pick<DiagnosticsJob, 'files' | 'message'> => ({
    files: job.files.map((file, i) => (i === index ? { ...file, status: 'checking' } : file)),
    message: `Checking ${job.files[index].name} (${index + 1} of ${job.files.length}).`,
  });

  // Each poll reads one more quarter of the current file; the fourth quarter checks it and moves to the next.
  const advance = () => {
    if (job.phase !== 'running' || seed === 'hold') return;
    if (seed === 'fails') {
      job = {
        ...job,
        error: BROKE,
        files: job.files.map((file, i) =>
          i === 0 ? { ...file, status: 'failed', error: `the diagnostics stopped unexpectedly: ${BROKE}` } : { ...file, status: 'cancelled' },
        ),
      };
      end('error', 'The diagnostics stopped unexpectedly.');
      return;
    }
    quarters += 1;
    const index = Math.floor((quarters - 1) / QUARTERS_PER_FILE);
    job = { ...job, percent: Math.min(99, Math.floor((100 * quarters) / (QUARTERS_PER_FILE * job.files.length))), elapsed: job.elapsed + 2 };
    if (quarters % QUARTERS_PER_FILE !== 0) {
      job = { ...job, ...checking(index) };
      return;
    }
    const result = checkedResult(job.files[index], job.sourceKind ?? 'processed_render');
    const line =
      result.status === 'checked'
        ? `Checked ${result.name}: ${findingsCount(result.findings.length)}.`
        : `${result.name} could not be checked: ${result.error}`;
    job = { ...job, files: job.files.map((file, i) => (i === index ? result : file)), logs: [...job.logs, line] };
    if (index + 1 < job.files.length) {
      job = { ...job, ...checking(index + 1) };
      return;
    }
    const checked = job.files.filter((file) => file.status === 'checked').length;
    end('success', checkedMessage(checked, job.files.length - checked));
  };

  return {
    diagnosticsAnalyze: async (paths, sourceKind) => {
      if (sourceKind !== 'raw_recording' && sourceKind !== 'processed_render') {
        throw new Error(`say whether the files are raw recordings or processed renders ("${String(sourceKind)}" is neither)`);
      }
      if (paths.length === 0) throw new Error('choose at least one file to measure');
      const unpicked = paths.find((path) => !picked.has(path));
      if (unpicked !== undefined) throw new Error(`"${unpicked}" was not chosen in the file picker; choose the files to measure again`);
      const unique = [...new Set(paths)];
      if (unique.length > MAX_FILES) throw new Error(`at most ${MAX_FILES} files can be measured at once; ${unique.length} were chosen`);
      if (job.phase === 'running') throw new Error('a diagnostics check is already running');
      const message = `Checking ${files(unique.length)}.`;
      quarters = 0;
      job = {
        id: 'diagnostics-1',
        kind: 'diagnostics',
        phase: 'running',
        message,
        percent: 0,
        logs: [message],
        elapsed: 0,
        sourceKind,
        thresholds: MOCK_DIAGNOSTICS_THRESHOLDS,
        files: unique.map((path) => ({ path, name: baseName(path), status: 'pending', summary: null, findings: [] })),
      };
      if (seed === 'hold') job = { ...job, ...checking(0), percent: Math.floor(100 / (2 * unique.length)), elapsed: 12 };
      return wireClone(job);
    },
    diagnosticsState: async () => {
      advance();
      return wireClone(job);
    },
    peekDiagnostics: () => wireClone(job),
    diagnosticsCancel: async () => {
      if (job.phase === 'running') {
        const checked = job.files.filter((file) => file.status === 'checked').length;
        job = { ...job, files: job.files.map((file) => (file.status === 'pending' || file.status === 'checking' ? { ...file, status: 'cancelled' } : file)) };
        end('cancelled', `Diagnostics cancelled. ${checked} of ${files(job.files.length)} ${checked === 1 ? 'was' : 'were'} checked.`);
      }
      return wireClone(job);
    },
  };
}
