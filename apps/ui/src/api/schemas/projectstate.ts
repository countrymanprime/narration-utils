import { z } from 'zod';
import type { ProjectStateChanged, ProjectStateStartResult, ProjectStateState } from '../contracts/projectstate';
import { optionalFromNull } from './base';

export const projectStateStateSchema = z.object({
  runId: optionalFromNull(z.string()),
  phase: z.enum(['idle', 'checking', 'success', 'error']),
  message: z.string(),
  changeCount: optionalFromNull(z.number().int().min(0)),
  projectFile: z.string(),
  savedModifiedAt: optionalFromNull(z.number()),
}) satisfies z.ZodType<ProjectStateState>;

export const projectStateStartResultSchema = z.object({ status: z.literal('started') }) satisfies z.ZodType<ProjectStateStartResult>;

export const projectStateChangedSchema = z.object({ changed: z.boolean() }) satisfies z.ZodType<ProjectStateChanged>;
