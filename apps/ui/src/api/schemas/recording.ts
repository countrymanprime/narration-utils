import { z } from 'zod';
import type { RecorderDevicesResult, RecorderLastTake, RecorderLevel, RecorderState, RecorderTake } from '../contracts/recording';
import { listFromNull } from './base';
import { dawCapabilitySupportSchema } from './daw';

const recorderTakeSchema = z.object({
  name: z.string(),
  path: z.string(),
  seconds: z.number().min(0),
  sampleRate: z.number().int().min(0),
  channels: z.number().int().min(0),
  bits: z.number().int().min(0),
  recordedAt: z.number(),
  unfinished: z.boolean(),
  lineId: z.string().nullable(),
  keeper: z.boolean(),
}) satisfies z.ZodType<RecorderTake>;

const recorderLastTakeSchema = z.object({
  name: z.string(),
  seconds: z.number().min(0),
  dropouts: z.number().int().min(0),
  clipped: z.number().int().min(0),
  latencyMs: z.number().min(0),
  error: z.string().nullable(),
  unfinished: z.boolean(),
}) satisfies z.ZodType<RecorderLastTake>;

export const recorderStateSchema = z.object({
  hasProject: z.boolean(),
  engine: z.enum(['daw', 'builtin']),
  support: dawCapabilitySupportSchema,
  phase: z.enum(['idle', 'metering', 'recording', 'stopping']),
  device: z.string(),
  folder: z.string(),
  take: z.string().nullable(),
  startedAt: z.number().nullable(),
  message: z.string(),
  last: recorderLastTakeSchema.nullable(),
  takes: listFromNull(recorderTakeSchema),
}) satisfies z.ZodType<RecorderState>;

export const recorderLevelSchema = z.object({ peak: z.number(), rms: z.number() }) satisfies z.ZodType<RecorderLevel>;

export const recorderDevicesResultSchema = z.object({
  devices: listFromNull(z.object({ name: z.string() })),
  error: z.string().nullable(),
}) satisfies z.ZodType<RecorderDevicesResult>;
