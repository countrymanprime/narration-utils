import { z } from 'zod';
import type { RetakeLanesList, RetakeLanesStartResult, RetakeLanesState } from '../contracts/retakelanes';
import { listFromNull, optionalFromNull } from './base';

const retakeLaneSchema = z.object({
  itemGuid: z.string(),
  name: z.string(),
  lane: z.number().int().nonnegative(),
  plays: z.boolean(),
  position: z.number(),
  length: z.number(),
});

const retakeLaneLineSchema = z.object({
  lineId: z.string(),
  trackGuid: z.string(),
  trackName: z.string(),
  retakes: listFromNull(retakeLaneSchema),
});

export const retakeLanesListSchema = z.object({
  lines: listFromNull(retakeLaneLineSchema),
  laneTracks: z.number().int().nonnegative(),
}) satisfies z.ZodType<RetakeLanesList>;

export const retakeLanesStateSchema = z.object({
  runId: optionalFromNull(z.string()),
  phase: z.enum(['idle', 'picking', 'picked', 'error']),
  message: z.string(),
  lineId: z.string(),
  itemGuid: z.string(),
  trackName: z.string(),
  lane: optionalFromNull(z.number().int().nonnegative()),
}) satisfies z.ZodType<RetakeLanesState>;

export const retakeLanesStartResultSchema = z.object({ status: z.literal('started') }) satisfies z.ZodType<RetakeLanesStartResult>;
