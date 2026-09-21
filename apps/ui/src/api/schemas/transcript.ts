import { z } from 'zod';
import type { Discrepancy, MarkerExport, TranscriptState } from '../contracts/transcript';
import { optionalFromNull } from './base';

const discrepancySchema = z.object({
  id: z.string(),
  kind: z.string(),
  name: z.string(),
  docText: z.string(),
  audioText: z.string(),
  projectTime: z.number(),
  itemIndex: z.number(),
  srcpos: z.number(),
  chapter: z.string().optional(),
  paragraph: z.number().optional(),
  sourceLine: z.number().optional(),
  scriptContext: z.string().optional(),
  audioContext: z.string().optional(),
  markerState: z.enum(['pending', 'existing', 'exported']).optional(),
  existingMarkerName: z.string().optional(),
}) satisfies z.ZodType<Discrepancy>;

const idleMarkerExport: MarkerExport = { phase: 'idle', message: '', added: 0, skipped: 0 };

const markerExportSchema = z.object({
  phase: z.enum(['idle', 'exporting', 'complete', 'error']),
  message: z.string(),
  added: z.number(),
  skipped: z.number(),
}) satisfies z.ZodType<MarkerExport>;

/**
 * The idle state sets `runId`, `trackName`, `audioItemCount` and `completedAt` to `null` on the wire (transcript/service.go),
 * and a snapshot saved by an older host has no `markerExport`; both are absorbed here, replacing the hand-written
 * `normalizeTranscriptState` the client used to run over every state.
 */
export const transcriptStateSchema = z.object({
  runId: optionalFromNull(z.string()),
  trackName: optionalFromNull(z.string()),
  audioItemCount: optionalFromNull(z.number()),
  completedAt: optionalFromNull(z.string()),
  phase: z.enum(['idle', 'preparing', 'running', 'inspecting', 'need_chapter', 'success', 'cancelled', 'error']),
  percent: z.number(),
  message: z.string(),
  logs: z.array(z.string()),
  chapters: z.array(z.string()),
  rows: z.array(discrepancySchema),
  diff: z.string(),
  summary: z.string(),
  elapsed: z.number(),
  markerExport: markerExportSchema.default(() => ({ ...idleMarkerExport })),
}) satisfies z.ZodType<TranscriptState>;
