// The production tracking mock (production-tracking.prd.md Phase 4): the same arithmetic and "Next up" order as the host
// (apps/desktop/internal/production/overview.go, ADR 0404) over the mock's own chapters and stage recommendations, so the
// Production page's board agrees with Home and the stage suggestions. `?mockProduction=on-pace|at-risk` seeds a time log, a
// deadline and a contracted amount (the Phase 3 fields the host does not fill yet); with no seed nothing is logged or set,
// which is what a narrator sees first.
import type { ChapterStatus, ManuscriptChapter } from './contracts/manuscript';
import type {
  ProductionApi,
  ProductionChapter,
  ProductionDeadline,
  ProductionNextUpItem,
  ProductionOverview,
  ProductionReadiness,
  ProductionSession,
} from './contracts/production';
import type { StageRecommendations } from './contracts/stages';

export type ProductionSeed = 'on-pace' | 'at-risk';

type Deps = {
  chapters: () => Promise<ManuscriptChapter[]>;
  recommendations: () => Promise<StageRecommendations>;
  seed?: ProductionSeed;
};

type Plan = { deadline: ProductionDeadline | null; contractedAmount: number | null };

const MOCK_TIME = '2026-09-21T10:00:00Z';
const NEXT_UP_LIMIT = 5;
const TIMEABLE: readonly ChapterStatus[] = ['not_started', 'recording', 'editing', 'proofing', 'finalized'];
const STAGE_ORDER: Partial<Record<ChapterStatus, number>> = { not_started: 0, recording: 1, editing: 2, proofing: 3 };

// Measured seconds of each seeded chapter's confirmed track: finished chapters in full, chapters 4 and 5 part-way, 6, 11 and 12 not
// linked. Invented sample data, like every mock fixture.
const SEED_RECORDED: Record<string, number> = {
  'chapter-1': 708,
  'chapter-2': 725,
  'chapter-3': 631,
  'chapter-4': 512,
  'chapter-5': 311,
  'chapter-7': 760,
  'chapter-8': 742,
  'chapter-9': 682,
  'chapter-10': 802,
};

// Hours per stage logged on each seeded chapter.
const SEED_HOURS: Record<string, Partial<Record<ChapterStatus, number>>> = {
  'chapter-1': { recording: 1.5, editing: 1, proofing: 0.5 },
  'chapter-2': { recording: 1.5, editing: 1.25, proofing: 0.5 },
  'chapter-3': { recording: 1.25, editing: 1, proofing: 0.5 },
  'chapter-4': { recording: 1 },
  'chapter-5': { recording: 0.75 },
  'chapter-7': { recording: 1.5, editing: 0.75 },
  'chapter-8': { recording: 1.5, editing: 0.5 },
  'chapter-9': { recording: 1.25, editing: 1, proofing: 0.25 },
  'chapter-10': { recording: 1.5, editing: 1 },
};

const SEEDS: Record<ProductionSeed, { plan: Plan; hoursScale: number; running: boolean }> = {
  'on-pace': { plan: { deadline: { date: '2026-10-14', daysLeft: 18 }, contractedAmount: 2400 }, hoursScale: 1, running: true },
  'at-risk': { plan: { deadline: { date: '2026-09-30', daysLeft: 3 }, contractedAmount: 2400 }, hoursScale: 1.6, running: false },
};

function seededSessions(scale: number): ProductionSession[] {
  const sessions: ProductionSession[] = [];
  let start = Date.parse('2026-09-01T09:00:00Z');
  for (const [chapterId, hours] of Object.entries(SEED_HOURS)) {
    for (const stage of TIMEABLE) {
      const length = hours[stage];
      if (length === undefined) continue;
      const end = start + length * scale * 3_600_000;
      sessions.push({
        id: `mock-${sessions.length + 1}`,
        chapterId,
        stage,
        startedAt: new Date(start).toISOString(),
        endedAt: new Date(end).toISOString(),
        source: 'manual',
      });
      start = end + 3_600_000;
    }
  }
  return sessions;
}

const hoursOf = (session: ProductionSession) =>
  session.endedAt === undefined ? 0 : Math.max(0, Date.parse(session.endedAt) - Date.parse(session.startedAt)) / 3_600_000;

const perFinishedHour = (hours: number, seconds: number) => (hours > 0 && seconds > 0 ? hours / (seconds / 3600) : null);

function readinessOf(recommendation: StageRecommendations['chapters'][number]): ProductionReadiness {
  const held = recommendation.signals.find((signal) => signal.state === 'not_met') ?? recommendation.signals.find((signal) => signal.state === 'unknown');
  return { verdict: recommendation.verdict, ...(recommendation.target ? { target: recommendation.target } : {}), reason: held?.reason ?? '' };
}

// The host's riskGroup (overview.go): held back first, then cannot be told, then ready to move on, then not started.
function riskGroup(chapter: ProductionChapter): number {
  if (chapter.status === 'not_started') return 3;
  if (chapter.readiness?.verdict === 'not_ready') return 0;
  if (chapter.readiness?.verdict === 'recommended') return 2;
  return 1;
}

function nextUp(chapters: ProductionChapter[]): ProductionNextUpItem[] {
  return chapters
    .map((chapter, order) => ({ chapter, order, stage: STAGE_ORDER[chapter.status] }))
    .filter(({ chapter, stage }) => stage !== undefined && (chapter.contentKind === '' || chapter.contentKind === 'narration'))
    .sort((a, b) => riskGroup(a.chapter) - riskGroup(b.chapter) || (a.stage ?? 0) - (b.stage ?? 0) || a.order - b.order)
    .slice(0, NEXT_UP_LIMIT)
    .map(({ chapter }) => ({
      chapterId: chapter.id,
      title: chapter.title,
      ...(chapter.subtitle ? { subtitle: chapter.subtitle } : {}),
      stage: chapter.status,
      readiness: chapter.readiness,
    }));
}

export function createProductionMock(deps: Deps): ProductionApi {
  const seed = deps.seed ? SEEDS[deps.seed] : undefined;
  const plan: Plan = seed?.plan ?? { deadline: null, contractedAmount: null };
  const sessions: ProductionSession[] = seed ? seededSessions(seed.hoursScale) : [];
  if (seed?.running) sessions.push({ id: 'mock-running', chapterId: 'chapter-6', stage: 'recording', startedAt: MOCK_TIME, source: 'manual' });
  const running = () => sessions.find((session) => session.endedAt === undefined) ?? null;

  const overview = async (): Promise<ProductionOverview> => {
    const [manuscript, recommendations] = await Promise.all([deps.chapters(), deps.recommendations()]);
    const readiness = new Map(recommendations.chapters.map((chapter) => [chapter.chapterId, readinessOf(chapter)]));
    const chapters: ProductionChapter[] = manuscript.map((chapter) => {
      const measured = seed ? SEED_RECORDED[chapter.id] : chapter.recordedSeconds;
      const hoursLogged = sessions.filter((session) => session.chapterId === chapter.id).reduce((sum, session) => sum + hoursOf(session), 0);
      return {
        id: chapter.id,
        title: chapter.title,
        ...(chapter.subtitle ? { subtitle: chapter.subtitle } : {}),
        contentKind: chapter.contentKind ?? '',
        status: chapter.status,
        wordCount: chapter.wordCount,
        recordedSeconds: measured ?? null,
        ...(measured === undefined ? { recordedUnavailable: chapter.recordedUnavailable ?? 'unlinked' } : {}),
        hoursLogged,
        pfh: measured === undefined ? null : perFinishedHour(hoursLogged, measured),
        readiness: readiness.get(chapter.id) ?? null,
      };
    });
    const hoursLogged = sessions.reduce((sum, session) => sum + hoursOf(session), 0);
    const recordedSeconds = chapters.reduce((sum, chapter) => sum + (chapter.recordedSeconds ?? 0), 0);
    const hoursByStage: Partial<Record<ChapterStatus, number>> = {};
    for (const session of sessions) {
      if (session.endedAt !== undefined) hoursByStage[session.stage] = (hoursByStage[session.stage] ?? 0) + hoursOf(session);
    }
    return {
      chapters,
      totals: {
        chapters: chapters.length,
        finalizedChapters: chapters.filter((chapter) => chapter.status === 'finalized').length,
        wordCount: chapters.reduce((sum, chapter) => sum + chapter.wordCount, 0),
        recordedSeconds,
        measuredChapters: chapters.filter((chapter) => chapter.recordedSeconds !== null).length,
        hoursLogged,
        hoursByStage,
        bookPfh: perFinishedHour(hoursLogged, recordedSeconds),
        contractedAmount: plan.contractedAmount,
        effectiveRate: plan.contractedAmount !== null && hoursLogged > 0 ? plan.contractedAmount / hoursLogged : null,
      },
      deadline: plan.deadline,
      running: running(),
      nextUp: nextUp(chapters),
    };
  };

  return {
    productionOverview: overview,
    productionStartTimer: async (chapterId, stage) => {
      const chapters = await deps.chapters();
      if (!chapters.some((chapter) => chapter.id === chapterId)) throw new Error(`the manuscript has no chapter "${chapterId}"`);
      if (!TIMEABLE.includes(stage)) throw new Error(`"${stage}" is not a chapter stage`);
      const current = running();
      if (current) {
        return { status: 'refused', reason: 'timer_running', message: `a timer is already running on ${current.chapterId} (${current.stage}); stop it first` };
      }
      const session: ProductionSession = { id: `mock-${sessions.length + 1}`, chapterId, stage, startedAt: MOCK_TIME, source: 'manual' };
      sessions.push(session);
      return { status: 'started', session: { ...session } };
    },
    productionStopTimer: async () => {
      const current = running();
      if (!current) return { stopped: false, session: null };
      current.endedAt = MOCK_TIME;
      return { stopped: true, session: { ...current } };
    },
  };
}
