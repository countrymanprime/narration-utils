import { z } from 'zod';
import type {
  CoverageEvaluatorReason,
  CoverageItem,
  CoverageRefusalReason,
  CoverageRegion,
  CoverageReport,
  CoverageResult,
  CoverageStartResult,
  CoverageState,
} from '../contracts/coverage';
import { listFromNull, optionalFromNull } from './base';
import { modelAssetRequiredSchema } from './whisper';

// The recording coverage payloads (docs/utilities/recording-coverage.md, ADR 0129). The reason lists are pinned
// against the host by tests/fixtures/contracts/coverage-reasons.json, which a Go test writes from coverage.RefusalReasons.

export const COVERAGE_REFUSAL_REASONS = [
  'no_project',
  'no_project_file',
  'project_unreadable',
  'no_manuscript',
  'chapter_not_found',
  'not_narration',
  'unmapped',
  'multiple_tracks',
  'mapped_track_missing',
  'no_items',
  'unsupported_item',
  'source_missing',
  'item_unreadable',
  'busy',
  'sidecar_missing',
  'invalid_params',
  'manuscript_changed',
  'result_missing',
] as const satisfies readonly CoverageRefusalReason[];

export const COVERAGE_EVALUATOR_REASONS = [
  'item_added',
  'item_removed',
  'item_trimmed',
  'item_moved',
  'item_muted',
  'take_switched',
  'source_changed',
  'analyzer_changed',
  'params_changed',
  'mapping_changed',
  'mapped_track_missing',
  'project_unreadable',
] as const satisfies readonly CoverageEvaluatorReason[];

const refusalReasonSchema = z.enum(COVERAGE_REFUSAL_REASONS);
const reasonSchema = z.union([refusalReasonSchema, z.enum(COVERAGE_EVALUATOR_REASONS)]);

export const coverageStateSchema = z.object({
  runId: z.string().optional(),
  chapterId: z.string().optional(),
  phase: z.enum(['idle', 'running', 'complete', 'cancelled', 'failed']),
  percent: z.number().min(0).max(100),
  stage: z.string().optional(),
  message: z.string(),
  recordId: z.string().optional(),
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
}) satisfies z.ZodType<CoverageState>;

export const coverageStartResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('started'), state: coverageStateSchema }),
  z.object({ status: z.literal('refused'), reason: refusalReasonSchema, message: z.string() }),
  modelAssetRequiredSchema,
]) satisfies z.ZodType<CoverageStartResult>;

const itemSchema = z.object({
  index: z.number(),
  itemGuid: z.string(),
  status: z.enum(['analyzed', 'muted']),
  words: optionalFromNull(z.enum(['transcribed', 'reused'])),
  playedSeconds: z.number(),
  wordCount: z.number(),
  model: optionalFromNull(z.string()),
  language: optionalFromNull(z.string()),
}) satisfies z.ZodType<CoverageItem>;

const regionSchema = z.object({
  kind: z.enum(['head', 'tail', 'skip', 'short_read', 'different_text']),
  paragraphIds: listFromNull(z.string()),
  tokenCount: z.number(),
  firstWord: z.string(),
  lastWord: z.string(),
  position: optionalFromNull(z.object({ itemIndex: z.number(), itemGuid: z.string(), sourceTime: z.number() })),
}) satisfies z.ZodType<CoverageRegion>;

const reportSchema = z.object({
  model: z.string(),
  language: z.string().optional(),
  alignment: z.object({ maxMisreadRun: z.number(), minAnchorRun: z.number() }),
  bodyTokens: z.number(),
  presentTokens: z.number(),
  missingTokens: z.number(),
  extraTokens: z.number(),
  longestMissingRun: z.number(),
  playedSeconds: z.number(),
  items: listFromNull(itemSchema),
  paragraphs: listFromNull(z.object({ id: z.string(), tokens: z.number(), present: z.number(), longestMissingRun: z.number() })),
  regions: listFromNull(regionSchema),
}) satisfies z.ZodType<CoverageReport>;

export const coverageResultSchema = z.object({
  chapterId: z.string(),
  state: z.enum(['current', 'stale', 'never']),
  reasons: listFromNull(reasonSchema),
  basis: z.object({ label: z.string(), modifiedAt: z.string(), stale: z.boolean() }).optional(),
  record: z.object({ id: z.string(), outcome: z.enum(['complete', 'partial', 'failed']), startedAt: z.string(), completedAt: z.string() }).optional(),
  result: reportSchema.optional(),
  recordedFraction: z.number().min(0).max(1).optional(),
}) satisfies z.ZodType<CoverageResult>;
