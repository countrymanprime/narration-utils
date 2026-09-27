// The browser mock's script markup layer (prep-depth.prd.md Phase 5). It keeps its spans in memory and checks each one
// against the mock manuscript's current text the way apps/desktop/internal/prepmarkup does: a span whose words are no
// longer under it (whitespace aside) comes back stale at its stored offsets, and one whose line is gone has no paragraph.
// It does not re-find a span after a whitespace edit before it (the host's nonSpaceStart), since nothing in the mock edits
// the text.
import type { ManuscriptChapter, ManuscriptParagraph, PrepMarkupApi, PrepMarkupKind, PrepMarkupSpan } from '../types';
import { wireClone } from './mockFixtures';

/** One seeded span, placed by the words it covers in a line of a listable chapter, the way a narrator would place it. */
type PrepMarkupSeedSpan = {
  /** Which narration chapter, counting from 0 in reading order. */
  chapter: number;
  /** Which line of that chapter, counting from 0. */
  line: number;
  /** The words to mark; the first occurrence in the line. */
  words: string;
  kind: PrepMarkupKind;
  value?: string;
  /** Seeds a stale span: `text_changed` records other words under the same offsets (`was`), `paragraph_missing` points
   * at a line that is no longer in the chapter. */
  stale?: { reason: 'text_changed'; was: string } | { reason: 'paragraph_missing' };
};

export type PrepMarkupSeed = PrepMarkupSeedSpan[];

type Stored = Omit<PrepMarkupSpan, 'paragraph' | 'stale' | 'staleReason'>;

const squash = (text: string) => text.trim().split(/\s+/).filter(Boolean).join(' ');

export function createPrepMarkupMock(
  ready: Promise<unknown>,
  chapters: () => ManuscriptChapter[],
  paragraphs: () => ManuscriptParagraph[],
  seed: PrepMarkupSeed = [],
): PrepMarkupApi {
  let nextId = 1;
  let stored: Stored[] | undefined;
  const createdAt = '2026-09-27T12:00:00.000Z';

  // Seeds are placed once the mock manuscript has loaded (the Alice text arrives asynchronously).
  const spans = async (): Promise<Stored[]> => {
    await ready;
    if (stored) return stored;
    const narration = chapters().filter((chapter) => (chapter.contentKind ?? 'narration') === 'narration');
    stored = seed.flatMap((item): Stored[] => {
      const chapter = narration[item.chapter];
      const line = chapter ? paragraphs().filter((paragraph) => paragraph.chapterId === chapter.id)[item.line] : undefined;
      const at = line?.text.indexOf(item.words) ?? -1;
      if (!chapter || !line || at < 0) return [];
      const staleText = item.stale?.reason === 'text_changed' ? item.stale.was : undefined;
      return [
        {
          id: `markup-${nextId++}`,
          chapterId: chapter.id,
          paragraphId: item.stale?.reason === 'paragraph_missing' ? `${line.id}-removed` : line.id,
          start: at,
          end: at + item.words.length,
          anchorText: staleText ?? item.words,
          kind: item.kind,
          value: item.value ?? '',
          createdAt,
        },
      ];
    });
    return stored;
  };

  const resolve = (span: Stored): PrepMarkupSpan => {
    const line = paragraphs().find((paragraph) => paragraph.id === span.paragraphId && paragraph.chapterId === span.chapterId);
    if (!line) return { ...span, paragraph: null, stale: true, staleReason: 'paragraph_missing' };
    const fresh = span.end <= line.text.length && squash(line.text.slice(span.start, span.end)) === squash(span.anchorText);
    return fresh ? { ...span, paragraph: line.index, stale: false } : { ...span, paragraph: line.index, stale: true, staleReason: 'text_changed' };
  };

  const order = (a: PrepMarkupSpan, b: PrepMarkupSpan) =>
    (a.paragraph ?? Number.MAX_SAFE_INTEGER) - (b.paragraph ?? Number.MAX_SAFE_INTEGER) || a.start - b.start || a.id.localeCompare(b.id);

  return {
    prepMarkupList: async (chapterId) => {
      const all = await spans();
      return wireClone({
        chapterId,
        spans: all
          .filter((span) => span.chapterId === chapterId)
          .map(resolve)
          .sort(order),
      });
    },
    prepMarkupSave: async (chapterId, paragraphId, start, end, kind, value) => {
      const all = await spans();
      const line = paragraphs().find((paragraph) => paragraph.id === paragraphId && paragraph.chapterId === chapterId);
      if (!line) throw new Error('that line is no longer in this chapter');
      if (start < 0 || end > line.text.length || start >= end) throw new Error('invalid markup range');
      let from = start;
      let to = end;
      while (from < to && /\s/.test(line.text[from])) from++;
      while (to > from && /\s/.test(line.text[to - 1])) to--;
      if (from === to) throw new Error('select the words to mark');
      const trimmed = value.trim();
      if (kind === 'stress' && trimmed) throw new Error('a stress mark has no value');
      if (kind === 'pause' && trimmed !== 'short' && trimmed !== 'long') throw new Error('a pause is short or long');
      if (kind === 'character_tag' && !trimmed) throw new Error('a character tag needs a name');
      const existing = all.find(
        (span) =>
          span.chapterId === chapterId &&
          span.paragraphId === paragraphId &&
          span.start === from &&
          span.end === to &&
          span.kind === kind &&
          span.value === trimmed,
      );
      if (existing) return wireClone(resolve(existing));
      const span: Stored = {
        id: `markup-${nextId++}`,
        chapterId,
        paragraphId,
        start: from,
        end: to,
        anchorText: line.text.slice(from, to),
        kind,
        value: trimmed,
        createdAt: new Date().toISOString(),
      };
      all.push(span);
      return wireClone(resolve(span));
    },
    prepMarkupDelete: async (chapterId, id) => {
      const all = await spans();
      stored = all.filter((span) => !(span.chapterId === chapterId && span.id === id));
    },
  };
}
