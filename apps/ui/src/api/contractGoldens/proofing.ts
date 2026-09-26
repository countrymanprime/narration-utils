// The golden payloads for the proofing comparison (transcript): which schema owns each file in tests/fixtures/contracts/ (see index.ts).
import type { z } from 'zod';
import { transcriptStateSchema } from '../schemas/transcript';
import { startResultSchema } from '../schemas/whisper';

export const proofingGoldens: Record<string, z.ZodType> = {
  'transcript-idle.json': transcriptStateSchema,
  'transcript-success.json': transcriptStateSchema,
  'transcript-start-asset-required.json': startResultSchema,
  'transcript-start-started.json': startResultSchema,
};
