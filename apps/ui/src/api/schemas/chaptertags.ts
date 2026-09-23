import { z } from 'zod';
import type { ChapterTagsChapter, ChapterTagsEmbedResult, ChapterTagsPreview } from '../contracts/chaptertags';
import { listFromNull } from './base';

const chapterTagsChapterSchema = z.object({
  title: z.string(),
  path: z.string(),
  rendered: z.boolean(),
}) satisfies z.ZodType<ChapterTagsChapter>;

export const chapterTagsPreviewSchema = z.object({
  chapters: listFromNull(chapterTagsChapterSchema),
  ready: z.boolean(),
}) satisfies z.ZodType<ChapterTagsPreview>;

export const chapterTagsEmbedResultSchema = z.object({ outputPath: z.string() }) satisfies z.ZodType<ChapterTagsEmbedResult>;
