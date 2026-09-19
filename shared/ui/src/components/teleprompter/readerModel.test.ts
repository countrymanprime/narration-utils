import { describe, expect, it } from 'vitest';
import {
  buildRows,
  hydrateSession,
  initialSession,
  nextCursor,
  pacedStep,
  previewRows,
  reduceEvent,
  sessionFromState,
  splitWords,
  tokenize,
} from './readerModel';
import type { ManuscriptParagraph, TeleprompterPosition, TeleprompterScript, TeleprompterState } from '../../types';

const script: TeleprompterScript = {
  type: 'script',
  chapter: { id: 'c1', title: 'CHAPTER ONE Down the Rabbit-Hole' },
  tokens: 11,
  spans: [
    { kind: 'title', id: 'c1', index: null, start: 0, count: 5 },
    { kind: 'paragraph', id: 'p1', index: 0, start: 5, count: 4 },
    { kind: 'paragraph', id: 'p2', index: 1, start: 9, count: 2 },
  ],
};

const paragraph = (id: string, index: number, text: string): ManuscriptParagraph => ({ id, chapterId: 'c1', chapter: 'c1', index, text, entityIds: [] });
const paragraphs = [paragraph('p1', 0, 'Alice was  beginning\nto'), paragraph('p2', 1, 'very tired')];

const position = (read: number, extra: Partial<TeleprompterPosition> = {}): TeleprompterPosition => ({
  type: 'position',
  read,
  committed: read,
  status: 'listening',
  jump: null,
  skipped: null,
  ...extra,
});

describe('tokenize', () => {
  it('splits on any run of whitespace like the sidecar does', () => {
    expect(tokenize('Alice was  beginning\nto get')).toEqual(['Alice', 'was', 'beginning', 'to', 'get']);
    expect(tokenize('   ')).toEqual([]);
  });
});

describe('splitWords', () => {
  it('keeps the whitespace after each word so line breaks survive', () => {
    expect(splitWords('one two\nthree  four')).toEqual({ words: ['one', 'two', 'three', 'four'], gaps: [' ', '\n', '  ', ''] });
  });
});

describe('hydrateSession', () => {
  const snapshot: TeleprompterState = { phase: 'running', message: '', engine: 'whisper', chapter: 'c1', script, position: position(3) };

  it('fills in a session the live events have not described yet', () => {
    expect(hydrateSession(initialSession, snapshot).cursor).toBe(3);
  });

  it('never replaces a session that already has a script', () => {
    const live = reduceEvent(reduceEvent(initialSession, script), position(9));

    expect(hydrateSession(live, snapshot)).toBe(live);
  });

  it('keeps a live position that arrived before the snapshot, taking only its script', () => {
    const live = reduceEvent(initialSession, position(9));

    const merged = hydrateSession(live, snapshot);

    expect(merged.script).toBe(script);
    expect(merged.cursor).toBe(9);
    expect(merged.position?.read).toBe(9);
  });
});

describe('buildRows', () => {
  it('records the whitespace after every tracked word', () => {
    const rows = buildRows(script, { title: 'CHAPTER ONE', subtitle: 'Down the Rabbit-Hole' }, paragraphs);

    expect(rows[1].gaps).toEqual([' ', '  ', '\n', '']);
  });

  it('maps every span onto the chapter text when the word counts agree', () => {
    const rows = buildRows(script, { title: 'CHAPTER ONE', subtitle: 'Down the Rabbit-Hole' }, paragraphs);

    expect(rows.map((row) => [row.kind, row.start, row.words?.length])).toEqual([
      ['title', 0, 5],
      ['paragraph', 5, 4],
      ['paragraph', 9, 2],
    ]);
  });

  it('shows a paragraph as plain text, without word tracking, when its word count disagrees with the sidecar', () => {
    const drifted = [paragraph('p1', 0, 'Alice was beginning'), paragraphs[1]];

    const rows = buildRows(script, { title: 'CHAPTER ONE', subtitle: 'Down the Rabbit-Hole' }, drifted);

    expect(rows[1].words).toBeNull();
    expect(rows[1].text).toBe('Alice was beginning');
  });

  it('drops spans whose paragraph is not in the reader', () => {
    const rows = buildRows(script, { title: 'CHAPTER ONE', subtitle: 'Down the Rabbit-Hole' }, [paragraphs[1]]);

    expect(rows.map((row) => row.key)).toEqual(['c1', 'p2']);
  });

  it('accepts a title that already carries its subtitle', () => {
    const rows = buildRows(script, { title: 'CHAPTER ONE Down the Rabbit-Hole' }, paragraphs);

    expect(rows[0].words).toHaveLength(5);
  });
});

describe('previewRows', () => {
  it('lists the title and every paragraph as untracked text before a session starts', () => {
    const rows = previewRows({ title: 'CHAPTER ONE', subtitle: 'Down the Rabbit-Hole' }, paragraphs);

    expect(rows.map((row) => [row.kind, row.words, row.text])).toEqual([
      ['title', null, 'CHAPTER ONE Down the Rabbit-Hole'],
      ['paragraph', null, 'Alice was  beginning\nto'],
      ['paragraph', null, 'very tired'],
    ]);
  });
});

describe('nextCursor', () => {
  it('follows forward movement', () => {
    expect(nextCursor(3, position(7))).toBe(7);
  });

  it('holds still for a one-word backward correction', () => {
    expect(nextCursor(7, position(6))).toBe(7);
  });

  it('follows a bigger backward move, and any jump', () => {
    expect(nextCursor(7, position(4))).toBe(4);
    expect(nextCursor(7, position(6, { jump: 'restart' }))).toBe(6);
  });
});

describe('pacedStep', () => {
  it('moves a word at a time when the gap is small', () => {
    expect(pacedStep(3, 5)).toBe(4);
  });

  it('catches up faster over a large gap but never overshoots', () => {
    expect(pacedStep(0, 60)).toBe(10);
    expect(pacedStep(58, 60)).toBe(59);
  });

  it('never steps backward', () => {
    expect(pacedStep(9, 4)).toBe(4);
  });
});

describe('reduceEvent', () => {
  it('starts from the script, then tracks the cursor and the heard words', () => {
    let session = reduceEvent(initialSession, script);
    session = reduceEvent(session, {
      type: 'partial',
      segment: 0,
      words: [
        { word: 'chapter', start: 0, end: 0.4 },
        { word: 'one', start: 0.4, end: 0.8 },
      ],
    });
    session = reduceEvent(session, position(2));

    expect(session.script).toBe(script);
    expect(session.heard).toBe('chapter one');
    expect(session.cursor).toBe(2);
  });

  it('remembers skipped words and forgets them when the narrator restarts before them', () => {
    let session = reduceEvent(initialSession, script);
    session = reduceEvent(session, position(8, { jump: 'skip', skipped: [6, 8] }));
    expect(session.skipped).toEqual([[6, 8]]);

    session = reduceEvent(session, position(5, { jump: 'restart' }));
    expect(session.skipped).toEqual([]);
  });

  it('keeps the same skipped list while nothing about it changes, so memoized rows stay put', () => {
    let session = reduceEvent(initialSession, position(8, { jump: 'skip', skipped: [6, 8] }));
    const before = session.skipped;

    session = reduceEvent(session, position(9));

    expect(session.skipped).toBe(before);
  });

  it('ignores a one-word backward correction', () => {
    let session = reduceEvent(initialSession, position(7));
    session = reduceEvent(session, position(6));

    expect(session.cursor).toBe(7);
    expect(session.position?.read).toBe(6);
  });

  it('starts over when a new script arrives', () => {
    let session = reduceEvent(initialSession, script);
    session = reduceEvent(session, position(9));

    session = reduceEvent(session, { ...script, chapter: { id: 'c2', title: 'Two' } });

    expect(session.cursor).toBe(0);
    expect(session.position).toBeNull();
  });
});

describe('sessionFromState', () => {
  it('restores the cursor from a host snapshot taken mid-session', () => {
    const state: TeleprompterState = { phase: 'running', message: 'Listening…', engine: 'whisper', chapter: 'c1', script, position: position(6) };

    const session = sessionFromState(state);

    expect(session.script).toBe(script);
    expect(session.cursor).toBe(6);
  });

  it('is empty for an idle host', () => {
    const state: TeleprompterState = { phase: 'idle', message: '', engine: null, chapter: null, script: null, position: null };

    expect(sessionFromState(state)).toEqual(initialSession);
  });
});
