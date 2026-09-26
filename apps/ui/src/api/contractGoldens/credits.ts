// The golden payloads for audiobook credits: which schema owns each file in tests/fixtures/contracts/ (see index.ts).
import type { z } from 'zod';
import {
  creditsAnnouncementsSchema,
  creditsProjectValuesResultSchema,
  creditsRenderResultSchema,
  creditsSetupStateSchema,
  creditsStatusesSchema,
  creditTemplatesSchema,
  retailSampleAnswerSchema,
} from '../schemas/credits';

export const creditsGoldens: Record<string, z.ZodType> = {
  'credits-templates.json': creditTemplatesSchema,
  'credits-project-values-empty.json': creditsProjectValuesResultSchema,
  'credits-setup-state-needed.json': creditsSetupStateSchema,
  'credits-setup-state-dismissed.json': creditsSetupStateSchema,
  'credits-preview-unresolved.json': creditsRenderResultSchema,
  'credits-chapter-announcements.json': creditsAnnouncementsSchema,
  'credits-retail-sample.json': retailSampleAnswerSchema,
  'credits-retail-sample-none.json': retailSampleAnswerSchema,
  'credits-retail-sample-stale.json': retailSampleAnswerSchema,
  'credits-status-empty.json': creditsStatusesSchema,
  'credits-status-set.json': creditsStatusesSchema,
};
