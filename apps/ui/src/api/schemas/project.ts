import { z } from 'zod';
import type { DawLinkResult, ProjectFolderSelection, ProjectSwitchResult, RecentProject } from '../contracts/project';
import { listFromNull } from './base';

const recentProjectSchema = z.object({ path: z.string(), name: z.string(), lastOpened: z.string() }) satisfies z.ZodType<RecentProject>;
export const recentProjectsSchema = listFromNull(recentProjectSchema);
export const projectFolderSelectionSchema = z.object({ selected: z.boolean(), path: z.string().optional() }) satisfies z.ZodType<ProjectFolderSelection>;
/** `reason` is an empty string when the switch worked. */
export const projectSwitchResultSchema = z.object({ switched: z.boolean(), reason: z.string().optional() }) satisfies z.ZodType<ProjectSwitchResult>;
export const dawLinkResultSchema = z.object({
  selected: z.boolean(),
  linked: z.boolean().default(false),
  path: z.string().optional(),
  folderMismatch: z.boolean().optional(),
  message: z.string().optional(),
}) satisfies z.ZodType<DawLinkResult>;
