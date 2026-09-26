// The golden payloads for projects and the DAW link: which schema owns each file in tests/fixtures/contracts/ (see index.ts).
import type { z } from 'zod';
import { dawLaunchResultSchema, dawLinkResultSchema, projectSwitchResultSchema, recentProjectsSchema } from '../schemas/project';

export const projectGoldens: Record<string, z.ZodType> = {
  'project-recents.json': recentProjectsSchema,
  'project-recents-empty.json': recentProjectsSchema,
  'project-switch-attached.json': projectSwitchResultSchema,
  'project-switch-refused.json': projectSwitchResultSchema,
  'daw-link-selected.json': dawLinkResultSchema,
  'daw-link-folder-mismatch.json': dawLinkResultSchema,
  'daw-link-cancelled.json': dawLinkResultSchema,
  'daw-launch.json': dawLaunchResultSchema,
};
