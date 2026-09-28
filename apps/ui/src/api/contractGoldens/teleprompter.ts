// The golden payloads for the teleprompter and read-aloud: which schema owns each file in tests/fixtures/contracts/ (see index.ts).
import { z } from 'zod';
import {
  readAloudReaperStateSchema,
  readAloudRecordingSchema,
  teleprompterDevicesResultSchema,
  teleprompterEventSchema,
  teleprompterFlagFindingsSchema,
  teleprompterLocatedSchema,
  teleprompterLocateResultSchema,
  teleprompterPunchResultSchema,
  teleprompterReadingSchema,
  teleprompterReaperInputSchema,
  teleprompterResumeFollowEventSchema,
  teleprompterResumeFollowSchema,
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
  'teleprompter-locate-live.json': teleprompterLocateResultSchema,
  'teleprompter-locate-recording.json': teleprompterLocateResultSchema,
  'teleprompter-resume-follow-started.json': teleprompterResumeFollowSchema,
  'teleprompter-resume-follow-unavailable.json': teleprompterResumeFollowSchema,
  'teleprompter-resume-follow-playing.json': teleprompterResumeFollowEventSchema,
  'teleprompter-resume-follow-cursor.json': teleprompterResumeFollowEventSchema,
  'teleprompter-save-flags.json': teleprompterFlagFindingsSchema,
  // The per-chapter reading file the host writes at session end and reads back (ADR 0205).
  'teleprompter-reading.json': teleprompterReadingSchema,
  'teleprompter-level.json': teleprompterEventSchema.array(),
  'teleprompter-meter-stopped.json': teleprompterEventSchema.array(),
  'read-aloud-reaper-states.json': z.record(z.string(), readAloudReaperStateSchema),
  'read-aloud-recordings.json': z.record(z.string(), readAloudRecordingSchema),
  'teleprompter-reaper-inputs.json': z.record(z.string(), teleprompterReaperInputSchema),
  'teleprompter-punch-results.json': z.record(z.string(), teleprompterPunchResultSchema),
  // The sidecar's own `word_time` lines (align_word.py, ADR 0560): the host reads them (teleprompter.AlignWord) and hands
  // the UI only the punch result above, so no UI schema owns them; this pins the shape the Go and Python tests share.
  'teleprompter-word-time.json': z
    .object({
      type: z.literal('word_time'),
      word: z.number().int().nonnegative(),
      time: z.number().nullable(),
      exact: z.boolean(),
      matched: z.number().int().nonnegative(),
      heard: z.number().int().nonnegative(),
      tokens: z.number().int().nonnegative(),
    })
    .strict()
    .array(),
};
