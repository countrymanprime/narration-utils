import { z } from 'zod';
import type {
  ChapterCandidate,
  ChapterSuggestion,
  ChapterTrackCandidate,
  ChapterTrackMapping,
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
}) satisfies z.ZodType<TrackMapping>;

/** `mappings` is a null slice on the wire when nothing has been confirmed yet. */
export const chapterTrackMappingSchema = z.object({
  documentId: z.string(),
  mappings: listFromNull(trackMappingSchema),
}) satisfies z.ZodType<ChapterTrackMapping>;

const chapterTrackCandidateSchema = z.object({
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

const matchStatusSchema = z.enum(['confirmed', 'matched', 'uncertain', 'ambiguous', 'none']);

const chapterCandidateSchema = z.object({
  chapterId: z.string(),
  chapterTitle: z.string(),
  score: z.number().min(0).max(1),
  source: z.enum(['confirmed', 'track-name', 'region-name']),
  region: z.object({ name: z.string(), start: z.number(), end: z.number() }).nullable(),
}) satisfies z.ZodType<ChapterCandidate>;

export const chapterSuggestionSchema = z.object({
  projectFile: z.string(),
  savedAt: z.string(),
  basis: z.enum(['armed', 'selected', 'none']),
  track: z.object({ guid: z.string(), name: z.string(), index: z.number().int() }).nullable(),
  status: matchStatusSchema,
  chapter: chapterCandidateSchema.nullable(),
  candidates: z.array(chapterCandidateSchema),
  warnings: z.array(z.enum(['confirmed-track-missing', 'confirmed-track-renamed', 'confirmed-links-conflict', 'confirmed-chapter-missing'])),
}) satisfies z.ZodType<ChapterSuggestion>;

export const chapterTrackMatchSchema = z.object({
  chapterId: z.string(),
  chapterTitle: z.string(),
  projectFile: z.string(),
  savedAt: z.string(),
  status: matchStatusSchema,
  track: chapterTrackCandidateSchema.nullable(),
  candidates: z.array(chapterTrackCandidateSchema),
  warnings: z.array(z.enum(['confirmed-track-missing', 'confirmed-track-renamed', 'confirmed-links-conflict'])),
  tracks: z.array(z.object({ guid: z.string(), name: z.string(), index: z.number().int() })),
  recordedEnd: recordedEndSchema.nullable(),
}) satisfies z.ZodType<ChapterTrackMatch>;
