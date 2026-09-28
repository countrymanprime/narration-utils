// The golden payloads for the Story Bible: which schema owns each file in tests/fixtures/contracts/ (see index.ts).
import type { z } from 'zod';
import { workJobSchema } from '../schemas/manuscript';
import {
  guideBuildResultSchema,
  guideEntitiesSchema,
  guidePreviewSchema,
  pronunciationQueriesCsvSchema,
  pronunciationQueriesSchema,
  queryImportResultSchema,
} from '../schemas/storyBible';

export const storyBibleGoldens: Record<string, z.ZodType> = {
  'guide-entities-sidecar.json': guideEntitiesSchema,
  'guide-entities.json': guideEntitiesSchema,
  'guide-entities-legacy.json': guideEntitiesSchema,
  'guide-entities-empty.json': guideEntitiesSchema,
  'guide-entities-pronunciation-sidecar.json': guideEntitiesSchema,
  'guide-entities-pronunciation.json': guideEntitiesSchema,
  'guide-pronunciation-queries.json': pronunciationQueriesSchema,
  'guide-pronunciation-queries-empty.json': pronunciationQueriesSchema,
  'guide-pronunciation-queries-csv.json': pronunciationQueriesCsvSchema,
  'guide-pronunciation-queries-import.json': queryImportResultSchema,
  'guide-build-idle.json': workJobSchema,
  'guide-build-starting.json': workJobSchema,
  'guide-build-failed.json': workJobSchema,
  'guide-build-started.json': guideBuildResultSchema,
  'guide-build-asset-required.json': guideBuildResultSchema,
  'guide-preview-asset-required.json': guidePreviewSchema,
};
