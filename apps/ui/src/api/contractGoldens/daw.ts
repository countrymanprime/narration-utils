// The DAW port capability payload's golden files (DAW port PRD Phase 4): which schema owns each file in
// tests/fixtures/contracts/ (see index.ts). Written by apps/desktop/bindings_daw_test.go (UPDATE_CONTRACTS=1).
import type { z } from 'zod';
import { dawCapabilitiesSchema } from '../schemas/daw';

export const dawGoldens: Record<string, z.ZodType> = {
  'daw-capabilities-standalone.json': dawCapabilitiesSchema,
  'daw-capabilities-reaper.json': dawCapabilitiesSchema,
  'daw-capabilities-audacity.json': dawCapabilitiesSchema,
};
