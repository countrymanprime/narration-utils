// The golden payloads for the Master & QC export flow (render-encode-master.prd.md Phase 5): which schema owns each
// file in tests/fixtures/contracts/ (see index.ts).
import type { z } from 'zod';
import { exportJobSchema, packageJobSchema } from '../schemas/renderEncodeMaster';
import { measurePickResultSchema } from '../schemas/measure';

export const renderEncodeMasterGoldens: Record<string, z.ZodType> = {
  'export-pick.json': measurePickResultSchema,
  'export-idle.json': exportJobSchema,
  'export-running.json': exportJobSchema,
  'export-error.json': exportJobSchema,
  'export-cancelled.json': exportJobSchema,
  'package-idle.json': packageJobSchema,
  'package-success.json': packageJobSchema,
  'package-error.json': packageJobSchema,
};
