import { describe, expect, it } from 'vitest';
import type { PassageTake, WorkspaceParagraph, WorkspaceToken } from '../../api/contracts/workspace';
import type { TakeComparisonMember } from '../../api/contracts/takeReview';
import { auditionRangeOf, paragraphPassage, passageLabel, swapPosition } from './takesPassage';
import { divergenceBrief, evidenceLine } from './takeComparisonFormat';

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

describe('swapping A and B at the same word', () => {
  const range = (start: number, length: number) => ({ source_file: 'x.wav', source_start: start, source_length: length });
  const words = (times: Array<[number, number]>) =>
    times.map(([start, end], index) => ({ index, status: 'matched' as const, start, end })) satisfies TakeComparisonMember['words'];

  it('starts the other take at the same word when the comparison timed it in both', () => {
    const a = {
      range: range(10, 30),
      member: member(
        words([
          [11, 11.5],
          [12, 12.5],
          [13, 13.5],
        ]),
      ),
    };
    const b = {
      range: range(50, 30),
      member: member(
        words([
          [51, 51.4],
          [53, 53.4],
          [55, 55.4],
        ]),
      ),
    };
    expect(swapPosition(12.2, a, b)).toBe(53);
    expect(swapPosition(13.9, a, b)).toBe(55);
  });

  it('starts at the same distance into the passage when the takes were not compared', () => {
    const a = { range: range(10, 30), member: undefined };
    const b = { range: range(50, 30), member: undefined };
    expect(swapPosition(14, a, b)).toBe(54);
  });

  it('stays inside the other take and never starts before it', () => {
    const a = { range: range(10, 30), member: undefined };
    const b = { range: range(50, 5), member: undefined };
    expect(swapPosition(39, a, b)).toBe(55);
    expect(swapPosition(3, a, b)).toBe(50);
  });
});

describe("a take's card says where it departs from the script", () => {
  const divergence = (over: Partial<TakeComparisonMember['divergences'][number]>): TakeComparisonMember['divergences'][number] => ({
    kind: 'misread',
    position: 'within',
    first_word: 4,
    last_word: 4,
    manuscript_text: 'near',
    audio_text: 'here',
    start: 12.4,
    end: 12.9,
    ...over,
  });

  it('words each kind of departure without its time', () => {
    expect(divergenceBrief(divergence({}))).toBe('Misread “near” as “here”');
    expect(divergenceBrief(divergence({ kind: 'extra', audio_text: 'well' }))).toBe('Extra words “well”');
    expect(divergenceBrief(divergence({ kind: 'skipped', manuscript_text: 'very' }))).toBe('Left out: “very”');
    expect(divergenceBrief(divergence({ kind: 'unread', manuscript_text: 'the end' }))).toBe('Not reached: “the end”');
  });

  it('says every word matched when nothing departs, then the pause and how loud the take is against its neighbours', () => {
    const measured = {
      ...member([]),
      metrics: {
        pause_profile: { status: 'measured', min_pause_seconds: 0.3, long_pause_seconds: 2, longest_seconds: 0.4 },
        level_consistency: {
          status: 'measured',
          delta_lu: -1.2,
          neighbors_measured: 2,
          neighbors_unavailable: 0,
          integrated_lufs: null,
          neighbor_median_lufs: null,
        },
      },
    } as unknown as TakeComparisonMember;
    expect(evidenceLine(measured)).toBe('Every word matched · 0.4 s pause · −1.2 dB quieter');
  });

  it('lists the departures first and leaves out what was not measured', () => {
    const departing = { ...member([]), divergences: [divergence({}), divergence({ kind: 'skipped', manuscript_text: 'very' })] };
    expect(evidenceLine(departing)).toBe('Misread “near” as “here” · Left out: “very”');
  });
});
