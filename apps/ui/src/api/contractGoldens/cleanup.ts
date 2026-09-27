// The golden payloads for silence trim and item gain (booth-actions-enablement PRD Phase 5, apps/desktop/bindings_cleanup.go).
import type { z } from 'zod';
import { cleanupApplyResultSchema, cleanupPreviewResultSchema, levelMatchApplyResultSchema, levelMatchPreviewResultSchema } from '../schemas/cleanup';

export const cleanupGoldens: Record<string, z.ZodType> = {
  'cleanup-preview.json': cleanupPreviewResultSchema,
  'cleanup-apply.json': cleanupApplyResultSchema,
  'level-match-preview.json': levelMatchPreviewResultSchema,
  'level-match-apply.json': levelMatchApplyResultSchema,
};
