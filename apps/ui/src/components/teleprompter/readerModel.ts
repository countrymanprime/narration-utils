import { entityAnnotations, noteAnnotations } from '../manuscript/annotations';
import type {
  GuideEntity,
  ManuscriptChapter,
  ManuscriptNote,
  ManuscriptParagraph,
  TeleprompterEvent,
  TeleprompterFlag,
  TeleprompterPosition,
  TeleprompterScript,
  TeleprompterState,
} from '../../types';

/** The sidecar tokenizes with Python's `str.split()`; any run of whitespace separates words. */
export const tokenize = (text: string): string[] => text.split(/\s+/).filter(Boolean);

/** The words of `text` and the whitespace that follows each one (empty after the last), so line breaks can be redrawn. */
export function splitWords(text: string): { words: string[]; gaps: string[] } {
  const words: string[] = [];
  const gaps: string[] = [];
  for (const match of text.matchAll(/(\S+)(\s*)/g)) {
    words.push(match[1]);
    gaps.push(match[2]);
  }
  return { words, gaps };
}

export type ReaderRow = {
  key: string;
  kind: 'title' | 'paragraph';
  /** Index of the row's first word in the chapter's flat word list. */
  start: number;
  /** Null when our tokenization disagrees with the sidecar's, so the row is shown but not tracked. */
  words: string[] | null;
  /** The whitespace after each word, aligned with `words`; null exactly when `words` is. */
  gaps: string[] | null;
  text: string;
};

/**
 * Lays the sidecar's spans over the chapter text the reader has. A row whose
 * word count differs from its span is kept as plain text: the spans stay the
 * authority on positions, so one drifted paragraph cannot shift the rest.
 */
export function buildRows(script: TeleprompterScript, chapter: Pick<ManuscriptChapter, 'title' | 'subtitle'>, paragraphs: ManuscriptParagraph[]): ReaderRow[] {
  const byId = new Map(paragraphs.map((paragraph) => [paragraph.id, paragraph]));
  const rows: ReaderRow[] = [];
  for (const span of script.spans) {
    if (span.kind === 'title') {
      const candidates = [chapter.title, chapter.subtitle ? `${chapter.title} ${chapter.subtitle}` : ''].filter(Boolean);
      const fit = candidates.find((text) => tokenize(text).length === span.count);
      const text = fit ?? candidates[0] ?? script.chapter.title;
      const split = fit ? splitWords(fit) : null;
      rows.push({ key: span.id, kind: 'title', start: span.start, words: split?.words ?? null, gaps: split?.gaps ?? null, text });
      continue;
    }
    const paragraph = byId.get(span.id);
    if (!paragraph) continue;
    const split = splitWords(paragraph.text);
    const tracked = split.words.length === span.count;
    rows.push({
      key: span.id,
      kind: 'paragraph',
      start: span.start,
      words: tracked ? split.words : null,
      gaps: tracked ? split.gaps : null,
      text: paragraph.text,
    });
  }
  return rows;
}

/** The chapter as plain rows, for reading it before a session (and so its spans) exists. */
export function previewRows(chapter: Pick<ManuscriptChapter, 'title' | 'subtitle'>, paragraphs: ManuscriptParagraph[]): ReaderRow[] {
  const title = chapter.subtitle ? `${chapter.title} ${chapter.subtitle}` : chapter.title;
  return [
    { key: 'title', kind: 'title', start: 0, words: null, gaps: null, text: title },
    ...paragraphs.map((paragraph): ReaderRow => ({ key: paragraph.id, kind: 'paragraph', start: 0, words: null, gaps: null, text: paragraph.text })),
  ];
}

/** The character range [start, end) of each word of `text`: the words `splitWords` finds, in the same order. */
export function wordOffsets(text: string): Array<[number, number]> {
  return Array.from(text.matchAll(/\S+/g), (match): [number, number] => [match.index, match.index + match[0].length]);
}

/**
 * Marks on the reader's words (teleprompter-manuscript-integration.prd.md Phase 5). The Manuscript reader annotates by
 * character offsets (`manuscript/annotations.ts`); the read-aloud reader shows words, so a mark is mapped onto every word
 * it touches: a name across a word boundary ("Mr. Hale") marks both words, a mention inside a word ("Hale" in "Hale's")
 * marks the whole word, and a range of only whitespace marks nothing. `value` is what the mark points at, kept generic so
 * Phase 7's flag marks travel the same path as the story bible and note marks.
 */
export type TextMark<T> = { id: string; start: number; end: number; value: T };
/** A mark on a row's words: [from, to) indices into that row's own word list. */
export type WordMark<T> = { id: string; from: number; to: number; value: T };
/** A run of words that carry the same marks, outermost (longest) first, so the shortest mark is the innermost layer. */
export type WordSegment<T> = { from: number; to: number; marks: WordMark<T>[] };

export function marksOnWords<T>(text: string, marks: TextMark<T>[]): WordMark<T>[] {
  const offsets = wordOffsets(text);
  return marks.flatMap((mark) => {
    const start = Math.max(mark.start, 0);
    const end = Math.min(mark.end, text.length);
    if (!(start < end)) return [];
    const touched = offsets.flatMap(([from, to], index) => (from < end && to > start ? [index] : []));
    return touched.length ? [{ id: mark.id, from: touched[0], to: touched[touched.length - 1] + 1, value: mark.value }] : [];
  });
}

const markOrder = <T>(a: WordMark<T>, b: WordMark<T>): number => b.to - b.from - (a.to - a.from) || a.id.localeCompare(b.id);

/** Splits a row of `count` words at every mark boundary, so each segment renders its marks as nested layers around its words. */
export function segmentWords<T>(count: number, marks: WordMark<T>[]): WordSegment<T>[] {
  const inside = marks.filter((mark) => mark.from < count && mark.to > mark.from);
  const points = Array.from(new Set([0, count, ...inside.flatMap((mark) => [mark.from, Math.min(mark.to, count)])])).sort((a, b) => a - b);
  return points.slice(0, -1).map((from, index) => {
    const to = points[index + 1];
    return { from, to, marks: inside.filter((mark) => mark.from <= from && mark.to >= to).sort(markOrder) };
  });
}

/** What a reader mark opens in the side rail: a story bible entry or a note (Phase 5), or a suspected flag (Phase 7, `readerFlags.ts`). */
export type ReaderMarkTarget = { kind: 'entity'; entity: GuideEntity } | { kind: 'note'; note: ManuscriptNote } | { kind: 'flag'; flag: TeleprompterFlag };
export type ReaderMark = WordMark<ReaderMarkTarget>;

/**
 * The story bible and note marks of a chapter's paragraphs, by paragraph id (a paragraph row's `key`, in both `buildRows`
 * and `previewRows`). Mentions and anchors come from the helpers the Manuscript reader uses, so both readers mark the
 * same words. A row's marks are in reading order; a paragraph with no marks has no entry. Formatting spans are out of
 * scope for the reader (ADR 0014).
 */
export function readerMarks(paragraphs: ManuscriptParagraph[], entities: GuideEntity[], notes: ManuscriptNote[]): Map<string, ReaderMark[]> {
  const entitiesById = new Map(entities.map((entity) => [entity.id, entity]));
  const byRow = new Map<string, ReaderMark[]>();
  for (const paragraph of paragraphs) {
    const annotations = [...entityAnnotations(paragraph, entitiesById), ...noteAnnotations(paragraph, notes)];
    const marks = marksOnWords<ReaderMarkTarget>(
      paragraph.text,
      annotations.map((item) => ({
        id: item.id,
        start: item.start,
        end: item.end,
        value: item.kind === 'note' ? { kind: 'note', note: item.note! } : { kind: 'entity', entity: item.entity! },
      })),
    );
    if (marks.length)
      byRow.set(
        paragraph.id,
        [...marks].sort((a, b) => a.from - b.from || a.id.localeCompare(b.id)),
      );
  }
  return byRow;
}

/**
 * The tracker can take back one word when a later reading of the same phrase
 * disagrees with an earlier one. Animating that would make the highlight
 * flicker, so a single-word backward step is ignored; anything bigger is the
 * narrator really going back and is followed.
 */
export function nextCursor(current: number, position: Pick<TeleprompterPosition, 'read' | 'jump'>): number {
  if (position.jump === null && position.read < current && current - position.read <= 1) return current;
  return position.read;
}

const CATCH_UP_WORDS_PER_STEP = 6;

/** One animation step toward `target`: a word at a time when close, faster over a big gap, never past it or backward. */
export function pacedStep(displayed: number, target: number): number {
  if (target <= displayed) return target;
  return Math.min(target, displayed + Math.max(1, Math.ceil((target - displayed) / CATCH_UP_WORDS_PER_STEP)));
}

export type Session = {
  script: TeleprompterScript | null;
  position: TeleprompterPosition | null;
  /** Where the highlight should be, after ignoring one-word backward corrections. */
  cursor: number;
  /** Word ranges [from, to) the narrator skipped past. */
  skipped: Array<[number, number]>;
  heard: string;
  /** Every suspected flag the sidecar raised this session (ADR 0115), once each, in arrival order; the view picks which to show. */
  flags: TeleprompterFlag[];
};

export const initialSession: Session = { script: null, position: null, cursor: 0, skipped: [], heard: '', flags: [] };

function withPosition(session: Session, position: TeleprompterPosition): Session {
  const cursor = nextCursor(session.cursor, position);
  const added = position.jump === 'skip' && position.skipped ? position.skipped : null;
  const kept = [...session.skipped, ...(added ? [added] : [])].filter(([, to]) => to <= cursor);
  // Rows are memoized on this list, so an unchanged one must keep its identity.
  const skipped = !added && kept.length === session.skipped.length ? session.skipped : kept;
  return { ...session, position, cursor, skipped };
}

const sameFlag = (a: TeleprompterFlag, b: TeleprompterFlag): boolean => a.kind === b.kind && a.start === b.start && a.end === b.end && a.heard === b.heard;

export function reduceEvent(session: Session, event: TeleprompterEvent): Session {
  switch (event.type) {
    case 'script':
      return { ...initialSession, script: event };
    case 'position':
      return withPosition(session, event);
    case 'partial':
      return { ...session, heard: event.words.map((word) => word.word).join(' ') };
    // The same suspected problem raised again (a misread repeated the same way after going back) is one flag, not two.
    case 'flag':
      return session.flags.some((flag) => flag.id === event.id || sameFlag(flag, event)) ? session : { ...session, flags: [...session.flags, event] };
    default:
      return session;
  }
}

export function sessionFromState(state: TeleprompterState): Session {
  if (!state.script) return initialSession;
  const session: Session = { ...initialSession, script: state.script };
  return state.position ? withPosition(session, state.position) : session;
}

/**
 * Folds the host's snapshot into a session that live events may already be
 * describing. A snapshot is older than any event that has arrived, so it only
 * supplies what is missing: the whole session if nothing has arrived, or just
 * the script if a position got here first.
 */
export function hydrateSession(session: Session, state: TeleprompterState): Session {
  if (session.script) return session;
  const snapshot = sessionFromState(state);
  if (!session.position) return session.flags.length ? { ...snapshot, flags: session.flags } : snapshot;
  return { ...snapshot, position: session.position, cursor: session.cursor, skipped: session.skipped, heard: session.heard, flags: session.flags };
}
