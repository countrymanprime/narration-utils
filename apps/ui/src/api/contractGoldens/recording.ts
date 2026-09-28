// The built-in recorder's golden files (native-recording-suite Phase 2, ADR 0455): which schema owns each file in
// tests/fixtures/contracts/ (see index.ts). Written by apps/desktop/bindings_recording_test.go (UPDATE_CONTRACTS=1).
import type { z } from 'zod';
import { recorderDevicesResultSchema, recorderStateSchema } from '../schemas/recording';

export const recordingGoldens: Record<string, z.ZodType> = {
  'recorder-state-no-project.json': recorderStateSchema,
  'recorder-state-recording.json': recorderStateSchema,
  'recorder-state-takes.json': recorderStateSchema,
  'recorder-devices.json': recorderDevicesResultSchema,
};
