// The provider ports' capability payload's golden files (provider-ports PRD Phase 14): which schema owns each file in
// tests/fixtures/contracts/ (see index.ts). Written by apps/desktop/bindings_providers_test.go (UPDATE_CONTRACTS=1).
import type { z } from 'zod';
import { providerCapabilitiesSchema } from '../schemas/providers';

export const providerGoldens: Record<string, z.ZodType> = {
  'provider-capabilities-windows.json': providerCapabilitiesSchema,
  'provider-capabilities-darwin.json': providerCapabilitiesSchema,
};
