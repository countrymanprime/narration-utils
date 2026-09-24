import { z } from 'zod';
import type { MeasureClipRun, MeasureFingerprint, MeasureJob, MeasurePickResult, MeasureRange, MeasureReport } from '../contracts/measure';
import { listFromNull } from './base';

const nullableNumber = z.number().nullable();

export const measureRangeSchema = z.object({ start_seconds: z.number(), length_seconds: z.number() }) satisfies z.ZodType<MeasureRange>;

export const measureClipRunSchema = z.object({
  channel: z.number(),
  start_seconds: z.number(),
  duration_seconds: z.number(),
  samples: z.number(),
}) satisfies z.ZodType<MeasureClipRun>;

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
  full_scale_samples: z.number(),
  clip_run_count: z.number(),
  clip_runs: listFromNull(measureClipRunSchema),
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
}) satisfies z.ZodType<MeasureJob>;

export const measurePickResultSchema = z.object({ paths: listFromNull(z.string()) }) satisfies z.ZodType<MeasurePickResult>;
