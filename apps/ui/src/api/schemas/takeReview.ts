import { z } from 'zod';
import type {
  TakeAudioReport,
  TakeComparisonEvidence,
  TakeComparisonJob,
  TakeComparisonMember,
  TakeMetrics,
  TakeReviewCreateTakeResult,
  TakeReviewEvidence,
  TakeReviewMember,
  TakeReviewScanJob,
  TakeReviewScanScope,
} from '../contracts/takeReview';
import { listFromNull } from './base';

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

/**
 * A take-review finding's `evidence`. The findings contract types evidence as an open record, so the Review page checks it
 * against this before it shows or acts on a finding's reads: a finding whose evidence does not match is shown with the
 * generic evidence only, never cast.
 */
export const takeReviewEvidenceSchema = z.object({
  kind: z.string(),
  matched_span_first: z.number(),
  matched_span_last: z.number(),
  members: listFromNull(takeReviewMemberSchema),
}) satisfies z.ZodType<TakeReviewEvidence>;

const takeReviewScanScopeSchema = z.object({
  chapterTrackName: z.string(),
  pickupTrackName: z.string().optional(),
  pickupRangeStart: z.number().optional(),
  pickupRangeEnd: z.number().optional(),
}) satisfies z.ZodType<TakeReviewScanScope>;

export const takeReviewScanJobSchema = z.object({
  id: z.string().nullable(),
  kind: z.literal('take_review'),
  phase: z.enum(['idle', 'running', 'success', 'cancelled', 'error']),
  message: z.string(),
  percent: z.number(),
  logs: listFromNull(z.string()),
  elapsed: z.number(),
  error: z.string().optional(),
  scope: takeReviewScanScopeSchema,
  found: z.number(),
}) satisfies z.ZodType<TakeReviewScanJob>;

export const takeReviewCreateTakeResultSchema = z.object({
  targetItemGuid: z.string(),
  newTakeGuid: z.string(),
}) satisfies z.ZodType<TakeReviewCreateTakeResult>;

// Take comparison (take review Phase 10). A comparison is a `take_comparison` finding; the Review page checks its evidence
// against takeComparisonEvidenceSchema before it shows a single figure, so a mismatch is shown as the generic evidence only.

const metricStatus = { status: z.enum(['measured', 'unavailable']), reason: z.string().optional() };
const nullableNumber = z.number().nullable();

const rangeSchema = z.object({ start_seconds: z.number(), length_seconds: z.number() });
const clipRunSchema = z.object({ channel: z.number(), start_seconds: z.number(), duration_seconds: z.number(), samples: z.number() });

const takeAudioReportSchema = z.object({
  file: z.string().optional(),
  sample_rate: z.number(),
  channels: z.number(),
  duration_seconds: z.number(),
  integrated_lufs: nullableNumber,
  rms_dbfs: nullableNumber,
  sample_peak_dbfs: nullableNumber,
  true_peak_dbtp: nullableNumber,
  noise_floor_dbfs: nullableNumber,
  digital_silent_windows: z.number(),
  full_scale_samples: z.number(),
  clip_run_count: z.number(),
  clip_runs: listFromNull(clipRunSchema),
  range: rangeSchema.optional(),
}) satisfies z.ZodType<TakeAudioReport>;

const takeMetricsSchema = z.object({
  take_guid: z.string(),
  take_index: z.number(),
  source: z.object({ file: z.string(), kind: z.string(), range: rangeSchema }).nullable(),
  audio: takeAudioReportSchema.nullable(),
  clipping: z.object({ ...metricStatus, full_scale_samples: nullableNumber, clip_run_count: nullableNumber, clip_runs: listFromNull(clipRunSchema) }),
  noise: z.object({ ...metricStatus, noise_floor_dbfs: nullableNumber, digital_silent_windows: nullableNumber }),
  level_consistency: z.object({
    ...metricStatus,
    integrated_lufs: nullableNumber,
    neighbor_median_lufs: nullableNumber,
    delta_lu: nullableNumber,
    neighbors_measured: z.number(),
    neighbors_unavailable: z.number(),
  }),
  duration: z.object({
    ...metricStatus,
    item_seconds: nullableNumber,
    source_seconds: nullableNumber,
    audio_seconds: nullableNumber,
    speech_seconds: nullableNumber,
    words_per_minute: nullableNumber,
  }),
  pause_profile: z.object({
    ...metricStatus,
    min_pause_seconds: z.number(),
    long_pause_seconds: z.number(),
    count: z.number().optional(),
    total_seconds: z.number().optional(),
    longest_seconds: z.number().optional(),
    median_seconds: z.number().optional(),
    long_pauses: z.array(z.object({ start_seconds: z.number(), duration_seconds: z.number() })).optional(),
    leading_seconds: z.number().optional(),
    trailing_seconds: nullableNumber.optional(),
  }),
  coverage: z.object({ measured: z.number(), total: z.number(), unavailable: listFromNull(z.string()) }),
}) satisfies z.ZodType<TakeMetrics>;

const takeComparisonMemberSchema = z.object({
  item_guid: z.string(),
  take_guid: z.string(),
  source_file: z.string(),
  source_start: z.number(),
  source_length: z.number(),
  compared: z.boolean(),
  not_compared_reason: z.string().optional(),
  fidelity: nullableNumber,
  counts: z.object({ matched: z.number(), misread: z.number(), skipped: z.number(), unread: z.number(), extra_words: z.number() }).nullable(),
  words: listFromNull(z.object({ index: z.number(), status: z.enum(['matched', 'misread', 'skipped', 'unread']), start: nullableNumber, end: nullableNumber })),
  divergences: listFromNull(
    z.object({
      kind: z.string(),
      position: z.string(),
      first_word: nullableNumber,
      last_word: nullableNumber,
      manuscript_text: z.string(),
      audio_text: z.string(),
      start: nullableNumber,
      end: nullableNumber,
    }),
  ),
  metrics: takeMetricsSchema.nullable(),
}) satisfies z.ZodType<TakeComparisonMember>;

export const takeComparisonEvidenceSchema = z.object({
  source_finding_id: z.string(),
  span: z.object({
    first_unit: z.number(),
    last_unit: z.number(),
    words: listFromNull(z.object({ index: z.number(), text: z.string(), unit: z.number(), paragraph: z.number() })),
  }),
  model: z.string(),
  compared: z.number(),
  members: listFromNull(takeComparisonMemberSchema),
}) satisfies z.ZodType<TakeComparisonEvidence>;

export const takeComparisonJobSchema = z.object({
  id: z.string().nullable(),
  kind: z.literal('take_comparison'),
  phase: z.enum(['idle', 'running', 'success', 'cancelled', 'error']),
  message: z.string(),
  percent: z.number(),
  logs: listFromNull(z.string()),
  elapsed: z.number(),
  error: z.string().optional(),
  findingId: z.string(),
  comparisonId: z.string().optional(),
}) satisfies z.ZodType<TakeComparisonJob>;
