import { describe, expect, it } from 'vitest';
import type { PassageTake, WorkspaceParagraph, WorkspaceToken } from '../../api/contracts/workspace';
import type { TakeComparisonMember } from '../../api/contracts/takeReview';
import { auditionRangeOf, paragraphPassage, passageLabel } from './takesPassage';

const token = (i: number, p: string | undefined, item?: number): WorkspaceToken => ({
  i,
  p,
  w: i,
  text: `w${i}`,
  status: item === undefined ? 'skip' : 'read',
  item,
});

const tokens = [token(0, 'p-1', 0), token(1, 'p-1', 0), token(2, 'p-2'), token(3, 'p-2', 0), token(4, undefined, 0), token(5, 'p-3', 1)];
const paragraphs: WorkspaceParagraph[] = [
  { id: 'p-1', text: 'One two three four five six seven eight nine ten' },
  { id: 'p-2', text: 'Second paragraph' },
  { id: 'p-3', text: 'Third' },
];

describe('the passage the Takes panel asks about', () => {
  it('is the whole paragraph of the word at the playhead, first to last token of that paragraph', () => {
    expect(paragraphPassage(tokens, 1)).toEqual({ firstToken: 0, lastToken: 1, paragraphId: 'p-1' });
    expect(paragraphPassage(tokens, 3)).toEqual({ firstToken: 2, lastToken: 3, paragraphId: 'p-2' });
  });

  it('starts at the first heard word when nothing is playing', () => {
    expect(paragraphPassage(tokens, undefined)).toEqual({ firstToken: 0, lastToken: 1, paragraphId: 'p-1' });
  });

  it('is nothing for a heading word with no paragraph, an unknown token or an empty chapter', () => {
    expect(paragraphPassage(tokens, 4)).toBeUndefined();
    expect(paragraphPassage(tokens, 99)).toBeUndefined();
    expect(paragraphPassage([], undefined)).toBeUndefined();
  });

  it('is named by its paragraphs and the start of their text', () => {
    expect(passageLabel(paragraphs, 0, 0)).toEqual({ title: 'Paragraph 1', excerpt: 'One two three four five six seven eight…' });
    expect(passageLabel(paragraphs, 1, 2)).toEqual({ title: 'Paragraphs 2 to 3', excerpt: 'Second paragraph' });
    expect(passageLabel(paragraphs, 5, 5)).toEqual({ title: 'Paragraph 6', excerpt: '' });
  });
});

const take = (over: Partial<PassageTake> = {}): PassageTake => ({
  id: 'take:a:b',
  source: 'item_take',
  action: 'make_active',
  confirm: false,
  label: 'Take 1',
  detail: '',
  active: false,
  itemGuid: 'a',
  takeGuid: 'b',
  sourceFile: 'take.wav',
  sourceStart: 10,
  sourceLength: 30,
  usable: true,
  compared: false,
  ...over,
});

const member = (words: TakeComparisonMember['words']): TakeComparisonMember => ({
  item_guid: 'a',
  take_guid: 'b',
  source_file: 'take.wav',
  source_start: 10,
  source_length: 30,
  compared: true,
  fidelity: 0.9,
  counts: null,
  words,
  divergences: [],
  metrics: null,
});

describe('the range of a take the A/B plays', () => {
  it("is the take's whole played range until it was compared", () => {
    expect(auditionRangeOf(take(), undefined)).toEqual({ source_file: 'take.wav', source_start: 10, source_length: 30 });
  });

  it('is from the first to the last timed word of the passage once it was compared', () => {
    const words = [
      { index: 0, status: 'unread' as const, start: null, end: null },
      { index: 1, status: 'matched' as const, start: 14.5, end: 15 },
      { index: 2, status: 'misread' as const, start: 15.2, end: 16.1 },
      { index: 3, status: 'unread' as const, start: null, end: null },
    ];
    const range = auditionRangeOf(take(), member(words));
    expect(range.source_start).toBeCloseTo(14.5);
    expect(range.source_length).toBeCloseTo(1.6);
  });

  it('stays the whole range when the comparison timed no word of the take', () => {
    const words = [{ index: 0, status: 'unread' as const, start: null, end: null }];
    expect(auditionRangeOf(take(), member(words))).toEqual({ source_file: 'take.wav', source_start: 10, source_length: 30 });
  });
});
