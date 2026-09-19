import type { ManuscriptChapter, ManuscriptParagraph, TeleprompterEvent, TeleprompterPosition, TeleprompterScript, TeleprompterState } from '../../types';

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
};

export const initialSession: Session = { script: null, position: null, cursor: 0, skipped: [], heard: '' };

function withPosition(session: Session, position: TeleprompterPosition): Session {
  const cursor = nextCursor(session.cursor, position);
  const added = position.jump === 'skip' && position.skipped ? position.skipped : null;
  const kept = [...session.skipped, ...(added ? [added] : [])].filter(([, to]) => to <= cursor);
  // Rows are memoized on this list, so an unchanged one must keep its identity.
  const skipped = !added && kept.length === session.skipped.length ? session.skipped : kept;
  return { ...session, position, cursor, skipped };
}

export function reduceEvent(session: Session, event: TeleprompterEvent): Session {
  switch (event.type) {
    case 'script':
      return { ...initialSession, script: event };
    case 'position':
      return withPosition(session, event);
    case 'partial':
      return { ...session, heard: event.words.map((word) => word.word).join(' ') };
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
  if (!session.position) return snapshot;
  return { ...snapshot, position: session.position, cursor: session.cursor, skipped: session.skipped, heard: session.heard };
}
