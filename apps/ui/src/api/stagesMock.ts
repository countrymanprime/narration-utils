// The browser mock's chapter stage recommendations (docs/prds/chapter-stage-recommendations.prd.md Phase 4). It answers what
// the host answers with only the recording signal wired: a chapter in recording is judged by its recording check (from its
// recordedFraction unless seeded: all read is met, part read is not met, never checked is unknown), a chapter in editing or
// proofing has no required signal yet, and a chapter not started or finalized is not evaluated. Confirm, Dismiss and Revert act
// like the host's, refusals included; a seed can put a chapter in any state (each unknown cause, a live confirmation, a
// dismissal, the "evidence changed since you confirmed" notice) without a host.
import type {
  ChapterStatus,
  ManuscriptChapter,
  StageChapterRecommendation,
  StageDecisionResult,
  StageNoneReason,
  StageRecommendations,
  StageRefusalReason,
  StageSignal,
  StageUnknownCause,
  StagesApi,
  StageVerdict,
} from '../types';

/** What the recording check of a chapter says: `met`, `not_met`, or `unknown` with its cause. */
export type StageRecordingScenario = 'met' | 'not_met' | { unknown: StageUnknownCause };

export type StagesSeed = {
  /** The recording signal of these chapters, instead of the one their recordedFraction gives. */
  recording?: Record<string, StageRecordingScenario>;
  /** Chapters in editing that the narrator confirmed from recording on an all-read check (a live confirmation). */
  confirmed?: string[];
  /** Chapters whose all-read recording check the narrator dismissed. */
  dismissed?: string[];
};

/** One stage's verdict, the part of an assessment the engine computes. */
type Evaluation = { target?: ChapterStatus; verdict: StageVerdict; noneReason?: StageNoneReason; basisKey?: string; signals: StageSignal[] };

type Deps = {
  ready: Promise<unknown>;
  /** The chapters as the host sends them (recordedFraction only from a current check). */
  chapters: () => ManuscriptChapter[];
  setStatus: (chapterId: string, status: ChapterStatus) => void;
  seed?: StagesSeed;
};

const MOCK_TIME = '2026-09-21T10:00:00Z';
const SIGNAL_ID = 'recording.text_present';
const NEXT_STAGE: Partial<Record<ChapterStatus, ChapterStatus>> = { recording: 'editing', editing: 'proofing', proofing: 'finalized' };

/** The host's refusal sentences (apps/desktop/internal/stages/service.go). */
const REFUSAL_MESSAGES: Record<StageRefusalReason, string> = {
  basis_changed: 'the evidence changed while you were looking; check again',
  not_recommended: 'there is no suggestion to act on for this chapter',
  nothing_to_revert: 'this chapter has no confirmed suggestion to revert',
};

/** The recording signal's reason for each cause (apps/desktop/internal/coverage/signal.go), in short. */
const UNKNOWN_REASONS: Record<StageUnknownCause, string> = {
  never_analyzed: 'This chapter’s recording has not been checked yet.',
  stale: 'Check again: since the last check an item was trimmed.',
  incomplete_run: 'The last recording check was cancelled before it finished. Check again.',
  analysis_running: 'A recording check of this chapter is running.',
  unmapped_track: 'Link this chapter to the REAPER track it is recorded on.',
  unconfirmed_mapping: 'A track’s name matches this chapter. Confirm the link to check its recording.',
  multiple_tracks: 'This chapter is linked to more than one REAPER track. Keep one link.',
  measurement_unavailable: 'The recording cannot be checked here: the Whisper model Small is not installed.',
  project_unreadable: 'Choose the saved REAPER project file on the Tracks page.',
  provider_error: 'could not check: the recording check results could not be read',
};

const narration = (chapter: ManuscriptChapter) => chapter.contentKind === undefined || chapter.contentKind === 'narration';

const scenarioState = (scenario: StageRecordingScenario) => (typeof scenario === 'string' ? scenario : 'unknown');

/** A stand-in for the host's SHA-256 basis key: the same evidence always gives the same key. */
const keyFor = (chapterId: string, target: ChapterStatus, scenario: StageRecordingScenario) =>
  ['mock-basis', chapterId, target, scenarioState(scenario), typeof scenario === 'string' ? '' : scenario.unknown].join(':');

function recordingSignal(chapter: ManuscriptChapter, scenario: StageRecordingScenario): StageSignal {
  const base = { id: SIGNAL_ID, stage: 'recording' as const, computedAt: MOCK_TIME };
  if (typeof scenario !== 'string') {
    return {
      ...base,
      state: 'unknown',
      cause: scenario.unknown,
      reason: UNKNOWN_REASONS[scenario.unknown],
      evidence: scenario.unknown === 'stale' ? [{ kind: 'stale', label: 'Changed since the check', value: 'item_trimmed' }] : [],
      basis: { ledgerRecordIds: [], fingerprint: '', projectFileModTime: MOCK_TIME },
    };
  }
  const fraction = scenario === 'met' ? 1 : Math.min(chapter.recordedFraction ?? 0.65, 0.99);
  const present = Math.round(chapter.wordCount * fraction);
  const missing = chapter.wordCount - present;
  const lastParagraph = chapter.paragraphIds?.at(-1)?.id ?? `${chapter.id}-p1`;
  const coverage = {
    kind: 'coverage',
    label: 'Text present',
    value: `${present} of ${chapter.wordCount} words present, ${missing} missing`,
  };
  const basis = { ledgerRecordIds: [`mock-record-${chapter.id}`], fingerprint: `mock-fingerprint-${chapter.id}`, projectFileModTime: MOCK_TIME };
  if (scenario === 'met') {
    return { ...base, state: 'met', reason: `Text present: ${present} of ${chapter.wordCount} words; every paragraph passes.`, evidence: [coverage], basis };
  }
  return {
    ...base,
    state: 'not_met',
    reason: `The end of the chapter: ${missing} words not read.`,
    evidence: [coverage, { kind: 'region', label: 'Tail not read', value: `${missing} words`, paragraphIds: [lastParagraph] }],
    basis,
  };
}

export function createStagesMock(deps: Deps): StagesApi {
  const recording = new Map(Object.entries(deps.seed?.recording ?? {}));
  const confirmations = new Map(
    (deps.seed?.confirmed ?? []).map((id) => [
      id,
      { from: 'recording' as ChapterStatus, target: 'editing' as ChapterStatus, basisKey: keyFor(id, 'editing', 'met'), at: MOCK_TIME },
    ]),
  );
  const dismissed = new Set((deps.seed?.dismissed ?? []).map((id) => keyFor(id, 'editing', 'met')));

  const scenarioOf = (chapter: ManuscriptChapter): StageRecordingScenario =>
    recording.get(chapter.id) ?? (chapter.recordedFraction === undefined ? { unknown: 'never_analyzed' } : chapter.recordedFraction >= 1 ? 'met' : 'not_met');

  /** The engine's verdict for the chapter's stage now (stages/engine.go). */
  const evaluate = (chapter: ManuscriptChapter, status: ChapterStatus): Evaluation => {
    const target = NEXT_STAGE[status];
    if (!target) return { verdict: 'none', noneReason: 'stage_not_evaluated', signals: [] };
    if (status !== 'recording') return { target, verdict: 'none', noneReason: 'no_required_signals', signals: [] };
    const scenario = scenarioOf(chapter);
    const state = scenarioState(scenario);
    const basisKey = keyFor(chapter.id, target, scenario);
    const verdict = state === 'met' ? (dismissed.has(basisKey) ? 'dismissed' : 'recommended') : state === 'not_met' ? 'not_ready' : 'unknown';
    return { target, verdict, basisKey, signals: [recordingSignal(chapter, scenario)] };
  };

  const assess = (chapter: ManuscriptChapter): StageChapterRecommendation => {
    const current = evaluate(chapter, chapter.status);
    const causes = current.signals.flatMap((signal) => (signal.cause ? [signal.cause] : []));
    const recommendation: StageChapterRecommendation = {
      chapterId: chapter.id,
      title: chapter.title,
      from: chapter.status,
      ...(current.target ? { target: current.target } : {}),
      verdict: current.verdict,
      ...(current.noneReason ? { noneReason: current.noneReason } : {}),
      signals: current.signals,
      causes,
      ...(current.basisKey ? { basisKey: current.basisKey } : {}),
    };
    const live = confirmations.get(chapter.id);
    if (!live || live.target !== chapter.status) return recommendation;
    const previous = evaluate(chapter, live.from);
    const notMet = previous.signals.filter((signal) => signal.state === 'not_met');
    return {
      ...recommendation,
      confirmation: { ...live, evidenceChanged: previous.basisKey !== live.basisKey },
      ...(notMet.length > 0 ? { contradiction: { revertTo: live.from, signals: notMet } } : {}),
    };
  };

  const find = async (chapterId: string) => {
    await deps.ready;
    const chapter = deps.chapters().find((item) => item.id === chapterId && narration(item));
    if (!chapter) throw new Error(`chapter ${chapterId} is not a narration chapter of the manuscript`);
    return chapter;
  };
  const refuse = (reason: StageRefusalReason): StageDecisionResult => ({ status: 'refused', reason, message: REFUSAL_MESSAGES[reason] });
  const ok = (chapterId: string) => find(chapterId).then((chapter): StageDecisionResult => ({ status: 'ok', chapter: assess(chapter) }));
  /** The host's check before Confirm or Dismiss: the suggestion the narrator acted on is still the one the evidence gives. */
  const actable = (chapter: ManuscriptChapter, target: ChapterStatus, basisKey: string) => {
    const current = assess(chapter);
    if (current.target !== target || current.basisKey !== basisKey) return refuse('basis_changed');
    if (current.verdict !== 'recommended' && current.verdict !== 'dismissed') return refuse('not_recommended');
    return current;
  };

  return {
    stageRecommendations: async (): Promise<StageRecommendations> => {
      await deps.ready;
      return { chapters: deps.chapters().filter(narration).map(assess) };
    },
    stageConfirm: async (chapterId, target, basisKey) => {
      const chapter = await find(chapterId);
      const current = actable(chapter, target, basisKey);
      if ('status' in current) return current;
      confirmations.set(chapterId, { from: chapter.status, target, basisKey, at: MOCK_TIME });
      deps.setStatus(chapterId, target);
      return ok(chapterId);
    },
    stageDismiss: async (chapterId, target, basisKey) => {
      const chapter = await find(chapterId);
      const current = actable(chapter, target, basisKey);
      if ('status' in current) return current;
      dismissed.add(basisKey);
      return ok(chapterId);
    },
    stageRevert: async (chapterId) => {
      const chapter = await find(chapterId);
      const live = confirmations.get(chapterId);
      if (!live || live.target !== chapter.status) return refuse('nothing_to_revert');
      confirmations.delete(chapterId);
      deps.setStatus(chapterId, live.from);
      return ok(chapterId);
    },
  };
}
