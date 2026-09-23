import { z } from 'zod';
import type { CleanupToolsStartResult, CleanupToolsState } from '../contracts/cleanuptools';
import { optionalFromNull } from './base';

export const cleanupToolsStateSchema = z.object({
  runId: optionalFromNull(z.string()),
  phase: z.enum(['idle', 'launching', 'launched', 'error']),
  message: z.string(),
  tool: z.enum(['', 'repair_pops_clicks', 'magnolius_declick']),
  action: z.string(),
}) satisfies z.ZodType<CleanupToolsState>;

export const cleanupToolsStartResultSchema = z.object({ status: z.literal('started') }) satisfies z.ZodType<CleanupToolsStartResult>;
