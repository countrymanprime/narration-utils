// The golden payloads for the app update: which schema owns each file in tests/fixtures/contracts/ (see index.ts).
import type { z } from 'zod';
import { updateJobSchema, updateStatusSchema } from '../schemas/update';

export const updateGoldens: Record<string, z.ZodType> = {
  'update-status-unchecked.json': updateStatusSchema,
  'update-status-available.json': updateStatusSchema,
  'update-status-check-failed.json': updateStatusSchema,
  'update-status-development.json': updateStatusSchema,
  'update-status-downloaded.json': updateStatusSchema,
  'update-job-downloading.json': updateJobSchema,
  'update-job-verifying.json': updateJobSchema,
  'update-job-ready.json': updateJobSchema,
  'update-job-installing.json': updateJobSchema,
  'update-job-error.json': updateJobSchema,
  'update-job-cancelled.json': updateJobSchema,
};
