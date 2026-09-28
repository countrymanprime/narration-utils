import { describe, expect, it } from 'vitest';
import { DEFAULT_FLAG_VISIBILITY, flagHint, flagMarks, flagSaves, flagText, visibleFlags, withMarks } from './readerFlags';
import { buildRows, type ReaderMark } from './readerModel';
import type { ManuscriptParagraph, TeleprompterFlag, TeleprompterScript } from '../../types';

// "Down the Rabbit-Hole" (3 title words), then p1 "Alice was beginning to" (words 3-6) and p2 "get very tired" (words 7-9).
const script: TeleprompterScript = {
  type: 'script',
  chapter: { id: 'c1', title: 'Down the Rabbit-Hole' },
  tokens: 10,
  spans: [
    { kind: 'title', id: 'c1', index: null, start: 0, count: 3 },
    { kind: 'paragraph', id: 'p1', index: 0, start: 3, count: 4 },
    { kind: 'paragraph', id: 'p2', index: 1, start: 7, count: 3 },
  ],
};
const paragraph = (id: string, index: number, text: string): ManuscriptParagraph => ({ id, chapterId: 'c1', chapter: 'c1', index, text, entityIds: [] });
const rows = buildRows(script, { title: 'Down the Rabbit-Hole' }, [paragraph('p1', 0, 'Alice was beginning to'), paragraph('p2', 1, 'get very tired')]);

const flag = (id: number, kind: TeleprompterFlag['kind'], start: number, end: number, heard = ''): TeleprompterFlag => ({
  type: 'flag',
  id,
  kind,
  start,
  end,
  heard,
});

describe('visibleFlags (owner decision 2026-09-23: skipped and restart on, misread and extra behind toggles)', () => {
  const all = [flag(1, 'misread', 5, 6, 'begging'), flag(2, 'extra', 4, 4, 'um'), flag(3, 'skipped', 7, 8), flag(4, 'restart', 3, 6, 'alice was')];

  it('shows skipped and restart flags by default and hides misreads and extras', () => {
    expect(DEFAULT_FLAG_VISIBILITY).toEqual({ skipped: true, restart: true, misread: false, extra: false });
    expect(visibleFlags(all, DEFAULT_FLAG_VISIBILITY, new Set()).map((item) => item.id)).toEqual([3, 4]);
  });

  it('shows a kind the narrator turned on, and never a dismissed flag', () => {
    expect(visibleFlags(all, { ...DEFAULT_FLAG_VISIBILITY, misread: true }, new Set([4])).map((item) => item.id)).toEqual([1, 3]);
  });
});

describe('flagMarks', () => {
  it('marks a flag on the words of the paragraph row it falls in, in that row’s own word numbers', () => {
    const marks = flagMarks(rows, [flag(1, 'misread', 5, 6, 'begging')]);
    expect(marks.get('p1')).toEqual([{ id: 'flag-1', from: 2, to: 3, value: { kind: 'flag', flag: flag(1, 'misread', 5, 6, 'begging') } }]);
    expect(marks.has('p2')).toBe(false);
  });

  it('splits a flag across the rows it spans', () => {
    const marks = flagMarks(rows, [flag(3, 'skipped', 5, 9)]);
    expect(marks.get('p1')?.map((mark) => [mark.from, mark.to])).toEqual([[2, 4]]);
    expect(marks.get('p2')?.map((mark) => [mark.from, mark.to])).toEqual([[0, 2]]);
  });

  // A re-read can run to a sentence or two; marking all of it would make those words one button (a mark never seeks, ADR 0116)
  // and take "Go back to here" away from them. The restart is where the narrator went back to, so that word carries it.
  it('marks a restart on the word it went back to, not the whole re-read', () => {
    const marks = flagMarks(rows, [flag(4, 'restart', 5, 9, 'beginning to get very')]);
    expect(marks.get('p1')?.map((mark) => [mark.from, mark.to])).toEqual([[2, 3]]);
    expect(marks.has('p2')).toBe(false);
  });

  it('puts an extra on the word it was heard before, or on the last word when it was heard after the end', () => {
    const marks = flagMarks(rows, [flag(2, 'extra', 7, 7, 'um'), flag(5, 'extra', 10, 10, 'the end')]);
    expect(marks.get('p2')?.map((mark) => [mark.id, mark.from, mark.to])).toEqual([
      ['flag-2', 0, 1],
      ['flag-5', 2, 3],
    ]);
  });

  it('marks nothing outside the rows (a flag past the text or in a row the tracker does not follow)', () => {
    const untracked = buildRows(script, { title: 'Down the Rabbit-Hole' }, [paragraph('p1', 0, 'Alice was beginning'), paragraph('p2', 1, 'get very tired')]);
    expect(flagMarks(untracked, [flag(1, 'misread', 4, 5, 'wash')]).size).toBe(0);
    expect(flagMarks(rows, [flag(1, 'misread', 40, 41, 'x')]).size).toBe(0);
  });
});

describe('withMarks', () => {
  it('adds flag marks to a row’s story bible and note marks in reading order, and keeps untouched rows as they were', () => {
    const entity: ReaderMark = { id: 'e1', from: 0, to: 1, value: { kind: 'note', note: { id: 'n1', chapter: 'c1', paragraph: 0, text: 'x', createdAt: '' } } };
    const p2Marks: ReaderMark[] = [{ ...entity, id: 'e2' }];
    const base = new Map([
      ['p1', [entity]],
      ['p2', p2Marks],
    ]);
    const merged = withMarks(base, flagMarks(rows, [flag(1, 'misread', 5, 6, 'begging')]));
    expect(merged.get('p1')?.map((mark) => mark.id)).toEqual(['e1', 'flag-1']);
    expect(merged.get('p2')).toBe(p2Marks);
    expect(withMarks(base, new Map())).toBe(base);
  });
});

describe('flagSaves', () => {
  it('names each flag by paragraph and paragraph word, with the event indices as evidence and the narrator’s dismissal', () => {
    const { saves, flagIds } = flagSaves(rows, [flag(1, 'misread', 5, 6, 'begging'), flag(3, 'skipped', 7, 9)], new Set([3]));
    expect(saves).toEqual([
      { kind: 'misread', paragraphId: 'p1', wordStart: 2, wordEnd: 3, scriptStart: 5, scriptEnd: 6, heard: 'begging', dismissed: false },
      { kind: 'skipped', paragraphId: 'p2', wordStart: 0, wordEnd: 2, scriptStart: 7, scriptEnd: 9, heard: '', dismissed: true },
    ]);
    expect(flagIds).toEqual([1, 3]);
  });

  it('keeps an extra on the one word it was heard before, and splits a flag across paragraphs', () => {
    const { saves, flagIds } = flagSaves(rows, [flag(2, 'extra', 7, 7, 'um'), flag(4, 'restart', 5, 9, 'beginning to get very')], new Set());
    expect(saves.map((save) => [save.kind, save.paragraphId, save.wordStart, save.wordEnd])).toEqual([
      ['extra', 'p2', 0, 1],
      ['restart', 'p1', 2, 4],
      ['restart', 'p2', 0, 2],
    ]);
    expect(flagIds).toEqual([2, 4, 4]);
  });

  it('leaves out a flag on the title, which is not a manuscript paragraph', () => {
    expect(flagSaves(rows, [flag(1, 'misread', 1, 2, 'a')], new Set()).saves).toEqual([]);
  });
});

describe('flagText', () => {
  it('gives the script words a flag is about, across paragraphs, and the word an extra came before', () => {
    expect(flagText(rows, flag(4, 'restart', 5, 9, 'x'))).toBe('beginning to get very');
    expect(flagText(rows, flag(2, 'extra', 7, 7, 'um'))).toBe('get');
    expect(flagText(rows, flag(1, 'misread', 40, 41, 'x'))).toBe('');
  });
});

describe('flagHint', () => {
  it('says what was heard, and that it is only suspected', () => {
    expect(flagHint(flag(1, 'misread', 5, 6, 'begging'))).toBe('Suspected misread. Heard “begging”.');
    expect(flagHint(flag(2, 'extra', 7, 7, 'um'))).toBe('Suspected extra words before this word. Heard “um”.');
    expect(flagHint(flag(3, 'skipped', 7, 9))).toBe('Suspected skipped words. Nothing was heard for them.');
    expect(flagHint(flag(4, 'restart', 5, 9, 'beginning to get'))).toBe('Suspected restart: read again from here. Heard “beginning to get”.');
  });
});
