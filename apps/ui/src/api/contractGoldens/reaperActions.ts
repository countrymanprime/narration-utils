// The golden payloads for the REAPER actions on the Tracks page: which schema owns each file in tests/fixtures/contracts/ (see index.ts).
import type { z } from 'zod';
import { chapterTagsEmbedResultSchema, chapterTagsPreviewSchema } from '../schemas/chaptertags';
import { cleanupToolsStateSchema } from '../schemas/cleanuptools';
import { lineIdentityStateSchema } from '../schemas/lineidentity';
import { pickupsStateSchema } from '../schemas/pickups';
import { projectStateChangedSchema, projectStateStateSchema } from '../schemas/projectstate';
import { renderConfigStateSchema } from '../schemas/renderconfig';
import { retakeLanesListSchema, retakeLanesStateSchema } from '../schemas/retakelanes';

export const reaperActionsGoldens: Record<string, z.ZodType> = {
  'line-identity-idle.json': lineIdentityStateSchema,
  'line-identity-read-success.json': lineIdentityStateSchema,
  'pickups-idle.json': pickupsStateSchema,
  'pickups-import-success.json': pickupsStateSchema,
  'render-config-idle.json': renderConfigStateSchema,
  'render-config-success.json': renderConfigStateSchema,
  'cleanup-tools-idle.json': cleanupToolsStateSchema,
  'cleanup-tools-launched.json': cleanupToolsStateSchema,
  'project-state-idle.json': projectStateStateSchema,
  'project-state-checked.json': projectStateStateSchema,
  'project-state-changed-since.json': projectStateChangedSchema,
  'retake-lanes-list.json': retakeLanesListSchema,
  'retake-lanes-idle.json': retakeLanesStateSchema,
  'retake-lanes-picked.json': retakeLanesStateSchema,
  'chapter-tags-preview-idle.json': chapterTagsPreviewSchema,
  'chapter-tags-preview-ready.json': chapterTagsPreviewSchema,
  'chapter-tags-embed-success.json': chapterTagsEmbedResultSchema,
};
