import { z } from 'zod';
import type {
  StageChapterRecommendation,
  StageDecisionResult,
  StageRecommendations,
  StageRefusalReason,
  StageSignal,
  StageUnknownCause,
} from '../contracts/stages';
import { listFromNull, optionalFromNull } from './base';

// The chapter stage recommendation payloads (apps/desktop/bindings_stages.go, apps/desktop/internal/stages). The cause list is
// pinned against the host by tests/fixtures/contracts/stages-causes.json, which a Go test writes from the stages package.

export const STAGE_UNKNOWN_CAUSES = [
  'analysis_running',
  'incomplete_run',
  'measurement_unavailable',
  'multiple_tracks',
  'never_analyzed',
  'project_unreadable',
  'provider_error',
  'stale',
  'unconfirmed_mapping',
  'unmapped_track',
] as const satisfies readonly StageUnknownCause[];

export const STAGE_REFUSAL_REASONS = ['basis_changed', 'not_recommended', 'nothing_to_revert'] as const satisfies readonly StageRefusalReason[];

const stageSchema = z.enum(['not_started', 'recording', 'editing', 'proofing', 'finalized']);
const causeSchema = z.enum(STAGE_UNKNOWN_CAUSES);

const evidenceSchema = z.object({
  kind: z.string(),
  label: z.string(),
  value: z.string(),
  file: optionalFromNull(z.string()),
  range: optionalFromNull(z.object({ start: z.number(), end: z.number() })),
  paragraphIds: optionalFromNull(z.array(z.string())),
  findingId: optionalFromNull(z.string()),
});

const stageSignalSchema = z.object({
  id: z.string(),
  stage: stageSchema,
  state: z.enum(['met', 'not_met', 'unknown']),
  reason: z.string(),
  cause: optionalFromNull(causeSchema),
  evidence: listFromNull(evidenceSchema),
  basis: z.object({ ledgerRecordIds: listFromNull(z.string()), fingerprint: z.string(), projectFileModTime: z.string() }),
  computedAt: z.string(),
}) satisfies z.ZodType<StageSignal>;

const stageChapterRecommendationSchema = z.object({
  chapterId: z.string(),
  title: z.string(),
  from: stageSchema,
  target: optionalFromNull(stageSchema),
  verdict: z.enum(['recommended', 'not_ready', 'unknown', 'dismissed', 'none']),
  noneReason: optionalFromNull(z.enum(['stage_not_evaluated', 'no_required_signals'])),
  signals: listFromNull(stageSignalSchema),
  causes: listFromNull(causeSchema),
  basisKey: optionalFromNull(z.string()),
  confirmation: optionalFromNull(z.object({ from: stageSchema, target: stageSchema, basisKey: z.string(), at: z.string(), evidenceChanged: z.boolean() })),
  contradiction: optionalFromNull(z.object({ revertTo: stageSchema, signals: listFromNull(stageSignalSchema) })),
}) satisfies z.ZodType<StageChapterRecommendation>;

export const stageRecommendationsSchema = z.object({
  chapters: listFromNull(stageChapterRecommendationSchema),
}) satisfies z.ZodType<StageRecommendations>;

export const stageDecisionResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('ok'), chapter: stageChapterRecommendationSchema }),
  z.object({ status: z.literal('refused'), reason: z.enum(STAGE_REFUSAL_REASONS), message: z.string() }),
]) satisfies z.ZodType<StageDecisionResult>;
