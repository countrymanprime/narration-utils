// The browser mock's recording coverage (docs/utilities/recording-coverage.md, ADR 0129). It answers the same
// states the host does: a chapter whose fixture carries a recordedFraction has a current check with that share of its
// words present, any other chapter was never checked, a seeded chapter reads stale (and so loses its recordedFraction),
// a started check steps through real-looking progress to a result and one job end, and a seeded refusal answers every
// start with that reason. Nothing runs on its own (Q14).
import type {
  CoverageApi,
  CoverageRefusalReason,
  CoverageReport,
  CoverageResult,
  CoverageStartResult,
  CoverageState,
  JobEnded,
  ManuscriptChapter,
} from '../types';

type AssetRequired = Extract<CoverageStartResult, { status: 'asset_required' }>;

export type CoverageSeed = {
  /** Every start answers this refusal, so each reason's state can be seen without a host. */
  refusal?: CoverageRefusalReason;
  /** Chapters whose check reads stale (an item was trimmed since), so they carry no recordedFraction. */
  stale?: string[];
  /** A started check stops at its last transcribing step and never ends, so the running dialog can be seen without a race. */
  hold?: boolean;
  /** Chapters with a current check that found this share of their words, as if checked in this session (instead of their fixture's). */
  measured?: Record<string, number>;
};

type Deps = {
  chapters: () => ManuscriptChapter[];
  assetRequired: () => AssetRequired | undefined;
  endJob: (event: JobEnded) => void;
  seed?: CoverageSeed;
};

/** The sentence the host gives with each refusal (apps/desktop/internal/coverage), in short. */
const COVERAGE_REFUSAL_MESSAGES: Record<CoverageRefusalReason, string> = {
  no_project: 'Open a project before checking a recording.',
  no_project_file: 'Choose the saved REAPER project file on the Tracks page first.',
  project_unreadable: 'The saved REAPER project file could not be read.',
  no_manuscript: 'Import a manuscript before checking a recording.',
  chapter_not_found: 'That chapter is not part of the current manuscript.',
  not_narration: 'Only narration chapters are checked, not front matter or reference sections.',
  unmapped: 'Confirm which REAPER track holds this chapter first.',
  multiple_tracks: 'More than one REAPER track is linked to this chapter; keep one.',
  mapped_track_missing: 'The REAPER track linked to this chapter is no longer in the saved project.',
  no_items: 'The chapter’s track has no audio items in the saved project.',
  unsupported_item: 'An item on the chapter’s track is not an audio file the check can read.',
  source_missing: 'An audio file the chapter’s track plays is missing.',
  item_unreadable: 'An audio file the chapter’s track plays could not be read.',
  busy: 'A recording check is already running.',
  sidecar_missing: 'Configure the Transcript Compare executable before checking a recording.',
  invalid_params: 'The recording check settings are not valid.',
  manuscript_changed: 'The manuscript changed during the recording check; check again.',
  result_missing: 'The stored result of the last check could not be read.',
};

const STEP_MS = 300;
const PROGRESS_STEPS = [
  { stage: 'TRANSCRIBE', percent: 35, message: 'Transcribing item 1 of 2…' },
  { stage: 'TRANSCRIBE', percent: 70, message: 'Transcribing item 2 of 2…' },
  { stage: 'ALIGN', percent: 90, message: 'Aligning the text…' },
];
const MOCK_BASIS = { label: 'saved project, file modified 2026-09-21T10:00:00Z', modifiedAt: '2026-09-21T10:00:00Z', stale: false };
const MOCK_TIME = '2026-09-21T10:00:00Z';
/** A narration pace, for the mock's played seconds only. */
const WORDS_PER_MINUTE = 155;

const idle: CoverageState = { phase: 'idle', percent: 0, message: 'Save the REAPER project, then check a chapter’s recording.' };

const narratable = (chapter: ManuscriptChapter) => chapter.contentKind !== 'opening' && chapter.contentKind !== 'reference';

/** A report of a chapter read with `fraction` of its words present; what is missing is its tail. */
function reportFor(chapter: ManuscriptChapter, fraction: number): CoverageReport {
  const bodyTokens = chapter.wordCount;
  const presentTokens = Math.round(bodyTokens * fraction);
  const missingTokens = bodyTokens - presentTokens;
  const paragraphs = (chapter.paragraphIds ?? [{ id: `${chapter.id}-p1`, index: 0 }]).map(({ id }) => id);
  const share = Math.floor(bodyTokens / paragraphs.length);
  const sizes = paragraphs.map((_, index) => (index === paragraphs.length - 1 ? bodyTokens - share * (paragraphs.length - 1) : share));
  // The missing words are the chapter's tail: they come out of the last paragraphs first.
  const missingIn = sizes.map((size, index) => Math.max(0, Math.min(size, missingTokens - sizes.slice(index + 1).reduce((sum, next) => sum + next, 0))));
  const itemGuid = `{${chapter.id}-item-1}`;
  const playedSeconds = Math.round((presentTokens / WORDS_PER_MINUTE) * 60);
  return {
    model: 'small',
    alignment: { maxMisreadRun: 8, minAnchorRun: 3 },
    bodyTokens,
    presentTokens,
    missingTokens,
    extraTokens: 0,
    longestMissingRun: missingTokens,
    playedSeconds,
    items: [{ index: 0, itemGuid, status: 'analyzed', words: 'reused', playedSeconds, wordCount: presentTokens, model: 'small' }],
    paragraphs: paragraphs.map((id, index) => ({ id, tokens: sizes[index], present: sizes[index] - missingIn[index], longestMissingRun: missingIn[index] })),
    regions:
      missingTokens > 0
        ? [
            {
              kind: 'tail',
              paragraphIds: paragraphs.filter((_, index) => missingIn[index] > 0),
              tokenCount: missingTokens,
              firstWord: 'the',
              lastWord: 'end.',
              position: { itemIndex: 0, itemGuid, sourceTime: playedSeconds },
            },
          ]
        : [],
  };
}

export function createCoverageMock(deps: Deps): CoverageApi & {
  /** The chapter as the host sends it: recordedFraction only from a current check. */
  withMeasurement: (chapter: ManuscriptChapter) => ManuscriptChapter;
} {
  let state: CoverageState = { ...idle };
  let timers: ReturnType<typeof setTimeout>[] = [];
  const subscribers = new Set<(state: CoverageState) => void>();
  // Fractions measured by a check run in this session; they replace the fixture's.
  const measured = new Map<string, number>(Object.entries(deps.seed?.measured ?? {}));
  const stale = new Set(deps.seed?.stale ?? []);

  const publish = () => subscribers.forEach((listener) => listener({ ...state }));
  const stop = () => {
    timers.forEach(clearTimeout);
    timers = [];
  };
  const fractionOf = (chapter: ManuscriptChapter): number | undefined =>
    stale.has(chapter.id) ? undefined : (measured.get(chapter.id) ?? chapter.recordedFraction);

  const result = (chapterId: string): CoverageResult => {
    const chapter = deps.chapters().find((item) => item.id === chapterId);
    if (!chapter) return { chapterId, state: 'never', reasons: ['chapter_not_found'] };
    if (!narratable(chapter)) return { chapterId, state: 'never', reasons: ['not_narration'] };
    const fraction = measured.get(chapter.id) ?? chapter.recordedFraction;
    if (fraction === undefined) return { chapterId, state: 'never', reasons: [], basis: { ...MOCK_BASIS } };
    const record = { id: `mock-coverage-${chapter.id}`, outcome: 'complete' as const, startedAt: MOCK_TIME, completedAt: MOCK_TIME };
    const report = reportFor(chapter, fraction);
    if (stale.has(chapter.id)) return { chapterId, state: 'stale', reasons: ['item_trimmed'], basis: { ...MOCK_BASIS }, record, result: report };
    // The same number the chapter payload carries (withMeasurement): the host sends one number to both.
    return { chapterId, state: 'current', reasons: [], basis: { ...MOCK_BASIS }, record, result: report, recordedFraction: fraction };
  };

  const refuse = (reason: CoverageRefusalReason): CoverageStartResult => ({ status: 'refused', reason, message: COVERAGE_REFUSAL_MESSAGES[reason] });

  const finish = (chapter: ManuscriptChapter, runId: string, startedAt: number) => {
    const fraction = measured.get(chapter.id) ?? chapter.recordedFraction ?? 1;
    measured.set(chapter.id, fraction);
    stale.delete(chapter.id);
    const report = reportFor(chapter, fraction);
    const message = `Text present: ${report.presentTokens} of ${report.bodyTokens} words.`;
    state = {
      ...state,
      phase: 'complete',
      percent: 100,
      stage: 'DONE',
      message,
      recordId: `mock-coverage-${chapter.id}`,
      completedAt: new Date().toISOString(),
    };
    publish();
    deps.endJob({ id: runId, kind: 'recording_coverage', outcome: 'success', message, durationMs: Date.now() - startedAt });
  };

  return {
    withMeasurement: (chapter) => {
      const fraction = fractionOf(chapter);
      if (fraction !== undefined) return { ...chapter, recordedFraction: fraction };
      const unmeasured = { ...chapter };
      delete unmeasured.recordedFraction;
      return unmeasured;
    },
    coverageStart: async (chapterId) => {
      if (deps.seed?.refusal) return refuse(deps.seed.refusal);
      const required = deps.assetRequired();
      if (required) return required;
      if (state.phase === 'running') return refuse('busy');
      const chapter = deps.chapters().find((item) => item.id === chapterId);
      if (!chapter) return refuse('chapter_not_found');
      if (!narratable(chapter)) return refuse('not_narration');
      stop();
      const startedAt = Date.now();
      const runId = String(startedAt);
      state = {
        runId,
        chapterId,
        phase: 'running',
        percent: 0,
        stage: 'START',
        message: 'Starting the recording check...',
        startedAt: new Date(startedAt).toISOString(),
      };
      publish();
      const steps = deps.seed?.hold ? PROGRESS_STEPS.filter((step) => step.stage === 'TRANSCRIBE') : PROGRESS_STEPS;
      steps.forEach((step, index) =>
        timers.push(
          setTimeout(
            () => {
              if (state.runId !== runId || state.phase !== 'running') return;
              state = { ...state, ...step };
              publish();
            },
            STEP_MS * (index + 1),
          ),
        ),
      );
      if (!deps.seed?.hold)
        timers.push(
          setTimeout(
            () => {
              if (state.runId === runId && state.phase === 'running') finish(chapter, runId, startedAt);
            },
            STEP_MS * (PROGRESS_STEPS.length + 1),
          ),
        );
      return { status: 'started', state: { ...state } };
    },
    coverageState: async () => ({ ...state }),
    coverageCancel: async () => {
      if (state.phase !== 'running' || !state.runId) return;
      stop();
      const message = 'Cancelled. The items already transcribed are kept for the next check.';
      state = { ...state, phase: 'cancelled', message, completedAt: new Date().toISOString() };
      publish();
      deps.endJob({ id: state.runId ?? '', kind: 'recording_coverage', outcome: 'cancelled', message, durationMs: 0 });
    },
    coverageResult: async (chapterId) => result(chapterId),
    subscribeCoverage: (onUpdate) => {
      subscribers.add(onUpdate);
      onUpdate({ ...state });
      return () => void subscribers.delete(onUpdate);
    },
  };
}
