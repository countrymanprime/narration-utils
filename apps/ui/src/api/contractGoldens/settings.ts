// The golden payloads for settings: which schema owns each file in tests/fixtures/contracts/ (see index.ts).
import type { z } from 'zod';
import { settingsForScopeSchema } from '../schemas/settings';

export const settingsGoldens: Record<string, z.ZodType> = {
  'settings-global.json': settingsForScopeSchema,
  'settings-project.json': settingsForScopeSchema,
};
