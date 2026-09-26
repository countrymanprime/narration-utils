// The golden payloads for the manuscript, its reader and notes: which schema owns each file in tests/fixtures/contracts/ (see index.ts).
import type { z } from 'zod';
import {
  bookmarkSchema,
  chapterKindResultSchema,
  chapterSchema,
  chaptersSchema,
  noteSchema,
  notesSchema,
  paragraphsSchema,
  readerSchema,
  readerStateSchema,
  searchHitsSchema,
  workJobSchema,
} from '../schemas/manuscript';

export const manuscriptGoldens: Record<string, z.ZodType> = {
  'manuscript-import-selected.json': workJobSchema,
  'manuscript-import-preview.json': workJobSchema,
  'manuscript-import-preview-repaired.json': workJobSchema,
  'manuscript-import-preview-text-subtitle.json': workJobSchema,
  'manuscript-import-success.json': workJobSchema,
  'manuscript-chapters.json': chaptersSchema,
  'manuscript-chapter-status.json': chapterSchema,
  'manuscript-chapter-kind-removed.json': chapterKindResultSchema,
  'manuscript-paragraphs.json': paragraphsSchema,
  'manuscript-search.json': searchHitsSchema,
  'manuscript-note.json': noteSchema,
  'manuscript-notes.json': notesSchema,
  'manuscript-notes-empty.json': notesSchema,
  'manuscript-bookmark.json': bookmarkSchema,
  'manuscript-reader-state.json': readerStateSchema,
  'manuscript-reader-state-empty.json': readerStateSchema,
  'manuscript-reader.json': readerSchema,
  'manuscript-chapters-measured.json': chaptersSchema,
  'manuscript-chapters-recorded.json': chaptersSchema,
};
