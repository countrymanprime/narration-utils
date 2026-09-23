import { z } from 'zod';
import type {
  HeardWord,
  TeleprompterDevice,
  TeleprompterDevicesResult,
  TeleprompterEngine,
  TeleprompterEvent,
  TeleprompterFlag,
  TeleprompterFlagFinding,
  TeleprompterLocateResult,
  TeleprompterLocated,
  TeleprompterPosition,
  TeleprompterScript,
  TeleprompterStartResult,
  TeleprompterState,
} from '../contracts/teleprompter';
import { chapterTrackMatchSchema, recordedEndSchema } from './chapterTrackMap';
import { modelAssetRequiredSchema } from './whisper';

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

// A suspected flag (flags.py, ADR 0115): `start`/`end` are script word indices, equal for an extra.
const teleprompterFlagSchema = z
  .object({
    type: z.literal('flag'),
    id: z.number(),
    kind: z.enum(['misread', 'extra', 'skipped', 'restart']),
    start: z.number(),
    end: z.number(),
    heard: z.string(),
  })
  .refine((flag) => flag.start <= flag.end, { message: 'a flag cannot end before it starts', path: ['end'] }) satisfies z.ZodType<TeleprompterFlag>;

const heardWordShape = { word: z.string(), start: z.number(), end: z.number() };
const heardWordSchema = z.object(heardWordShape) satisfies z.ZodType<HeardWord>;

export const teleprompterEventSchema = z.discriminatedUnion('type', [
  teleprompterScriptSchema,
  teleprompterPositionSchema,
  teleprompterFlagSchema,
  z.object({ type: z.literal('partial'), segment: z.number(), words: z.array(heardWordSchema) }),
  z.object({ type: z.literal('word'), segment: z.number(), ...heardWordShape }),
  z.object({ type: z.literal('segment_end'), segment: z.number() }),
]) satisfies z.ZodType<TeleprompterEvent>;

/** The event types the UI understands. An event of another type is a newer sidecar talking, not a malformed payload. */
export const TELEPROMPTER_EVENT_TYPES: ReadonlySet<string> = new Set(['script', 'position', 'flag', 'partial', 'word', 'segment_end']);

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

const teleprompterEngineSchema = z.enum(['whisper', 'moonshine']) satisfies z.ZodType<TeleprompterEngine>;

/**
 * `TeleprompterStart`: it started, or the chosen engine's model is not installed yet (the first-use gate). The engine is also the asset kind
 * the model installs as. A host from before engine choice sent no engine and could launch only Whisper, hence the default.
 */
export const teleprompterStartResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('started') }),
  modelAssetRequiredSchema.extend({ engine: teleprompterEngineSchema.default('whisper') }),
]) satisfies z.ZodType<TeleprompterStartResult>;

const teleprompterDeviceSchema = z.object({ name: z.string() }) satisfies z.ZodType<TeleprompterDevice>;

/** `TeleprompterDevices` (`apps/desktop/bindings.go`): a listing failure is `{devices: [], error: "..."}`, never a thrown error. */
export const teleprompterDevicesResultSchema = z.object({
  devices: z.array(teleprompterDeviceSchema),
  error: z.string().nullable(),
}) satisfies z.ZodType<TeleprompterDevicesResult>;

/** The stream recorded from the real ScriptTracker and its flags (`teleprompterRecording.json`) that the browser mock replays; checked when the mock loads. */
export const recordedStreamSchema = z.object({
  tokens: z.number(),
  events: z.array(z.object({ t: z.number(), event: z.discriminatedUnion('type', [teleprompterPositionSchema, teleprompterFlagSchema]) })),
});

/** The sidecar's `locate` line (locate.py), as `TeleprompterLocate` carries it: a word and its sentence, or neither. */
export const teleprompterLocatedSchema = z.object({
  word: z.number().int().nonnegative().nullable(),
  last: z.number().int().nonnegative().nullable(),
  sentence: z.object({ start: z.number().int().nonnegative(), end: z.number().int().nonnegative(), text: z.string() }).nullable(),
  confidence: z.number().min(0).max(1),
  confident: z.boolean(),
  matched: z.number().int().nonnegative(),
  heard: z.number().int().nonnegative(),
  runnerUp: z.number().int().nonnegative(),
  tokens: z.number().int().nonnegative(),
  heardText: z.string(),
}) satisfies z.ZodType<TeleprompterLocated>;

/** `TeleprompterLocate` (`apps/desktop/teleprompterlocate.go`): a status with the track match and what was read, or the first-use gate. */
export const teleprompterLocateResultSchema = z.union([
  modelAssetRequiredSchema,
  z.object({
    status: z.enum(['found', 'low_confidence', 'not_found', 'no_track', 'no_recording', 'source_missing', 'source_unsupported']),
    match: chapterTrackMatchSchema,
    track: z.object({ guid: z.string(), name: z.string(), index: z.number().int() }).nullable(),
    recordedEnd: recordedEndSchema.nullable(),
    tail: z.object({ from: z.number(), to: z.number() }).nullable(),
    located: teleprompterLocatedSchema.nullable(),
  }),
]) satisfies z.ZodType<TeleprompterLocateResult>;

const flagKindSchema = z.enum(['misread', 'extra', 'skipped', 'restart']);

/**
 * A kept flag as `TeleprompterSaveFlags` answers it (`apps/desktop/internal/liveflags`, ADR 0117): a findings record
 * (docs/architecture/findings-contract.md) in the contract's snake_case. It is always suspected, so its confidence is null.
 */
const teleprompterFlagFindingSchema = z.object({
  schema_version: z.number(),
  id: z.string(),
  analyzer: z.string(),
  project: z.object({ path: z.string().optional(), output_path: z.string().optional() }),
  source: z.object({
    file: z.string().optional(),
    track_guid: z.string().optional(),
    item_guid: z.string().optional(),
    take_guid: z.string().optional(),
  }),
  manuscript: z.object({
    chapter_id: z.string().optional(),
    chapter_title: z.string().optional(),
    expected: z.string().optional(),
    recorded: z.string().optional(),
    span: z
      .object({ paragraph_id: z.string().optional(), start: z.number().optional(), end: z.number().optional(), ordinal: z.number().optional() })
      .optional(),
  }),
  category: z.enum(['transcript_discrepancy', 'pickup']),
  severity: z.enum(['info', 'warning', 'error']),
  confidence: z.null(),
  evidence_version: z.string().optional(),
  confidence_reason: z.string(),
  evidence: z.object({
    kind: flagKindSchema,
    heard: z.string(),
    suspected: z.literal(true),
    script_words: z.tuple([z.number(), z.number()]),
    before: z.string().optional(),
  }),
  review: z.object({
    status: z.enum(['unreviewed', 'accepted', 'dismissed', 'deferred']),
    note: z.string().optional(),
    timestamp: z.string().optional(),
  }),
  not_in_latest_run: z.boolean().optional(),
}) satisfies z.ZodType<TeleprompterFlagFinding>;

/** `TeleprompterSaveFlags`: one finding per flag sent, in order. */
export const teleprompterFlagFindingsSchema = z.array(teleprompterFlagFindingSchema);
