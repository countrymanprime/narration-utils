import { z } from 'zod';
import type { LineIdentityLine, LineIdentityStampSummary, LineIdentityStartResult, LineIdentityState } from '../contracts/lineidentity';
import { listFromNull, optionalFromNull } from './base';

const lineStatusSchema = z.enum(['ok', 'drift', 'stale-source', 'removed', 'unrecognized', 'unknown']);

const lineIdentityLineSchema = z.object({
  itemGuid: z.string(),
  lineId: z.string(),
  entityId: z.string(),
  position: z.number(),
  length: z.number(),
  text: z.string(),
  status: lineStatusSchema,
  currentText: z.string().optional(),
}) satisfies z.ZodType<LineIdentityLine>;

const lineIdentityStampSummarySchema = z.object({
  applied: z.number(),
  unchanged: z.number(),
  missingCount: z.number(),
  conflictsCount: z.number(),
  missing: listFromNull(z.string()),
  conflicts: listFromNull(z.string()),
}) satisfies z.ZodType<LineIdentityStampSummary>;

/** `runId` is null on the wire until a run starts; a line with no drift carries no `currentText` at all (optional, never null). */
export const lineIdentityStateSchema = z.object({
  runId: optionalFromNull(z.string()),
  phase: z.enum(['idle', 'stamping', 'reading', 'success', 'error']),
  message: z.string(),
  stamp: lineIdentityStampSummarySchema,
  lines: listFromNull(lineIdentityLineSchema),
  linesRead: z.number(),
}) satisfies z.ZodType<LineIdentityState>;

export const lineIdentityStartResultSchema = z.object({ status: z.literal('started') }) satisfies z.ZodType<LineIdentityStartResult>;
