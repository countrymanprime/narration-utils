import { z } from 'zod';
import type { ChapterSyncBatch, ChapterSyncChapter, ChapterSyncPreview, ChapterSyncState, ChapterSyncTrackRef } from '../contracts/chapterSync';
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
  trigger: z.enum(['consent', 'daw-link', 'import', 'attach', 'undo', 'watch']),
  linked: listFromNull(trackMappingSchema),
  newTracks: listFromNull(trackRefSchema),
}) satisfies z.ZodType<ChapterSyncBatch>;

const chapterSchema = z
  .object({
    chapterId: z.string(),
    chapterTitle: z.string(),
    trackGuid: z.string(),
    trackName: z.string(),
    origin: z.enum(['', 'manual', 'auto']),
    freshness: z.enum(['current', 'stale', 'never']),
    reasons: listFromNull(z.string()),
    checkedAt: z.string().nullable(),
    checking: z.boolean(),
    trackChangedAt: z.string().nullable(),
    newestSourceAt: z.string().nullable(),
    lastChanged: z.string().nullable(),
  })
  .refine((row) => row.freshness === 'never' || row.checkedAt !== null, {
    message: 'a current or stale check has the time it finished',
    path: ['checkedAt'],
  })
  .refine((row) => (row.trackGuid === '') === (row.origin === ''), {
    message: 'a chapter has a track exactly when its link has an origin',
    path: ['origin'],
  }) satisfies z.ZodType<ChapterSyncChapter>;

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
    unsavedEdits: z.boolean(),
    activity: listFromNull(batchSchema).refine((list) => list.length <= 20, { message: 'the host keeps at most 20 activity rows' }),
    chapters: listFromNull(chapterSchema),
    background: z.object({
      enabled: z.boolean(),
      wait: z.enum(['', 'off', 'busy', 'model', 'battery', 'recording', 'quiet', 'nothing']),
    }),
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
