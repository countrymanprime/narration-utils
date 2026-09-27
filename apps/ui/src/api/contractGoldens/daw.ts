// The DAW port's golden files: the capability payload (DAW port PRD Phase 4, written by apps/desktop/bindings_daw_test.go) and
// the transport (Phase 9, bindings_daw_transport_test.go), both UPDATE_CONTRACTS=1. Which schema owns each file in
// tests/fixtures/contracts/ (see index.ts).
import type { z } from 'zod';
import { dawCapabilitiesSchema, dawTransportSchema } from '../schemas/daw';

export const dawGoldens: Record<string, z.ZodType> = {
  'daw-capabilities-standalone.json': dawCapabilitiesSchema,
  'daw-capabilities-reaper.json': dawCapabilitiesSchema,
  'daw-capabilities-audacity.json': dawCapabilitiesSchema,
  'daw-transport-stopped.json': dawTransportSchema,
  'daw-transport-playing.json': dawTransportSchema,
  'daw-transport-recording.json': dawTransportSchema,
};
