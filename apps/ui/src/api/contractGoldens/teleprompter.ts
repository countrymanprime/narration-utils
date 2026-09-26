// The golden payloads for the teleprompter and read-aloud: which schema owns each file in tests/fixtures/contracts/ (see index.ts).
import { z } from 'zod';
import {
  readAloudReaperStateSchema,
  teleprompterDevicesResultSchema,
  teleprompterEventSchema,
  teleprompterFlagFindingsSchema,
  teleprompterLocatedSchema,
  teleprompterLocateResultSchema,
  teleprompterReadingSchema,
  teleprompterReaperInputSchema,
  teleprompterStartResultSchema,
  teleprompterStateSchema,
} from '../schemas/teleprompter';

export const teleprompterGoldens: Record<string, z.ZodType> = {
  'teleprompter-state-idle.json': teleprompterStateSchema,
  'teleprompter-state-running.json': teleprompterStateSchema,
  'teleprompter-events.json': teleprompterEventSchema.array(),
  'teleprompter-credits-script.json': teleprompterEventSchema,
  'teleprompter-devices.json': teleprompterDevicesResultSchema,
  'teleprompter-start-asset-required-whisper.json': teleprompterStartResultSchema,
  'teleprompter-start-asset-required-moonshine.json': teleprompterStartResultSchema,
  // The sidecar's own `locate` line (locate.py), which the host checks and carries as `located`.
  'teleprompter-locate.json': teleprompterLocatedSchema.extend({ type: z.literal('locate') }),
  'teleprompter-locate-found.json': teleprompterLocateResultSchema,
  'teleprompter-locate-no-track.json': teleprompterLocateResultSchema,
  'teleprompter-locate-no-recording.json': teleprompterLocateResultSchema,
  'teleprompter-locate-source-missing.json': teleprompterLocateResultSchema,
  'teleprompter-locate-agree.json': teleprompterLocateResultSchema,
  'teleprompter-locate-disagree.json': teleprompterLocateResultSchema,
  'teleprompter-locate-complete.json': teleprompterLocateResultSchema,
  'teleprompter-locate-prompter-only.json': teleprompterLocateResultSchema,
  'teleprompter-save-flags.json': teleprompterFlagFindingsSchema,
  // The per-chapter reading file the host writes at session end and reads back (ADR 0205).
  'teleprompter-reading.json': teleprompterReadingSchema,
  'teleprompter-level.json': teleprompterEventSchema.array(),
  'teleprompter-meter-stopped.json': teleprompterEventSchema.array(),
  'read-aloud-reaper-states.json': z.record(z.string(), readAloudReaperStateSchema),
  'teleprompter-reaper-inputs.json': z.record(z.string(), teleprompterReaperInputSchema),
};
