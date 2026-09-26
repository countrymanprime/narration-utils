import { z } from 'zod';
import type {
  ChapterCandidate,
  ChapterRegionPlan,
  ChapterRegionsCreated,
  ChaptersForTracksEntry,
  ChaptersForTracksResult,
  ChapterSuggestion,
  ChapterTrackCandidate,
  ChapterTrackLink,
  ChapterTrackLinks,
  ChapterTrackMapping,
  ChapterTrackSetResult,
  ChapterTrackSummary,
  ChapterTrackMatch,
  RecordedEnd,
  TrackMapping,
} from '../contracts/chapterTrackMap';
import { listFromNull } from './base';

export const trackMappingSchema = z.object({
  trackGuid: z.string(),
  chapterId: z.string(),
  chapterTitle: z.string(),
  confirmedAt: z.string(),
  origin: z.enum(['manual', 'auto']),
  match: z.object({ score: z.number().min(0).max(1), kind: z.enum(['exact', 'contained', 'previous-link']) }).nullable(),
}) satisfies z.ZodType<TrackMapping>;

/** `mappings` is a null slice on the wire when nothing has been confirmed yet. */
export const chapterTrackMappingSchema = z.object({
  documentId: z.string(),
  mappings: listFromNull(trackMappingSchema),
}) satisfies z.ZodType<ChapterTrackMapping>;

export const chapterTrackCandidateSchema = z.object({
  trackGuid: z.string(),
  trackName: z.string(),
  trackIndex: z.number().int(),
  score: z.number().min(0).max(1),
  source: z.enum(['confirmed', 'track-name', 'region-name']),
  region: z.object({ name: z.string(), start: z.number(), end: z.number() }).nullable(),
}) satisfies z.ZodType<ChapterTrackCandidate>;

export const recordedEndSchema = z.object({
  projectTime: z.number(),
  itemGuid: z.string(),
  takeGuid: z.string(),
  sourceFile: z.string(),
  sourceStart: z.number(),
  sourceTime: z.number(),
  sourceAvailable: z.boolean(),
  supported: z.boolean(),
  approximate: z.boolean(),
}) satisfies z.ZodType<RecordedEnd>;

const matchWarningSchema = z.enum(['confirmed-track-missing', 'confirmed-track-renamed', 'confirmed-links-conflict']);

const matchStatusSchema = z.enum(['confirmed', 'matched', 'uncertain', 'ambiguous', 'none']);

const chapterCandidateSchema = z.object({
  chapterId: z.string(),
  chapterTitle: z.string(),
  score: z.number().min(0).max(1),
  source: z.enum(['confirmed', 'track-name', 'region-name']),
  region: z.object({ name: z.string(), start: z.number(), end: z.number() }).nullable(),
}) satisfies z.ZodType<ChapterCandidate>;

// trackDirectionWarningSchema is the warning set the matcher's track-to-chapter direction can report (ForTrack, ADR
// 0113): every ForChapter warning plus confirmed-chapter-missing, which only that direction can raise.
const trackDirectionWarningSchema = z.enum(['confirmed-track-missing', 'confirmed-track-renamed', 'confirmed-links-conflict', 'confirmed-chapter-missing']);

export const chapterSuggestionSchema = z.object({
  projectFile: z.string(),
  savedAt: z.string(),
  basis: z.enum(['armed', 'selected', 'none']),
  track: z.object({ guid: z.string(), name: z.string(), index: z.number().int() }).nullable(),
  status: matchStatusSchema,
  chapter: chapterCandidateSchema.nullable(),
  candidates: z.array(chapterCandidateSchema),
  warnings: z.array(trackDirectionWarningSchema),
}) satisfies z.ZodType<ChapterSuggestion>;

// ChaptersForTracksEntry.status is '' only alongside `error` (the requested GUID is not in the current project), so
// it is not folded into matchStatusSchema itself: that enum stays the actual matcher statuses everywhere else.
const chaptersForTracksEntrySchema = z.object({
  status: z.union([matchStatusSchema, z.literal('')]),
  chapter: chapterCandidateSchema.nullable(),
  candidates: listFromNull(chapterCandidateSchema),
  warnings: listFromNull(trackDirectionWarningSchema),
  error: z.string().optional(),
}) satisfies z.ZodType<ChaptersForTracksEntry>;

/** ChaptersForTracks' answer (diagnostics-delivery-and-cleanup-tools PRD Phase 8 remainder). */
export const chaptersForTracksSchema = z.object({
  projectFile: z.string(),
  savedAt: z.string(),
  tracks: z.record(z.string(), chaptersForTracksEntrySchema),
}) satisfies z.ZodType<ChaptersForTracksResult>;

export const chapterTrackMatchSchema = z.object({
  chapterId: z.string(),
  chapterTitle: z.string(),
  projectFile: z.string(),
  savedAt: z.string(),
  status: matchStatusSchema,
  track: chapterTrackCandidateSchema.nullable(),
  candidates: z.array(chapterTrackCandidateSchema),
  warnings: z.array(matchWarningSchema),
  tracks: z.array(z.object({ guid: z.string(), name: z.string(), index: z.number().int() })),
  recordedEnd: recordedEndSchema.nullable(),
}) satisfies z.ZodType<ChapterTrackMatch>;

export const chapterTrackSetSchema = z.object({
  documentId: z.string(),
  link: trackMappingSchema,
  displaced: trackMappingSchema.nullable(),
  mappings: listFromNull(trackMappingSchema),
}) satisfies z.ZodType<ChapterTrackSetResult>;

const chapterTrackSummarySchema = z.object({
  guid: z.string(),
  index: z.number().int(),
  name: z.string(),
  color: z.string(),
  muted: z.boolean(),
  soloed: z.boolean(),
  itemCount: z.number().int().nonnegative(),
  playableCount: z.number().int().nonnegative(),
  missingSourceCount: z.number().int().nonnegative(),
  unsupportedCount: z.number().int().nonnegative(),
  span: z.object({ start: z.number(), end: z.number() }).nullable(),
  linkedChapterId: z.string(),
}) satisfies z.ZodType<ChapterTrackSummary>;

const chapterTrackLinkSchema = z.object({
  chapterId: z.string(),
  chapterTitle: z.string(),
  status: matchStatusSchema,
  track: chapterTrackCandidateSchema.nullable(),
  candidates: z.array(chapterTrackCandidateSchema),
  warnings: z.array(matchWarningSchema),
  links: z.array(trackMappingSchema),
  recordedEnd: recordedEndSchema.nullable(),
}) satisfies z.ZodType<ChapterTrackLink>;

export const chapterTrackLinksSchema = z.object({
  project: z.enum(['ready', 'none', 'choose', 'error']),
  message: z.string(),
  projectFile: z.string(),
  savedAt: z.string(),
  tracks: z.array(chapterTrackSummarySchema),
  chapters: z.array(chapterTrackLinkSchema),
}) satisfies z.ZodType<ChapterTrackLinks>;

const chapterRegionKindSchema = z.enum(['opening', 'chapter', 'closing']);

/** ChapterRegionsPreview's answer (reaper-automation-follow-through PRD Phase 7, credits-in-chapter-table PRD Phase 4). */
export const chapterRegionPlanSchema = z.object({
  project: z.enum(['ready', 'none', 'choose', 'error']),
  message: z.string(),
  projectFile: z.string(),
  savedAt: z.string(),
  rows: z.array(
    z.object({
      kind: chapterRegionKindSchema,
      chapterId: z.string(),
      title: z.string().min(1),
      trackGuid: z.string(),
      trackName: z.string(),
      start: z.number().min(0),
      end: z.number(),
      state: z.enum(['new', 'exists', 'moves', 'ambiguous']),
    }),
  ),
  skipped: z.array(z.object({ kind: chapterRegionKindSchema, chapterId: z.string(), title: z.string(), reason: z.string() })),
}) satisfies z.ZodType<ChapterRegionPlan>;

const count = z.number().int().min(0);

/** ChapterRegionsCreate's answer: the rows sent and create_regions' counts. */
export const chapterRegionsCreatedSchema = z.object({
  sent: count,
  created: count,
  existing: count,
  invalid: count,
  updated: count,
  ambiguous: count,
  failed: count,
}) satisfies z.ZodType<ChapterRegionsCreated>;
