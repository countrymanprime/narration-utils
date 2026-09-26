// The golden payloads for the workspace alignment: which schema owns each file in tests/fixtures/contracts/ (see index.ts).
import type { z } from 'zod';
import { workspaceAlignmentResultSchema } from '../schemas/workspace';

export const workspaceGoldens: Record<string, z.ZodType> = {
  'workspace-alignment-current.json': workspaceAlignmentResultSchema,
  'workspace-alignment-stale.json': workspaceAlignmentResultSchema,
  'workspace-alignment-never.json': workspaceAlignmentResultSchema,
  'workspace-alignment-needs-align-again.json': workspaceAlignmentResultSchema,
};
