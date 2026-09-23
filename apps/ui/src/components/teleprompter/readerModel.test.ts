import { describe, expect, it } from 'vitest';
import {
  buildRows,
  creditsParagraphs,
  creditsRows,
  hydrateSession,
  initialSession,
  nextCursor,
  marksOnWords,
  pacedStep,
  previewRows,
  readerMarks,
  segmentWords,
  reduceEvent,
  sessionFromState,
  splitWords,
  tokenize,
  wordOffsets,
} from './readerModel';
import type { GuideEntity, ManuscriptNote, ManuscriptParagraph, TeleprompterPosition, TeleprompterScript, TeleprompterState } from '../../types';

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

  it('keeps flags that arrived before the snapshot (the snapshot carries none, ADR 0115)', () => {
    const flag = { type: 'flag', id: 1, kind: 'skipped', start: 6, end: 7, heard: '' } as const;

    expect(hydrateSession(reduceEvent(initialSession, flag), snapshot).flags).toEqual([flag]);
    expect(hydrateSession(reduceEvent(reduceEvent(initialSession, position(9)), flag), snapshot).flags).toEqual([flag]);
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

// The credits on the teleprompter (audiobook-credits-templates.prd.md Phase 4, ADR 0150): the rendered text split the way
// the sidecar's chapter_script.text_script splits it, so its spans fall on the same words.
describe('creditsParagraphs', () => {
  it('makes one paragraph per line with words, numbered from one over those lines only', () => {
    expect(creditsParagraphs('closing', 'One two.\r\n   \nThree.\rFour five six.')).toEqual([
      { id: 'credits-closing-1', text: 'One two.' },
      { id: 'credits-closing-2', text: 'Three.' },
      { id: 'credits-closing-3', text: 'Four five six.' },
    ]);
  });

  it('has no paragraphs for text with no words', () => {
    expect(creditsParagraphs('opening', ' \n\t')).toEqual([]);
  });
});

describe('creditsRows', () => {
  const text = 'Alice, written by Lewis Carroll,\nnarrated by [Narrator].';

  it('lists every line as untracked text before a session starts, with no title row', () => {
    expect(creditsRows('opening', text, null)).toEqual([
      { key: 'credits-opening-1', kind: 'paragraph', start: 0, words: null, gaps: null, text: 'Alice, written by Lewis Carroll,' },
      { key: 'credits-opening-2', kind: 'paragraph', start: 0, words: null, gaps: null, text: 'narrated by [Narrator].' },
    ]);
  });

  it("lays the sidecar's spans over the lines once a session has a script", () => {
    const credits: TeleprompterScript = {
      type: 'script',
      chapter: { id: 'credits-opening', title: 'Opening credits' },
      tokens: 8,
      spans: [
        { kind: 'paragraph', id: 'credits-opening-1', index: null, start: 0, count: 5 },
        { kind: 'paragraph', id: 'credits-opening-2', index: null, start: 5, count: 3 },
      ],
    };

    const rows = creditsRows('opening', text, credits);

    expect(rows.map((row) => [row.key, row.start, row.words])).toEqual([
      ['credits-opening-1', 0, ['Alice,', 'written', 'by', 'Lewis', 'Carroll,']],
      ['credits-opening-2', 5, ['narrated', 'by', '[Narrator].']],
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

  // A seek (teleprompter-manuscript-integration.prd.md Phase 3's control channel) always reports its landing word as a
  // `jump: 'restart'` position (see teleprompterMock.ts), specifically so the one-word-back case below does not get
  // swallowed as a mid-sentence correction (Evidence: "A seek back by exactly one word would be swallowed... unless the
  // seek marks its position event as a jump").
  it('a seek always lands immediately, forward or backward, including one word back', () => {
    expect(nextCursor(3, position(10, { jump: 'restart' }))).toBe(10);
    expect(nextCursor(7, position(6, { jump: 'restart' }))).toBe(6);
    expect(nextCursor(7, position(2, { jump: 'restart' }))).toBe(2);
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
    session = reduceEvent(session, { type: 'flag', id: 1, kind: 'misread', start: 6, end: 7, heard: 'wash' });

    session = reduceEvent(session, { ...script, chapter: { id: 'c2', title: 'Two' } });

    expect(session.cursor).toBe(0);
    expect(session.position).toBeNull();
    expect(session.flags).toEqual([]);
  });

  // Phase 7: the session keeps every flag the sidecar raised, in arrival order; which ones show is the view's choice.
  it('keeps each flag once, in the order they arrived, and leaves the cursor alone', () => {
    let session = reduceEvent(initialSession, script);
    session = reduceEvent(session, position(9));
    const misread = { type: 'flag', id: 1, kind: 'misread', start: 6, end: 7, heard: 'wash' } as const;
    const skip = { type: 'flag', id: 2, kind: 'skipped', start: 7, end: 8, heard: '' } as const;

    session = reduceEvent(session, misread);
    session = reduceEvent(session, skip);
    session = reduceEvent(session, misread);

    expect(session.flags).toEqual([misread, skip]);
    expect(session.cursor).toBe(9);
  });

  it('keeps one flag when the same problem is raised again after going back', () => {
    let session = reduceEvent(initialSession, { type: 'flag', id: 3, kind: 'misread', start: 6, end: 7, heard: 'wash' });
    session = reduceEvent(session, { type: 'flag', id: 5, kind: 'misread', start: 6, end: 7, heard: 'wash' });
    session = reduceEvent(session, { type: 'flag', id: 6, kind: 'misread', start: 6, end: 7, heard: 'was' });

    expect(session.flags.map((flag) => flag.id)).toEqual([3, 6]);
  });

  it('keeps the same flag list while no flag arrives, so memoized rows stay put', () => {
    let session = reduceEvent(initialSession, { type: 'flag', id: 1, kind: 'misread', start: 6, end: 7, heard: 'wash' });
    const before = session.flags;

    session = reduceEvent(session, position(9));

    expect(session.flags).toBe(before);
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

describe('wordOffsets', () => {
  it('gives each word the character range it occupies, with the same words splitWords finds', () => {
    const text = '  Alice was\n beginning  ';
    const offsets = wordOffsets(text);
    expect(offsets.map(([start, end]) => text.slice(start, end))).toEqual(splitWords(text).words);
    expect(offsets).toEqual([
      [2, 7],
      [8, 11],
      [13, 22],
    ]);
  });
});

const mark = (id: string, start: number, end: number) => ({ id, start, end, value: id });

describe('marksOnWords', () => {
  const text = 'Mr. Hale said Hale’s coat was wet';

  it('covers every word a mark touches, so a name across a word boundary marks both words', () => {
    expect(marksOnWords(text, [mark('mr-hale', 0, 8)])).toEqual([{ id: 'mr-hale', from: 0, to: 2, value: 'mr-hale' }]);
  });

  it('marks the whole word when a mention is only part of it (a possessive)', () => {
    expect(marksOnWords(text, [mark('hale', 14, 18)])).toEqual([{ id: 'hale', from: 3, to: 4, value: 'hale' }]);
  });

  it('marks nothing for a range that holds only whitespace, and clamps a range that runs off the text', () => {
    expect(marksOnWords(text, [mark('gap', 3, 4)])).toEqual([]);
    expect(marksOnWords(text, [mark('tail', 27, 500), mark('head', -5, 2)])).toEqual([
      { id: 'tail', from: 5, to: 7, value: 'tail' },
      { id: 'head', from: 0, to: 1, value: 'head' },
    ]);
  });

  it('drops a mark with an empty, reversed or non-numeric range', () => {
    expect(marksOnWords(text, [mark('empty', 4, 4), mark('reversed', 9, 4), mark('nan', Number.NaN, 8)])).toEqual([]);
  });
});

describe('segmentWords', () => {
  const word = (id: string, from: number, to: number) => ({ id, from, to, value: id });

  it('returns one unmarked segment for a row without marks', () => {
    expect(segmentWords(4, [])).toEqual([{ from: 0, to: 4, marks: [] }]);
  });

  it('splits at every mark boundary and lists the longer mark first, so the shorter one is the inner layer', () => {
    const entity = word('entity', 1, 4);
    const note = word('note', 2, 3);
    expect(segmentWords(5, [note, entity])).toEqual([
      { from: 0, to: 1, marks: [] },
      { from: 1, to: 2, marks: [entity] },
      { from: 2, to: 3, marks: [entity, note] },
      { from: 3, to: 4, marks: [entity] },
      { from: 4, to: 5, marks: [] },
    ]);
  });

  it('orders marks of the same length by id, and ignores the part of a mark past the row', () => {
    const b = word('b', 0, 2);
    const a = word('a', 0, 2);
    expect(segmentWords(1, [b, a])).toEqual([{ from: 0, to: 1, marks: [a, b] }]);
  });
});

const entity = (id: string, name: string, aliases: string[] = []): GuideEntity => ({
  id,
  canonical_name: name,
  aliases: aliases.map((text) => ({ text, pronunciation: { ipa: '', source: '', confidence: '' }, occurrences: [] })),
  category: 'Character',
  occurrences: [],
  occurrence_count: 0,
  pronunciation: { ipa: '', source: '', confidence: '' },
  description: { text: '', evidence: {} },
  personality_notes: [],
  relationships: [],
  properties: [],
  locked: false,
  review_state: 'approved',
});

describe('readerMarks', () => {
  const hale = entity('e1', 'Mr. Hale', ['Hale']);
  const withEntity = (text: string, index = 0): ManuscriptParagraph => ({ ...paragraph(`p${index}`, index, text), entityIds: ['e1'] });
  const note = (anchorStart: number, anchorEnd: number, anchorText: string, index = 0): ManuscriptNote => ({
    id: 'n1',
    chapter: 'c1',
    paragraph: index,
    text: 'Softer here.',
    createdAt: '2026-01-01T00:00:00.000Z',
    anchorStart,
    anchorEnd,
    anchorText,
  });

  it('maps entity mentions and note anchors onto the words of the paragraph row they sit in, keyed by paragraph id', () => {
    const marks = readerMarks([withEntity('Then Mr. Hale left the room')], [hale], [note(14, 27, 'left the room')]);
    expect(marks.get('p0')).toEqual([
      { id: 'entity-e1-0-5', from: 1, to: 3, value: { kind: 'entity', entity: hale } },
      { id: 'entity-e1-1-9', from: 2, to: 3, value: { kind: 'entity', entity: hale } },
      { id: 'note-n1', from: 3, to: 6, value: { kind: 'note', note: expect.objectContaining({ id: 'n1' }) } },
    ]);
  });

  it('re-locates a drifted note anchor the same way the Manuscript reader does', () => {
    const marks = readerMarks([paragraph('p0', 0, 'An edit moved the quiet door here')], [], [note(0, 5, 'quiet door')]);
    expect(marks.get('p0')).toEqual([{ id: 'note-n1', from: 4, to: 6, value: { kind: 'note', note: expect.objectContaining({ id: 'n1' }) } }]);
  });

  it('leaves out paragraphs with no marks and notes that belong to another paragraph', () => {
    const marks = readerMarks([paragraph('p0', 0, 'Nothing here'), paragraph('p1', 1, 'Or here')], [hale], [note(0, 7, 'Nothing', 5)]);
    expect(marks.size).toBe(0);
  });
});
