import { describe, expect, it } from 'vitest';
import { boothProgress, clockText, comingUp, progressText } from './boothProgress';
import type { ReaderMark, ReaderRow } from './readerModel';
import type { GuideEntity } from '../../types';

const paragraph = (key: string, start: number, text: string, tracked = true): ReaderRow => {
  const words = text.split(' ');
  return { key, kind: 'paragraph', start, words: tracked ? words : null, gaps: tracked ? words.map(() => ' ') : null, text };
};
const pronunciation = (ipa: string, status: 'researched' | 'author_confirmed' = 'researched') => ({ ipa, source: 'cmu', confidence: '', status });
const entity = (id: string, name: string, ipa: string, aliases: GuideEntity['aliases'] = []): GuideEntity =>
  ({ id, canonical_name: name, aliases, category: 'Character', pronunciation: pronunciation(ipa) }) as unknown as GuideEntity;
const mark = (id: string, from: number, to: number, target: GuideEntity): ReaderMark => ({ id, from, to, value: { kind: 'entity', entity: target } });

describe('boothProgress (audit BO5, mock 03)', () => {
  const rows: ReaderRow[] = [
    { key: 'title', kind: 'title', start: 0, words: null, gaps: null, text: 'Chapter 7' },
    paragraph('p1', 2, 'a b c'),
    paragraph('p2', 5, 'd e f'),
  ];

  it('counts the paragraph the current word is in, over paragraph rows only, with the share and the finished time left', () => {
    expect(boothProgress(rows, 6, 8)).toEqual({ paragraph: 2, paragraphs: 2, percent: 75, secondsLeft: 1 });
    expect(boothProgress(rows, 0, 8)?.paragraph).toBe(1);
  });

  it('says nothing for a chapter with no paragraphs or no words', () => {
    expect(boothProgress([rows[0]], 0, 8)).toBeUndefined();
    expect(boothProgress(rows, 0, 0)).toBeUndefined();
  });

  it("writes it in the mock's words", () => {
    expect(progressText({ paragraph: 38, paragraphs: 71, percent: 41, secondsLeft: 490 })).toBe('¶ 38 of 71 · 41% · ~8:10 finished left');
  });

  it('writes durations as m:ss, the REC badge with two minute digits, and hours when there are any', () => {
    expect(clockText(490)).toBe('8:10');
    expect(clockText(402, 2)).toBe('06:42');
    expect(clockText(3725)).toBe('1:02:05');
  });
});

describe('comingUp (audit BO8, mock 03)', () => {
  const hatter = entity('hatter', 'Hatter', '/ˈhætər/');
  const rabbit = entity('rabbit', 'White Rabbit', '/waɪt ˈræbɪt/', [
    { text: 'Rabbit', pronunciation: pronunciation('/ˈræbɪt/', 'author_confirmed'), occurrences: [] },
  ]);
  const nobody = entity('nobody', 'Dinah', '');
  const rows = [paragraph('p1', 0, 'the Hatter said to Dinah'), paragraph('p2', 5, 'and the Rabbit and the Hatter ran')];
  const marks = new Map([
    ['p1', [mark('m1', 1, 2, hatter), mark('m2', 4, 5, nobody)]],
    ['p2', [mark('m3', 2, 3, rabbit), mark('m4', 5, 6, hatter)]],
  ]);

  it('lists the names ahead of the current word that have a pronunciation, each once, in reading order', () => {
    const names = comingUp(rows, marks, 0, true);
    expect(names.map((name) => [name.text, name.pronunciation.ipa])).toEqual([
      ['Hatter', '/ˈhætər/'],
      ['Rabbit', '/ˈræbɪt/'],
    ]);
  });

  it('names the alias a longer marked word contains, never the whole word ("rabbit-hole" is Rabbit)', () => {
    const hole = [paragraph('p1', 0, 'down the rabbit-hole and the Rabbit')];
    const holeMarks = new Map([['p1', [mark('m1', 2, 3, rabbit), mark('m2', 5, 6, rabbit)]]]);
    expect(comingUp(hole, holeMarks, 0, true).map((name) => [name.text, name.pronunciation.ipa])).toEqual([['Rabbit', '/ˈræbɪt/']]);
  });

  it('leaves out the names already read', () => {
    expect(comingUp(rows, marks, 3, true).map((name) => name.text)).toEqual(['Rabbit', 'Hatter']);
  });

  it('before a session counts every row from its first word', () => {
    const untracked = [paragraph('p1', 0, 'the Hatter said to Dinah', false), paragraph('p2', 0, 'and the Rabbit and the Hatter ran', false)];
    expect(comingUp(untracked, marks, 0, false, 1).map((name) => name.text)).toEqual(['Hatter']);
  });
});
