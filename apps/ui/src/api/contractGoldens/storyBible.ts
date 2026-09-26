// The golden payloads for the Story Bible: which schema owns each file in tests/fixtures/contracts/ (see index.ts).
import type { z } from 'zod';
import { workJobSchema } from '../schemas/manuscript';
import { guideBuildResultSchema, guideEntitiesSchema, guidePreviewSchema } from '../schemas/storyBible';

export const storyBibleGoldens: Record<string, z.ZodType> = {
  'guide-entities-sidecar.json': guideEntitiesSchema,
  'guide-entities.json': guideEntitiesSchema,
  'guide-entities-legacy.json': guideEntitiesSchema,
  'guide-entities-empty.json': guideEntitiesSchema,
  'guide-build-idle.json': workJobSchema,
  'guide-build-starting.json': workJobSchema,
  'guide-build-failed.json': workJobSchema,
  'guide-build-started.json': guideBuildResultSchema,
  'guide-build-asset-required.json': guideBuildResultSchema,
  'guide-preview-asset-required.json': guidePreviewSchema,
};
