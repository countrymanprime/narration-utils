import type { ManuscriptChapter, RetailSample } from '../../types';
import { formatMinutesSeconds } from '../../state';

/** The retail sample as the reader marks it (Phase 5, C10, ADR 0152): the global paragraph indexes it spans (the rows'
 * `data-paragraph`), the chapters it touches, and its length for the label. */
export type RetailSampleRange = { start: number; end: number; chapterIds: Set<string>; length: string };

/** Maps a sample's paragraph ids onto the chapter list's own `paragraphIds`, so the marker needs no paragraph body. A
 * sample whose ids the chapters do not have (an older manuscript) marks nothing. */
export function retailSampleRange(chapters: ManuscriptChapter[], sample: RetailSample | null): RetailSampleRange | undefined {
  if (!sample) return undefined;
  const indexOf = new Map<string, number>();
  for (const chapter of chapters) for (const row of chapter.paragraphIds ?? []) indexOf.set(row.id, row.index);
  const start = indexOf.get(sample.startParagraphId);
  const end = indexOf.get(sample.endParagraphId);
  if (start === undefined || end === undefined) return undefined;
  const chapterIds = new Set(
    chapters.filter((chapter) => (chapter.paragraphIds ?? []).some((row) => row.index >= start && row.index <= end)).map((chapter) => chapter.id),
  );
  return { start, end, chapterIds, length: formatMinutesSeconds(sample.seconds) };
}
