// The browser mock's measurement (diagnostics-delivery-and-cleanup-tools.prd.md Phase 1), answering the way
// apps/desktop/measure_job.go does: the same refusals (nothing chosen, a path the picker did not choose, one already
// running), a running job that reads one more quarter of a file per poll (standing in for the bytes the host reads, ADR
// 0015), and results in the shape tests/fixtures/contracts/measure-success.json pins: a chapter with every level, a
// render of digital silence whose levels are all unavailable (null, never a number), and a file that is not a WAV.
// `hold` keeps a started measurement part way through; `fails` breaks it at its first poll the way
// tests/fixtures/contracts/measure-error.json pins (the file being read fails, the rest are cancelled). Every answer is
// judged against the project's Delivery limits as they are when it is read, by measure.Evaluate's rules (Phase 7).
import type { DiagnosticsJob, Finding, JobEnded, MeasureApi, MeasureFileResult, MeasureJob, MeasureReport } from '../types';
import { wireClone } from './mockFixtures';

/** What the mock's picker chooses: three rendered chapters, the third one not a WAV. */
export const MOCK_MEASURE_PATHS = [
  'C:/Users/Narrator/Renders/Alice/Chapter 01.wav',
  'C:/Users/Narrator/Renders/Alice/Chapter 02 (silent).wav',
  'C:/Users/Narrator/Renders/Alice/Chapter 03.mp3',
];

const MAX_FILES = 500;
const QUARTERS_PER_FILE = 4;

function report(path: string, silent: boolean): MeasureReport {
  if (silent) {
    return {
      file: path,
      sample_rate: 44100,
      channels: 1,
      duration_seconds: 2,
      integrated_lufs: null,
      rms_dbfs: null,
      sample_peak_dbfs: null,
      true_peak_dbtp: null,
      noise_floor_dbfs: null,
      digital_silent_windows: 4,
      full_scale_samples: 0,
      clip_run_count: 0,
      clip_runs: [],
    };
  }
  return {
    file: path,
    sample_rate: 48000,
    channels: 2,
    duration_seconds: 1843.5,
    integrated_lufs: -19.4,
    rms_dbfs: -21.2,
    sample_peak_dbfs: -3.6,
    true_peak_dbtp: -3.1,
    noise_floor_dbfs: -66.8,
    digital_silent_windows: 0,
    full_scale_samples: 4,
    clip_run_count: 1,
    clip_runs: [{ channel: 1, start_seconds: 612.25, duration_seconds: 0.0000833, samples: 4 }],
  };
}

const baseName = (path: string): string => path.split(/[\\/]/).pop() ?? path;
/** The measurements a limit can apply to, in measure.Evaluate's order. */
const LIMITED = ['integrated_lufs', 'rms_dbfs', 'sample_peak_dbfs', 'true_peak_dbtp', 'noise_floor_dbfs'] as const;

const limitValue = (text: string | undefined): number | undefined => {
  if (text === undefined || text.trim() === '') return undefined;
  const value = Number(text);
  return Number.isFinite(value) ? value : undefined;
};

function deliveryFinding(file: MeasureFileResult, metric: string, kind: string, fields: Pick<Finding, 'severity' | 'confidence_reason' | 'evidence'>): Finding {
  return {
    schema_version: 1,
    id: `mock-measure-${baseName(file.path)}-${metric}-${kind}`.replace(/[^A-Za-z0-9-]/g, '-'),
    analyzer: 'measure',
    project: {},
    source: { file: file.path },
    category: 'delivery_qc',
    confidence: 1,
    ...fields,
    review: { status: 'unreviewed' },
  };
}

/** measure.Evaluate over one measured file: out of range is an error, not measurable against a limit is information. */
export function judgeMockFile(file: MeasureFileResult, limits: Readonly<Record<string, string>>): Finding[] {
  if (file.status !== 'measured' || !file.report) return [];
  const report = file.report;
  return LIMITED.flatMap((metric) => {
    const min = limitValue(limits[`${metric}_min`]);
    const max = limitValue(limits[`${metric}_max`]);
    if (min === undefined && max === undefined) return [];
    const base = { metric, profile: 'delivery-limits' };
    const value = report[metric];
    if (value === null) {
      return [
        deliveryFinding(file, metric, 'unavailable', {
          severity: 'info',
          confidence_reason: 'the measurement could not be made (silence, or audio shorter than the measurement window)',
          evidence: { ...base, available: false },
        }),
      ];
    }
    const violation = max !== undefined && value > max ? 'above_max' : min !== undefined && value < min ? 'below_min' : undefined;
    if (!violation) return [];
    const bounds = { ...(min !== undefined ? { limit_min: min } : {}), ...(max !== undefined ? { limit_max: max } : {}) };
    return [
      deliveryFinding(file, metric, 'out_of_range', {
        severity: 'error',
        confidence_reason: 'deterministic measurement of the decoded samples',
        evidence: { ...base, value, violation, ...bounds },
      }),
    ];
  });
}

const files = (count: number): string => (count === 1 ? '1 file' : `${count} files`);

/** The host's end-of-job sentence (measuredMessage in measure_job.go). */
function measuredMessage(measured: number, failed: number): string {
  if (failed === 0) return `Measured ${files(measured)}.`;
  if (measured === 0) return failed === 1 ? 'The file could not be measured.' : `None of the ${failed} files could be measured.`;
  return `Measured ${measured} of ${files(measured + failed)}; ${failed} could not be measured.`;
}

function measuredResult(file: MeasureFileResult, index: number): MeasureFileResult {
  if (!/\.wave?$/i.test(file.path)) return { ...file, status: 'failed', error: 'not a RIFF/WAVE file' };
  const silent = file.path.includes('silent');
  const hex = (index + 1).toString(16).padStart(2, '0');
  return {
    ...file,
    status: 'measured',
    report: report(file.path, silent),
    fingerprint: { size_bytes: silent ? 176_444 : 530_928_044, modified_at: '2026-09-23T14:02:11.5Z', sha256: hex.repeat(32) },
  };
}

export type MockMeasureSeed = 'hold' | 'fails';

const BROKE = 'runtime error: index out of range [4] with length 4';

/**
 * `picked` is the picker's allowlist, shared with the diagnostics mock the way the host shares it (ADR 0156); `limits` reads
 * the project's Delivery limits as they are now, by key; `checked` is the diagnostics check as it stands, which the report
 * export covers too.
 */
export function createMeasureMock(
  publish: (event: JobEnded) => void,
  seed?: MockMeasureSeed,
  picked = new Set<string>(),
  limits: () => Readonly<Record<string, string>> = () => ({}),
  checked: () => DiagnosticsJob | undefined = () => undefined,
): MeasureApi {
  const hold = seed === 'hold';
  let job: MeasureJob = { id: null, kind: 'measurement', phase: 'idle', message: 'Choose the files to measure.', percent: 0, logs: [], elapsed: 0, files: [] };
  let quarters = 0;
  let exports = 0;
  // The host judges on every read (judgeMeasureJob), so a limit changed in Settings re-judges what was measured.
  const judged = (): MeasureJob => wireClone({ ...job, files: job.files.map((file) => ({ ...file, findings: judgeMockFile(file, limits()) })) });

  const end = (phase: 'success' | 'cancelled' | 'error', message: string) => {
    job = { ...job, phase, message, logs: [...job.logs, message], percent: phase === 'success' ? 100 : job.percent };
    publish({ id: job.id ?? '', kind: 'measurement', outcome: phase, message, durationMs: Math.round(job.elapsed * 1000) });
  };

  // The host's recover() in measure_job.go: the file being read fails with the reason, the ones after it are not read.
  const breakDown = () => {
    job = {
      ...job,
      error: BROKE,
      files: job.files.map((file, i) =>
        i === 0 ? { ...file, status: 'failed', error: `the measurement stopped unexpectedly: ${BROKE}` } : { ...file, status: 'cancelled' },
      ),
    };
    end('error', 'The measurement stopped unexpectedly.');
  };

  const measuring = (index: number): Pick<MeasureJob, 'files' | 'message'> => ({
    files: job.files.map((file, i) => (i === index ? { ...file, status: 'measuring' } : file)),
    message: `Measuring ${job.files[index].name} (${index + 1} of ${job.files.length}).`,
  });

  // Each poll reads one more quarter of the current file; the fourth quarter measures it and moves to the next.
  const advance = () => {
    if (job.phase !== 'running' || hold) return;
    if (seed === 'fails') {
      breakDown();
      return;
    }
    quarters += 1;
    const index = Math.floor((quarters - 1) / QUARTERS_PER_FILE);
    const percent = Math.min(99, Math.floor((100 * quarters) / (QUARTERS_PER_FILE * job.files.length)));
    job = { ...job, percent, elapsed: job.elapsed + 2 };
    if (quarters % QUARTERS_PER_FILE !== 0) {
      job = { ...job, ...measuring(index) };
      return;
    }
    const result = measuredResult(job.files[index], index);
    const line = result.status === 'measured' ? `Measured ${result.name}.` : `${result.name} could not be measured: ${result.error}`;
    job = { ...job, files: job.files.map((file, i) => (i === index ? result : file)), logs: [...job.logs, line] };
    if (index + 1 < job.files.length) {
      job = { ...job, ...measuring(index + 1) };
      return;
    }
    const measured = job.files.filter((file) => file.status === 'measured').length;
    end('success', measuredMessage(measured, job.files.length - measured));
  };

  return {
    measurePickFiles: async () => {
      MOCK_MEASURE_PATHS.forEach((path) => picked.add(path));
      return { paths: [...MOCK_MEASURE_PATHS] };
    },
    measureAnalyze: async (paths) => {
      if (paths.length === 0) throw new Error('choose at least one file to measure');
      const unpicked = paths.find((path) => !picked.has(path));
      if (unpicked !== undefined) throw new Error(`"${unpicked}" was not chosen in the file picker; choose the files to measure again`);
      const unique = [...new Set(paths)];
      if (unique.length > MAX_FILES) throw new Error(`at most ${MAX_FILES} files can be measured at once; ${unique.length} were chosen`);
      if (job.phase === 'running') throw new Error('a measurement is already running');
      const message = `Measuring ${files(unique.length)}.`;
      quarters = 0;
      job = {
        id: 'measure-1',
        kind: 'measurement',
        phase: 'running',
        message,
        percent: 0,
        logs: [message],
        elapsed: 0,
        files: unique.map((path) => ({ path, name: baseName(path), status: 'pending', report: null, fingerprint: null, findings: [] })),
      };
      if (hold) job = { ...job, ...measuring(0), percent: Math.floor(100 / (2 * unique.length)), elapsed: 12 };
      return judged();
    },
    measureState: async () => {
      advance();
      return judged();
    },
    // The host's exportDeliveryReport (delivery_report.go): the same refusals, and what it counts. The mock writes nothing;
    // a second export in the same second gets the host's -2 name.
    deliveryExportReport: async (includePaths) => {
      const check = checked();
      if (job.phase === 'running' || check?.phase === 'running')
        throw new Error('wait for the measurement or the diagnostics check to finish, then export the report');
      const checkedFiles = check?.files ?? [];
      if (job.files.length === 0 && checkedFiles.length === 0) {
        throw new Error('nothing has been measured or checked in this session yet');
      }
      exports += 1;
      const stem = `delivery-report-20260923-140000Z${exports > 1 ? `-${exports}` : ''}`;
      const all = [...judged().files.flatMap((file) => file.findings), ...checkedFiles.flatMap((file) => (file.status === 'checked' ? file.findings : []))];
      return {
        folder: 'narration-utils/delivery',
        htmlFile: `${stem}.html`,
        jsonFile: `${stem}.json`,
        files: new Set([...job.files, ...checkedFiles].map((file) => file.path)).size,
        findings: all.length,
        openFindings: all.length,
        pathsIncluded: includePaths,
      };
    },
    measureCancel: async () => {
      if (job.phase === 'running') {
        const measured = job.files.filter((file) => file.status === 'measured').length;
        job = { ...job, files: job.files.map((file) => (file.status === 'pending' || file.status === 'measuring' ? { ...file, status: 'cancelled' } : file)) };
        end('cancelled', `Measurement cancelled. ${measured} of ${files(job.files.length)} ${measured === 1 ? 'was' : 'were'} measured.`);
      }
      return judged();
    },
  };
}
