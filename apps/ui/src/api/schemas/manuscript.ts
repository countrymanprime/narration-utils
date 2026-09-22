import { z } from 'zod';
import type {
  ManuscriptChapter,
  ManuscriptCharacterCandidate,
  ManuscriptFileSelection,
  ManuscriptImportPreview,
  ManuscriptImportSection,
  ManuscriptNote,
  ManuscriptParagraph,
  ManuscriptReader,
  ReaderBookmark,
  ReaderState,
  SearchHit,
  TextSpan,
  WorkJob,
} from '../contracts/manuscript';
import { listFromNull, optionalFromNull } from './base';

const contentKindSchema = z.enum(['narration', 'opening', 'reference']);

// The host sends an empty string for the content kind of a manuscript imported before structural classification; the contract says omitted.
const contentKindFromWire = z
  .union([contentKindSchema, z.literal('')])
  .optional()
  .transform((value) => (value === '' ? undefined : value));

export const chapterSchema = z.object({
  id: z.string(),
  title: z.string(),
  subtitle: z.string().optional(),
  index: z.number(),
  wordCount: z.number(),
  recordedFraction: z.number().optional(),
  status: z.enum(['not_started', 'recording', 'editing', 'proofing', 'finalized']),
  contentKind: contentKindFromWire,
  paragraphIds: z.array(z.object({ id: z.string(), index: z.number() })).optional(),
}) satisfies z.ZodType<ManuscriptChapter>;

const spanSchema = z.object({ start: z.number(), end: z.number(), style: z.enum(['bold', 'italic', 'underline']) }) satisfies z.ZodType<TextSpan>;

const paragraphSchema = z.object({
  id: z.string(),
  chapterId: z.string(),
  chapter: z.string(),
  index: z.number(),
  sourceLine: z.number().optional(),
  text: z.string(),
  spans: z.array(spanSchema).optional(),
  entityIds: listFromNull(z.string()),
}) satisfies z.ZodType<ManuscriptParagraph>;

export const noteSchema = z.object({
  id: z.string(),
  chapter: z.string(),
  chapterId: optionalFromNull(z.string()),
  paragraph: z.number(),
  paragraphId: optionalFromNull(z.string()),
  text: z.string(),
  createdAt: z.string(),
  anchorStart: optionalFromNull(z.number()),
  anchorEnd: optionalFromNull(z.number()),
  anchorText: optionalFromNull(z.string()),
}) satisfies z.ZodType<ManuscriptNote>;

export const bookmarkSchema = z.object({
  id: z.string(),
  kind: z.enum(['chapter', 'line', 'note']),
  chapter: z.string(),
  chapterId: optionalFromNull(z.string()),
  paragraph: optionalFromNull(z.number()),
  paragraphId: optionalFromNull(z.string()),
  sourceLine: optionalFromNull(z.number()),
  noteId: optionalFromNull(z.string()),
  createdAt: z.string(),
}) satisfies z.ZodType<ReaderBookmark>;

// A reader that has not been opened yet has null for every optional field and a null expanded list (manuscript/reader.go).
export const readerStateSchema = z.object({
  activeChapter: optionalFromNull(z.string()),
  activeSourceLine: optionalFromNull(z.number()),
  expandedChapters: optionalFromNull(z.array(z.string())),
  bookmarks: listFromNull(bookmarkSchema),
}) satisfies z.ZodType<ReaderState>;

const searchHitSchema = z.object({
  chapter: z.string(),
  chapterId: optionalFromNull(z.string()),
  paragraph: z.number(),
  paragraphId: optionalFromNull(z.string()),
  sourceLine: optionalFromNull(z.number()),
  excerpt: z.string(),
}) satisfies z.ZodType<SearchHit>;

export const readerSchema = z.object({
  chapters: listFromNull(chapterSchema),
  paragraphs: listFromNull(paragraphSchema),
  notes: listFromNull(noteSchema),
}) satisfies z.ZodType<ManuscriptReader>;

const importSectionSchema = z.object({
  id: z.string(),
  title: z.string(),
  subtitle: z.string().optional(),
  contentKind: contentKindSchema,
  paragraphCount: z.number(),
}) satisfies z.ZodType<ManuscriptImportSection>;

const characterCandidateSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  sourceSectionId: z.string(),
  properties: z.array(z.object({ key: z.string(), value: z.string() })).optional(),
}) satisfies z.ZodType<ManuscriptCharacterCandidate>;

const importPreviewSchema = z.object({
  format: z.enum(['docx', 'markdown', 'pdf']),
  sourceName: z.string(),
  paragraphCount: z.number(),
  chapterTitles: listFromNull(z.string()),
  sections: z.array(importSectionSchema).optional(),
  characterCandidates: z.array(characterCandidateSchema).optional(),
  notices: z.array(z.string()).optional(),
}) satisfies z.ZodType<ManuscriptImportPreview>;

export const fileSelectionSchema = z.object({ selected: z.boolean(), jobId: z.string().optional() }) satisfies z.ZodType<ManuscriptFileSelection>;

/**
 * A manuscript import or a Story Bible build. A job that has just started has no log lines, which the host sends as null; an idle
 * Story Bible job has a null id.
 */
export const workJobSchema = z.object({
  id: z.string().nullable(),
  kind: z.enum(['manuscript_import', 'story_bible']),
  phase: z.enum(['idle', 'preparing', 'ready', 'committing', 'running', 'success', 'cancelled', 'error']),
  message: z.string(),
  percent: z.number(),
  logs: listFromNull(z.string()),
  elapsed: z.number(),
  preview: importPreviewSchema.nullish(),
  requiresReset: z.boolean().optional(),
  result: z
    .object({
      id: z.string().optional(),
      format: z.string().optional(),
      sourceName: z.string().optional(),
      importedAt: z.string().optional(),
      message: z.string().optional(),
    })
    .nullish(),
  error: z.string().optional(),
}) satisfies z.ZodType<WorkJob>;

// What each list binding returns. The host sends null for an empty list in places (a nil Go slice), so every one accepts it.
export const chaptersSchema = listFromNull(chapterSchema);
export const paragraphsSchema = listFromNull(paragraphSchema);
export const notesSchema = listFromNull(noteSchema);
export const searchHitsSchema = listFromNull(searchHitSchema);
