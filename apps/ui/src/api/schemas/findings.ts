import { z } from 'zod';
import type {
  Finding,
  FindingChapterFacet,
  FindingManuscript,
  FindingProject,
  FindingReviewState,
  FindingSource,
  FindingSpan,
  FindingSuggestedAction,
  FindingTimeRange,
  FindingsPage,
  FindingsSummary,
} from '../contracts/findings';
import { listFromNull } from './base';

const findingProjectSchema = z.object({
  path: z.string().optional(),
  output_path: z.string().optional(),
}) satisfies z.ZodType<FindingProject>;

const findingSourceSchema = z.object({
  file: z.string().optional(),
  track_guid: z.string().optional(),
  item_guid: z.string().optional(),
  take_guid: z.string().optional(),
}) satisfies z.ZodType<FindingSource>;

const findingTimeRangeSchema = z.object({
  start: z.number(),
  end: z.number(),
  source_start: z.number().optional(),
  source_end: z.number().optional(),
}) satisfies z.ZodType<FindingTimeRange>;

const findingSpanSchema = z.object({
  paragraph_id: z.string().optional(),
  start: z.number().optional(),
  end: z.number().optional(),
  ordinal: z.number().optional(),
}) satisfies z.ZodType<FindingSpan>;

const findingManuscriptSchema = z.object({
  chapter_id: z.string().optional(),
  chapter_title: z.string().optional(),
  expected: z.string().optional(),
  recorded: z.string().optional(),
  span: findingSpanSchema.optional(),
}) satisfies z.ZodType<FindingManuscript>;

const findingSuggestedActionSchema = z.object({
  kind: z.string(),
  parameters: z.record(z.string(), z.unknown()).optional(),
  requires_confirmation: z.boolean(),
}) satisfies z.ZodType<FindingSuggestedAction>;

const findingReviewStatusSchema = z.enum(['unreviewed', 'accepted', 'dismissed', 'deferred']);

const findingReviewStateSchema = z.object({
  status: findingReviewStatusSchema,
  note: z.string().optional(),
  timestamp: z.string().optional(),
}) satisfies z.ZodType<FindingReviewState>;

export const findingSchema = z.object({
  schema_version: z.number(),
  id: z.string(),
  analyzer: z.string(),
  project: findingProjectSchema,
  source: findingSourceSchema,
  time_range: findingTimeRangeSchema.optional(),
  manuscript: findingManuscriptSchema.optional(),
  category: z.string(),
  severity: z.enum(['info', 'warning', 'error']),
  confidence: z.number().nullable(),
  confidence_reason: z.string(),
  evidence_version: z.string().optional(),
  evidence: z.record(z.string(), z.unknown()).optional(),
  suggested_action: findingSuggestedActionSchema.optional(),
  review: findingReviewStateSchema,
  not_in_latest_run: z.boolean().optional(),
}) satisfies z.ZodType<Finding>;

export const findingsPageSchema = z.object({
  findings: listFromNull(findingSchema),
  total: z.number(),
}) satisfies z.ZodType<FindingsPage>;

const findingChapterFacetSchema = z.object({
  id: z.string(),
  title: z.string().optional(),
}) satisfies z.ZodType<FindingChapterFacet>;

export const findingsSummarySchema = z.object({
  total: z.number(),
  unreviewed: z.number(),
  accepted: z.number(),
  dismissed: z.number(),
  deferred: z.number(),
  notInLatestRun: z.number(),
  analyzers: listFromNull(z.string()),
  categories: listFromNull(z.string()),
  chapters: listFromNull(findingChapterFacetSchema),
}) satisfies z.ZodType<FindingsSummary>;
