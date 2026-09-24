import { z } from 'zod';
import type { DiagnosticsEvidence, DiagnosticsFileResult, DiagnosticsJob, DiagnosticsSummary, DiagnosticsThresholds } from '../contracts/diagnostics';
import { listFromNull } from './base';
import { findingSchema } from './findings';

const diagnosticsThresholdsSchema = z.object({
  clip_ceiling_dbfs: z.number(),
  silence_floor_dbfs: z.number(),
  min_silence_seconds: z.number(),
  level_shift_lu: z.number(),
  room_tone_step_db: z.number(),
  pauses: z.object({ min_pause_seconds: z.number(), long_pause_seconds: z.number() }),
}) satisfies z.ZodType<DiagnosticsThresholds>;

const diagnosticsEvidenceSchema = z.object({
  status: z.enum(['measured', 'unavailable']),
  reason: z.string().optional(),
}) satisfies z.ZodType<DiagnosticsEvidence>;

const diagnosticsSummarySchema = z.object({
  duration_seconds: z.number(),
  sample_rate: z.number(),
  channels: z.number(),
  clip_regions: z.number(),
  level_shifts: z.number(),
  silences: z.number(),
  silence_seconds: z.number(),
  room_tone_segments: z.number(),
  pacing: diagnosticsEvidenceSchema,
  words_per_minute: z.number().nullable(),
}) satisfies z.ZodType<DiagnosticsSummary>;

const diagnosticsFileResultSchema = z.object({
  path: z.string(),
  name: z.string(),
  status: z.enum(['pending', 'checking', 'checked', 'failed', 'cancelled']),
  summary: diagnosticsSummarySchema.nullable(),
  findings: listFromNull(findingSchema),
  error: z.string().optional(),
}) satisfies z.ZodType<DiagnosticsFileResult>;

export const diagnosticsJobSchema = z.object({
  id: z.string().nullable(),
  kind: z.literal('diagnostics'),
  phase: z.enum(['idle', 'running', 'success', 'cancelled', 'error']),
  message: z.string(),
  percent: z.number(),
  logs: listFromNull(z.string()),
  elapsed: z.number(),
  error: z.string().optional(),
  sourceKind: z.enum(['raw_recording', 'processed_render']).nullable(),
  thresholds: diagnosticsThresholdsSchema,
  files: listFromNull(diagnosticsFileResultSchema),
}) satisfies z.ZodType<DiagnosticsJob>;
