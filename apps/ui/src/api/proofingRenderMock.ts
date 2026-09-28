// The browser mock's chapter-to-render association (proofing-readiness-signals.prd.md Phase 6,
// apps/desktop/bindings_proofing_render.go, apps/desktop/internal/proofing/renders.go). ProofingChooseRender always
// succeeds here (the file dialog itself is not simulated, the same convention as ProjectLinkDawFile's mock): choosing
// attests a canonical rendered-file path for the chapter. A seed can start a chapter at any state (`stale`, `missing`,
// `unsupported`, already measured) without going through choose() and Measure first. `recordMeasurement` is
// mockApi.ts's hook from the measurement job, mirroring the host's renderMeasurementRecorder: any measured job file
// whose path matches a chapter's chosen render updates that chapter's own measurement, exactly once per Measure.
import type { ManuscriptChapter, MeasureFileResult, MeasureReport, ProofingRender, ProofingRenderApi, ProofingRenderState, StageUnknownCause } from '../types';
import { wireClone } from './mockFixtures';

const MOCK_TIME = '2026-09-21T10:00:00Z';
const MEASURED_TIME = '2026-09-21T11:00:00Z';

const UNKNOWN_CAUSE: Partial<Record<ProofingRenderState, StageUnknownCause>> = {
  none: 'never_analyzed',
  stale: 'stale',
  missing: 'measurement_unavailable',
  unsupported: 'measurement_unavailable',
};

type RenderRecord = {
  state: ProofingRenderState;
  path?: string;
  format?: 'wav' | 'mp3';
  attestedAt?: string;
  measurement?: MeasureReport;
  measuredAt?: string;
  measurementFailed: boolean;
};

export type ProofingRenderSeed = Partial<
  Record<
    string,
    {
      state?: ProofingRenderState;
      /** Seeds a plausible measurement of the chosen render (only meaningful with `state: 'current'`, the default). */
      measured?: boolean;
      /** Seeds a measurement that ran and failed, rather than one that never ran. */
      measurementFailed?: boolean;
    }
  >
>;

type Deps = {
  ready: Promise<unknown>;
  chapters: () => ManuscriptChapter[];
  /** The measurement job's own allowlist (measureMock.ts, shared with diagnostics): choosing a render here adds its
   * path, the same way the host's ProofingChooseRender marks it measurable (markPathMeasurable), so Measure needs no
   * second picker. */
  picked: Set<string>;
  seed?: ProofingRenderSeed;
};

const baseName = (path: string) => path.split(/[\\/]/).pop() ?? path;

function measurementFor(path: string): MeasureReport {
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
    head_room_tone_seconds: 0.8,
    tail_room_tone_seconds: 2.5,
    head_digital_silence_seconds: 0,
    tail_digital_silence_seconds: 0,
    full_scale_samples: 0,
    clip_run_count: 0,
    clip_runs: [],
  };
}

/** The reason text for a state that is not `current` (apps/desktop/internal/proofing/renders.go's own sentences). */
function reasonFor(state: ProofingRenderState, path?: string): string {
  switch (state) {
    case 'none':
      return 'Choose the rendered file for this chapter.';
    case 'stale':
      return 'The rendered file changed since you chose it. Choose it again to say it was made from the chapter as it is now, then measure it.';
    case 'missing':
      return `The rendered file ${path ? baseName(path) : 'chosen'} could not be read. Choose the rendered file again.`;
    case 'unsupported':
      return 'The rendered file is not a WAV file; only a WAV render is measured. Choose the WAV render the delivered file was made from.';
    case 'current':
      return '';
  }
}

function recordFor(chapter: ManuscriptChapter, seed?: ProofingRenderSeed[string]): RenderRecord {
  const state = seed?.state ?? 'none';
  if (state === 'none') return { state, measurementFailed: false };
  const format = state === 'unsupported' ? 'mp3' : 'wav';
  const path = `C:/Users/Narrator/Renders/Alice/${chapter.title}.${format}`;
  const record: RenderRecord = { state, path, format, attestedAt: MOCK_TIME, measurementFailed: false };
  if (state === 'current' && seed?.measurementFailed) record.measurementFailed = true;
  else if (state === 'current' && seed?.measured) {
    record.measurement = measurementFor(path);
    record.measuredAt = MEASURED_TIME;
  }
  return record;
}

function view(record: RenderRecord): ProofingRender {
  const cause = record.state === 'current' ? undefined : UNKNOWN_CAUSE[record.state];
  return {
    state: record.state,
    ...(cause ? { cause } : {}),
    reason: reasonFor(record.state, record.path),
    ...(record.path ? { path: record.path } : {}),
    ...(record.format ? { format: record.format } : {}),
    ...(record.attestedAt ? { attestedAt: record.attestedAt } : {}),
    ...(record.measurement ? { measurement: record.measurement } : {}),
    ...(record.measuredAt ? { measuredAt: record.measuredAt } : {}),
    measurementFailed: record.measurementFailed,
  };
}

export function createProofingRenderMock(deps: Deps): ProofingRenderApi & { recordMeasurement: (files: readonly MeasureFileResult[]) => void } {
  const records = new Map<string, RenderRecord>();

  const find = async (chapterId: string) => {
    await deps.ready;
    const chapter = deps.chapters().find((candidate) => candidate.id === chapterId);
    if (!chapter) throw new Error(`chapter ${chapterId} is not in the manuscript`);
    return chapter;
  };

  const recordOf = (chapter: ManuscriptChapter): RenderRecord => {
    const existing = records.get(chapter.id);
    if (existing) return existing;
    const seeded = recordFor(chapter, deps.seed?.[chapter.id]);
    if (seeded.path) deps.picked.add(seeded.path);
    records.set(chapter.id, seeded);
    return seeded;
  };

  return {
    proofingRenderState: async (chapterId) => wireClone(view(recordOf(await find(chapterId)))),
    proofingChooseRender: async (chapterId) => {
      const chapter = await find(chapterId);
      const path = `C:/Users/Narrator/Renders/Alice/${chapter.title}.wav`;
      const record: RenderRecord = { state: 'current', path, format: 'wav', attestedAt: MOCK_TIME, measurementFailed: false };
      deps.picked.add(path);
      records.set(chapterId, record);
      return { status: 'ok', render: wireClone(view(record)) };
    },
    proofingClearRender: async (chapterId) => {
      const chapter = await find(chapterId);
      records.set(chapter.id, { state: 'none', measurementFailed: false });
      return wireClone(view(records.get(chapter.id)!));
    },
    // Mirrors apps/desktop/internal/proofing/renders.go's RecordRenderMeasurements: every chapter whose chosen render
    // is this measured file gets the file's own result (the same file can be chosen for more than one chapter).
    recordMeasurement: (files) => {
      for (const [chapterId, record] of records) {
        if (record.state !== 'current' || !record.path) continue;
        const file = files.find((candidate) => candidate.path === record.path);
        if (!file || (file.status !== 'measured' && file.status !== 'failed')) continue;
        records.set(chapterId, {
          ...record,
          measurement: file.status === 'measured' && file.report ? file.report : undefined,
          measuredAt: MEASURED_TIME,
          measurementFailed: file.status !== 'measured' || !file.report,
        });
      }
    },
  };
}
