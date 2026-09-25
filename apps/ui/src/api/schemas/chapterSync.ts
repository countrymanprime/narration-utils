import { z } from 'zod';
import type { ChapterSyncBatch, ChapterSyncPreview, ChapterSyncState, ChapterSyncTrackRef } from '../contracts/chapterSync';
import { listFromNull } from './base';
import { chapterTrackCandidateSchema, trackMappingSchema } from './chapterTrackMap';

const projectSchema = z.enum(['ready', 'none', 'choose', 'error']);
const trackRefSchema = z.object({
  guid: z.string(),
  name: z.string(),
  index: z.number().int(),
  marker: z.enum(['', 'take', 'pickup', 'credits']),
}) satisfies z.ZodType<ChapterSyncTrackRef>;

const batchSchema = z.object({
  at: z.string(),
  trigger: z.enum(['consent', 'daw-link', 'import', 'attach', 'undo']),
  linked: listFromNull(trackMappingSchema),
  newTracks: listFromNull(trackRefSchema),
}) satisfies z.ZodType<ChapterSyncBatch>;

/** `ChapterSyncState`, `ChapterSyncSetEnabled`, `ChapterSyncUndo` and the `chaptersync:state` event (`apps/desktop/chaptersync.go`, ADR 0209). */
export const chapterSyncStateSchema = z
  .object({
    consent: z.enum(['undecided', 'on', 'off']),
    decidedAt: z.string().nullable(),
    ask: z.boolean(),
    manuscript: z.boolean(),
    dawLinked: z.boolean(),
    project: projectSchema,
    message: z.string(),
    projectFile: z.string(),
    savedAt: z.string(),
    lastSync: z.string().nullable(),
    counts: z.object({
      linked: z.number().int().nonnegative(),
      needsYou: z.number().int().nonnegative(),
      noTrack: z.number().int().nonnegative(),
      unmatched: z.number().int().nonnegative(),
      pickupTracks: z.number().int().nonnegative(),
    }),
    batch: batchSchema.nullable(),
  })
  .refine((state) => !state.ask || (state.consent === 'undecided' && state.manuscript && state.dawLinked), {
    message: 'the consent is asked only while undecided, with a manuscript and a linked DAW project',
    path: ['ask'],
  }) satisfies z.ZodType<ChapterSyncState>;

/** `ChapterSyncPreview` (`apps/desktop/chaptersync.go`). */
export const chapterSyncPreviewSchema = z.object({
  project: projectSchema,
  message: z.string(),
  projectFile: z.string(),
  savedAt: z.string(),
  kept: listFromNull(trackMappingSchema),
  autoLink: listFromNull(
    z.object({
      trackGuid: z.string(),
      trackName: z.string(),
      chapterId: z.string(),
      chapterTitle: z.string(),
      match: z.object({ score: z.number().min(0).max(1), kind: z.enum(['exact', 'contained', 'previous-link']) }),
    }),
  ),
  needsYou: listFromNull(
    z.object({
      chapterId: z.string(),
      chapterTitle: z.string(),
      reason: z.enum(['ambiguous', 'uncertain', 'region', 'rejected', 'not-mutual']),
      best: chapterTrackCandidateSchema.nullable(),
      candidates: listFromNull(chapterTrackCandidateSchema),
    }),
  ),
  noTrack: listFromNull(z.object({ chapterId: z.string(), chapterTitle: z.string() })),
  unmatched: listFromNull(trackRefSchema),
  pickupTracks: listFromNull(z.object({ trackGuid: z.string(), trackName: z.string(), chapterId: z.string(), chapterTitle: z.string() })),
  new: listFromNull(trackRefSchema),
  changed: listFromNull(trackRefSchema),
  renamed: listFromNull(z.object({ guid: z.string(), name: z.string(), previousName: z.string() })),
  missing: listFromNull(z.object({ trackGuid: z.string(), name: z.string(), chapterId: z.string() })),
}) satisfies z.ZodType<ChapterSyncPreview>;
