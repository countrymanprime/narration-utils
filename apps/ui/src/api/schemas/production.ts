import { z } from 'zod';
import type {
  ProductionChapter,
  ProductionMilestone,
  ProductionNextUpItem,
  ProductionOverview,
  ProductionPlan,
  ProductionReadiness,
  ProductionSession,
  ProductionStartResult,
  ProductionStopResult,
} from '../contracts/production';
import { listFromNull, optionalFromNull } from './base';

// The production tracking payloads (apps/desktop/bindings_production.go, apps/desktop/internal/production: plan.go's Plan and
// overview.go's Overview), pinned against the host by tests/fixtures/contracts/production-*.json, which Go tests write.

const calendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const productionMilestoneSchema = z.object({
  name: z.string(),
  dueDate: calendarDate,
  note: z.string().optional(),
}) satisfies z.ZodType<ProductionMilestone>;

export const productionPlanSchema = z.object({
  deadline: calendarDate.nullable(),
  contractedAmount: z.number().nonnegative().nullable(),
  milestones: listFromNull(productionMilestoneSchema),
}) satisfies z.ZodType<ProductionPlan>;

const stageSchema = z.enum(['not_started', 'recording', 'editing', 'proofing', 'finalized']);

const productionSessionSchema = z.object({
  id: z.string(),
  chapterId: z.string(),
  stage: stageSchema,
  startedAt: z.string(),
  endedAt: optionalFromNull(z.string()),
  source: z.string(),
}) satisfies z.ZodType<ProductionSession>;

const readinessSchema = z.object({
  verdict: z.enum(['recommended', 'not_ready', 'unknown', 'dismissed', 'none']),
  target: optionalFromNull(stageSchema),
  reason: z.string(),
}) satisfies z.ZodType<ProductionReadiness>;

const chapterSchema = z.object({
  id: z.string(),
  title: z.string(),
  subtitle: optionalFromNull(z.string()),
  contentKind: z.enum(['narration', 'opening', 'reference', '']),
  status: stageSchema,
  wordCount: z.number(),
  recordedSeconds: z.number().nullable(),
  recordedUnavailable: optionalFromNull(z.enum(['unlinked', 'multiple_tracks', 'track_missing', 'no_project'])),
  hoursLogged: z.number(),
  pfh: z.number().nullable(),
  readiness: readinessSchema.nullable(),
}) satisfies z.ZodType<ProductionChapter>;

const nextUpSchema = z.object({
  chapterId: z.string(),
  title: z.string(),
  subtitle: optionalFromNull(z.string()),
  stage: stageSchema,
  readiness: readinessSchema.nullable(),
}) satisfies z.ZodType<ProductionNextUpItem>;

export const productionOverviewSchema = z.object({
  chapters: listFromNull(chapterSchema),
  totals: z.object({
    chapters: z.number(),
    finalizedChapters: z.number(),
    wordCount: z.number(),
    recordedSeconds: z.number(),
    measuredChapters: z.number(),
    hoursLogged: z.number(),
    hoursByStage: z.partialRecord(stageSchema, z.number()),
    bookPfh: z.number().nullable(),
    contractedAmount: z.number().nullable(),
    effectiveRate: z.number().nullable(),
  }),
  deadline: z.object({ date: calendarDate, daysLeft: z.number() }).nullable(),
  running: productionSessionSchema.nullable(),
  nextUp: listFromNull(nextUpSchema),
}) satisfies z.ZodType<ProductionOverview>;

export const productionStartResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('started'), session: productionSessionSchema }),
  z.object({ status: z.literal('refused'), reason: z.literal('timer_running'), message: z.string() }),
]) satisfies z.ZodType<ProductionStartResult>;

export const productionStopResultSchema = z.union([
  z.object({ stopped: z.literal(true), session: productionSessionSchema }),
  z.object({ stopped: z.literal(false), session: z.null() }),
]) satisfies z.ZodType<ProductionStopResult>;
