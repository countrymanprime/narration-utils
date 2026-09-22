import { z } from 'zod';
import type {
  TakeReviewEvidence,
  TakeReviewFinding,
  TakeReviewManuscript,
  TakeReviewMember,
  TakeReviewProject,
  TakeReviewReviewState,
  TakeReviewSource,
  TakeReviewSpan,
  TakeReviewSuggestedAction,
  TakeReviewTimeRange,
} from '../contracts/takeReview';
import { listFromNull } from './base';

const takeReviewProjectSchema = z.object({
  path: z.string(),
  output_path: z.string().optional(),
}) satisfies z.ZodType<TakeReviewProject>;

const takeReviewSourceSchema = z.object({
  file: z.string(),
  track_guid: z.string().optional(),
  item_guid: z.string().optional(),
  take_guid: z.string().optional(),
}) satisfies z.ZodType<TakeReviewSource>;

const takeReviewTimeRangeSchema = z.object({
  start: z.number(),
  end: z.number(),
  source_start: z.number().optional(),
  source_end: z.number().optional(),
}) satisfies z.ZodType<TakeReviewTimeRange>;

const takeReviewSpanSchema = z.object({
  paragraph_id: z.string().optional(),
  start: z.number().optional(),
  end: z.number().optional(),
  ordinal: z.number().optional(),
}) satisfies z.ZodType<TakeReviewSpan>;

const takeReviewManuscriptSchema = z.object({
  chapter_id: z.string().optional(),
  chapter_title: z.string().optional(),
  expected: z.string().optional(),
  recorded: z.string().optional(),
  span: takeReviewSpanSchema.optional(),
}) satisfies z.ZodType<TakeReviewManuscript>;

const takeReviewMemberSchema = z.object({
  item_index: z.number(),
  item_guid: z.string(),
  take_guid: z.string(),
  source_file: z.string(),
  source_start: z.number(),
  source_length: z.number(),
  coverage: z.number(),
  quality: z.number(),
  exact_copy_group: z.string(),
}) satisfies z.ZodType<TakeReviewMember>;

const takeReviewEvidenceSchema = z.object({
  kind: z.string(),
  matched_span_first: z.number(),
  matched_span_last: z.number(),
  members: listFromNull(takeReviewMemberSchema),
}) satisfies z.ZodType<TakeReviewEvidence>;

const takeReviewSuggestedActionSchema = z.object({
  kind: z.string(),
  parameters: z.record(z.string(), z.unknown()).optional(),
  requires_confirmation: z.boolean(),
}) satisfies z.ZodType<TakeReviewSuggestedAction>;

const takeReviewReviewStateSchema = z.object({
  status: z.string(),
  note: z.string().optional(),
  timestamp: z.string().optional(),
}) satisfies z.ZodType<TakeReviewReviewState>;

export const takeReviewFindingSchema = z.object({
  schema_version: z.number(),
  id: z.string(),
  analyzer: z.string(),
  project: takeReviewProjectSchema,
  source: takeReviewSourceSchema,
  time_range: takeReviewTimeRangeSchema.optional(),
  manuscript: takeReviewManuscriptSchema.optional(),
  category: z.string(),
  severity: z.string(),
  confidence: z.number().nullable(),
  evidence_version: z.string().optional(),
  confidence_reason: z.string(),
  evidence: takeReviewEvidenceSchema.optional(),
  suggested_action: takeReviewSuggestedActionSchema.optional(),
  review: takeReviewReviewStateSchema,
  not_in_latest_run: z.boolean().optional(),
}) satisfies z.ZodType<TakeReviewFinding>;

export const takeReviewFindingsSchema = listFromNull(takeReviewFindingSchema);
