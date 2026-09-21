import { z } from 'zod';
import type { HeardWord, TeleprompterEvent, TeleprompterPosition, TeleprompterScript, TeleprompterState } from '../contracts/teleprompter';

// The live event stream (ADR 0021, ADR 0022): the sidecar prints one JSON object per line and the host relays each unchanged, so
// these schemas are the only place the shape is checked between the Python `live_asr.py` and the reader.

const spanSchema = z.object({
  kind: z.enum(['title', 'paragraph']),
  id: z.string(),
  index: z.number().nullable(),
  start: z.number(),
  count: z.number(),
});

const teleprompterScriptSchema = z.object({
  type: z.literal('script'),
  chapter: z.object({ id: z.string(), title: z.string() }),
  tokens: z.number(),
  spans: z.array(spanSchema),
}) satisfies z.ZodType<TeleprompterScript>;

const teleprompterPositionSchema = z.object({
  type: z.literal('position'),
  read: z.number(),
  committed: z.number(),
  status: z.enum(['listening', 'waiting', 'done']),
  jump: z.enum(['restart', 'skip']).nullable(),
  skipped: z.tuple([z.number(), z.number()]).nullable(),
}) satisfies z.ZodType<TeleprompterPosition>;

const heardWordShape = { word: z.string(), start: z.number(), end: z.number() };
const heardWordSchema = z.object(heardWordShape) satisfies z.ZodType<HeardWord>;

export const teleprompterEventSchema = z.discriminatedUnion('type', [
  teleprompterScriptSchema,
  teleprompterPositionSchema,
  z.object({ type: z.literal('partial'), segment: z.number(), words: z.array(heardWordSchema) }),
  z.object({ type: z.literal('word'), segment: z.number(), ...heardWordShape }),
  z.object({ type: z.literal('segment_end'), segment: z.number() }),
]) satisfies z.ZodType<TeleprompterEvent>;

/** The event types the UI understands. An event of another type is a newer sidecar talking, not a malformed payload. */
export const TELEPROMPTER_EVENT_TYPES: ReadonlySet<string> = new Set(['script', 'position', 'partial', 'word', 'segment_end']);

/**
 * The snapshot the host builds (teleprompter/service.go): always all six keys, the script and position being the last events
 * of those types so a view that opens mid-session can catch up. A missing key takes the idle value, which is what the hand-written
 * `normalizeTeleprompterState` did for the `Partial` it accepted.
 */
export const teleprompterStateSchema = z.object({
  phase: z.enum(['idle', 'starting', 'running', 'stopping', 'stopped', 'error']).default('idle'),
  message: z.string().default(''),
  engine: z.string().nullable().default(null),
  chapter: z.string().nullable().default(null),
  script: teleprompterScriptSchema.nullable().default(null),
  position: teleprompterPositionSchema.nullable().default(null),
}) satisfies z.ZodType<TeleprompterState>;

/** The stream recorded from the real ScriptTracker (`teleprompterRecording.json`) that the browser mock replays; checked when the mock loads. */
export const recordedStreamSchema = z.object({
  tokens: z.number(),
  events: z.array(z.object({ t: z.number(), event: teleprompterPositionSchema })),
});
