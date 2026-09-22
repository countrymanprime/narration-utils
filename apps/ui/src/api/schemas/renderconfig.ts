import { z } from 'zod';
import type { RenderConfigState, RenderConfigStartResult, RenderConfigSuggestedFolder } from '../contracts/renderconfig';
import { listFromNull, optionalFromNull } from './base';

export const renderConfigStateSchema = z.object({
  runId: optionalFromNull(z.string()),
  phase: z.enum(['idle', 'configuring', 'success', 'error']),
  message: z.string(),
  folder: z.string(),
  targets: listFromNull(z.string()),
  count: z.number(),
}) satisfies z.ZodType<RenderConfigState>;

export const renderConfigStartResultSchema = z.object({ status: z.literal('started') }) satisfies z.ZodType<RenderConfigStartResult>;

export const renderConfigSuggestedFolderSchema = z.object({ folder: z.string() }) satisfies z.ZodType<RenderConfigSuggestedFolder>;
