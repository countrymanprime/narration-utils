import { z } from 'zod';
import type {
  DeliveryReportExport,
  MeasureClipRun,
  MeasureFingerprint,
  MeasureJob,
  MeasureMP3,
  MeasurePickResult,
  MeasureRange,
  MeasureReport,
} from '../contracts/measure';
import { listFromNull } from './base';
import { deliveryProfileSchema, deliveryRuleResultSchema } from './deliveryProfiles';
import { findingSchema } from './findings';

const nullableNumber = z.number().nullable();

export const measureRangeSchema = z.object({ start_seconds: z.number(), length_seconds: z.number() }) satisfies z.ZodType<MeasureRange>;

export const measureClipRunSchema = z.object({
  channel: z.number(),
  start_seconds: z.number(),
  duration_seconds: z.number(),
  samples: z.number(),
}) satisfies z.ZodType<MeasureClipRun>;

const measureMP3Schema = z.object({
  version: z.string(),
  layer: z.number(),
  bitrate_kbps: z.number(),
  average_bitrate_kbps: z.number(),
  cbr: z.boolean(),
  vbr_tag: z.string(),
  sample_rate: z.number(),
  channel_mode: z.enum(['stereo', 'joint_stereo', 'dual_channel', 'mono']),
  frames: z.number(),
  duration_seconds: z.number(),
  id3v2_bytes: z.number(),
  lost_bytes: z.number(),
}) satisfies z.ZodType<MeasureMP3>;

export const measureReportSchema = z.object({
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
  head_room_tone_seconds: nullableNumber,
  tail_room_tone_seconds: nullableNumber,
  head_digital_silence_seconds: nullableNumber,
  tail_digital_silence_seconds: nullableNumber,
  full_scale_samples: z.number(),
  clip_run_count: z.number(),
  clip_runs: listFromNull(measureClipRunSchema),
  mp3: measureMP3Schema.optional(),
  range: measureRangeSchema.optional(),
}) satisfies z.ZodType<MeasureReport>;

const measureFingerprintSchema = z.object({
  size_bytes: z.number(),
  modified_at: z.string(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
}) satisfies z.ZodType<MeasureFingerprint>;

const measureFileResultSchema = z.object({
  path: z.string(),
  name: z.string(),
  status: z.enum(['pending', 'measuring', 'measured', 'failed', 'cancelled']),
  report: measureReportSchema.nullable(),
  fingerprint: measureFingerprintSchema.nullable(),
  findings: listFromNull(findingSchema),
  rules: listFromNull(deliveryRuleResultSchema),
  error: z.string().optional(),
});

export const measureJobSchema = z.object({
  id: z.string().nullable(),
  kind: z.literal('measurement'),
  phase: z.enum(['idle', 'running', 'success', 'cancelled', 'error']),
  message: z.string(),
  percent: z.number(),
  logs: listFromNull(z.string()),
  elapsed: z.number(),
  error: z.string().optional(),
  files: listFromNull(measureFileResultSchema),
  profile: deliveryProfileSchema.nullable(),
  bookRules: listFromNull(deliveryRuleResultSchema),
  profileNotice: z.string().optional(),
}) satisfies z.ZodType<MeasureJob>;

export const measurePickResultSchema = z.object({ paths: listFromNull(z.string()) }) satisfies z.ZodType<MeasurePickResult>;

/**
 * The evidence of the host's delivery_qc finding (deliveryprofile.EvaluateFile, ADR 0179): the rule and profile, the metric,
 * and how and against which bound it missed.
 */
export const deliveryQcEvidenceSchema = z.object({
  metric: z.string(),
  rule: z.string(),
  profile: z.string(),
  value: z.number().optional(),
  violation: z.enum(['above_max', 'below_min', 'not_one_of', 'not_cbr']).optional(),
  limit_min: z.number().optional(),
  limit_max: z.number().optional(),
  allowed: z.array(z.number()).optional(),
  available: z.boolean().optional(),
  advice: z.string().optional(),
});

export const deliveryReportExportSchema = z.object({
  folder: z.string(),
  htmlFile: z.string(),
  jsonFile: z.string(),
  files: z.number(),
  findings: z.number(),
  openFindings: z.number(),
  pathsIncluded: z.boolean(),
}) satisfies z.ZodType<DeliveryReportExport>;
