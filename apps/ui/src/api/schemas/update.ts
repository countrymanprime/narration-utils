import { z } from 'zod';
import type { UpdateAvailable, UpdateChannel, UpdateJob, UpdateStatus } from '../contracts/update';

const updateChannelSchema = z.enum(['candidates', 'stable']) satisfies z.ZodType<UpdateChannel>;

const updateAvailableSchema = z.object({
  version: z.string(),
  tag: z.string(),
  candidate: z.boolean(),
  // The host builds it from the repository and the tag; nothing but a GitHub address is accepted, whatever comes to use it later.
  notesUrl: z.string().startsWith('https://github.com/'),
  size: z.number(),
  publishedAt: z.string(),
  replaces: z.boolean(),
}) satisfies z.ZodType<UpdateAvailable>;

/** The download of an update: what `UpdateDownload`, `UpdateJobState` and `UpdateJobCancel` answer. */
export const updateJobSchema = z.object({
  id: z.string(),
  version: z.string(),
  phase: z.enum(['downloading', 'verifying', 'unpacking', 'ready', 'error', 'cancelled']),
  message: z.string(),
  percent: z.number().min(0).max(100),
  bytesDone: z.number().min(0),
  bytesTotal: z.number().min(0),
  error: z.string(),
}) satisfies z.ZodType<UpdateJob>;

/**
 * The update status: what `UpdateStatus` and `UpdateCheck` answer and what the `update:status` event carries. The host builds every
 * URL in it from the repository and the tag, and the UI never opens one it is given: it asks the host to open the notes.
 */
export const updateStatusSchema = z.object({
  version: z.string(),
  development: z.boolean(),
  platform: z.string(),
  channel: updateChannelSchema,
  lastChecked: z.string(),
  failure: z.string(),
  available: updateAvailableSchema.nullable(),
}) satisfies z.ZodType<UpdateStatus>;
