import { describe, expect, it } from 'vitest';
import {
  allEvidence,
  canAddEquivalence,
  categoryLabel,
  categoryValue,
  chapterLineNumber,
  chapterTextMatches,
  CREDITS_ROOM_TONE_SECONDS_PER_FILE,
  estimateCreditsSeconds,
  estimateFinishedHours,
  findAliasMatches,
  highlightEntitiesInText,
  highlightTerms,
  isTranscriptActive,
  selectDiscrepancy,
  sortEntities,
  windowExcerpt,
} from './state';
import type { GuideAlias, GuideEntity } from './types';

const row = { id: '0@1', kind: 'MISREAD', name: 'x', docText: 'Voss', audioText: 'Vos', projectTime: 1, itemIndex: 0, srcpos: 1 };

const alias = (text: string, overrides: Partial<GuideAlias> = {}): GuideAlias => ({
  text,
  pronunciation: { ipa: '', source: 'not generated', confidence: 'unknown' },
  occurrences: [],
  ...overrides,
});

const entity = (overrides: Partial<GuideEntity>): GuideEntity => ({
  id: 'entity-1',
  canonical_name: 'Aurelian',
  aliases: [],
  category: 'Character',
  occurrences: [],
  occurrence_count: 0,
  pronunciation: { ipa: '', source: 'not generated', confidence: 'unknown' },
  description: { text: '', evidence: {} },
  personality_notes: [],
  relationships: [],
  properties: [],
  locked: false,
  review_state: 'generated',
  ...overrides,
});

describe('Transcript workspace state', () => {
  it('treats preparation and recognition as cancellable work', () => {
    expect(isTranscriptActive('preparing')).toBe(true);
    expect(isTranscriptActive('running')).toBe(true);
    expect(isTranscriptActive('success')).toBe(false);
  });
  it('keeps the selected result when it exists and otherwise chooses the first result', () => {
    expect(selectDiscrepancy([row], row.id)).toEqual(row);
    expect(selectDiscrepancy([row], 'missing')).toEqual(row);
  });
  it('only enables equivalences for single-word misreads', () => {
    expect(canAddEquivalence(row)).toBe(true);
    expect(canAddEquivalence({ ...row, kind: 'SKIPPED' })).toBe(false);
    expect(canAddEquivalence({ ...row, audioText: 'two words' })).toBe(false);
  });
});

describe('Story Bible category labels', () => {
  it('shows Place as Location without touching any other category', () => {
    expect(categoryLabel('Place')).toBe('Location');
    expect(categoryLabel('Character')).toBe('Character');
    expect(categoryLabel('Needs Review')).toBe('Needs Review');
  });
  it("translates the Location label back to the backend's Place value", () => {
    expect(categoryValue('Location')).toBe('Place');
    expect(categoryValue('Character')).toBe('Character');
  });
});

describe('Story Bible alias-to-entity matching', () => {
  const nico = entity({ id: 'entity-nico', canonical_name: 'Nico', aliases: [alias('Nicolai')] });
  const aurelian = entity({ id: 'entity-1', canonical_name: 'Aurelian', aliases: [alias('Cap')] });
  const draft = entity({ id: 'entity-draft', canonical_name: 'New entity', category: 'Draft' });

  it('matches an existing entity by canonical name or alias, case-insensitively and by substring', () => {
    expect(findAliasMatches([nico, aurelian], 'nico').map((e) => e.id)).toEqual(['entity-nico']);
    expect(findAliasMatches([nico, aurelian], 'NICOLAI').map((e) => e.id)).toEqual(['entity-nico']);
    expect(findAliasMatches([nico, aurelian], 'cap').map((e) => e.id)).toEqual(['entity-1']);
    expect(findAliasMatches([nico, aurelian], 'ic').map((e) => e.id)).toEqual(['entity-nico']);
  });
  it('excludes the entity being edited so its own name never counts as a merge target', () => {
    expect(findAliasMatches([nico, aurelian], 'Nico', 'entity-nico')).toEqual([]);
  });
  it('excludes Draft entries since they are not real entries to merge into yet', () => {
    expect(findAliasMatches([nico, draft], 'new entity')).toEqual([]);
  });
  it('returns nothing for a blank query or an unrecognized name', () => {
    expect(findAliasMatches([nico, aurelian], '')).toEqual([]);
    expect(findAliasMatches([nico, aurelian], 'Someone Else')).toEqual([]);
  });
  it('caps results at the given limit', () => {
    const many = Array.from({ length: 8 }, (_, i) => entity({ id: `entity-${i}`, canonical_name: `Match ${i}` }));
    expect(findAliasMatches(many, 'match')).toHaveLength(5);
  });
});

describe('Story Bible evidence: merging and highlighting', () => {
  it("combines an entity's own evidence with every alias's evidence, tagging the alias", () => {
    const withAliases = entity({
      occurrences: [{ chapter: 'Ch1', paragraph: 0, excerpt: 'Aurelian walked in.' }],
      aliases: [alias('Cap', { occurrences: [{ chapter: 'Ch2', paragraph: 4, excerpt: 'Cap gave the order.' }] })],
    });
    expect(allEvidence(withAliases)).toEqual([
      { chapter: 'Ch1', paragraph: 0, excerpt: 'Aurelian walked in.' },
      { chapter: 'Ch2', paragraph: 4, excerpt: 'Cap gave the order.', alias: 'Cap' },
    ]);
  });

  it('highlights the longest matching term first so it is not split by a shorter one', () => {
    const segments = highlightTerms('Captain Aurelian gave the order.', ['Aurelian', 'Captain Aurelian']);
    expect(segments.filter((s) => s.match).map((s) => s.text)).toEqual(['Captain Aurelian']);
  });

  it('returns the whole text unmatched when there are no terms', () => {
    expect(highlightTerms('plain text', [])).toEqual([{ text: 'plain text', match: false }]);
  });
});

describe('Manuscript page: multi-entity highlighting', () => {
  it('tags each matched span with the category of the entity it belongs to', () => {
    const segments = highlightEntitiesInText('Nico waited while Saint Voltage argued with the Meridian Bureau.', [
      { name: 'Nico', category: 'Character' },
      { name: 'Saint Voltage', category: 'Character' },
      { name: 'Meridian Bureau', category: 'Organization' },
    ]);
    expect(segments.filter((s) => s.category === 'Character').map((s) => s.text)).toEqual(['Nico', 'Saint Voltage']);
    expect(segments.filter((s) => s.category === 'Organization').map((s) => s.text)).toEqual(['Meridian Bureau']);
  });

  it('prefers the longest overlapping name so a shorter alias does not split it', () => {
    const segments = highlightEntitiesInText('Captain Aurelian gave the order.', [
      { name: 'Aurelian', category: 'Character' },
      { name: 'Captain Aurelian', category: 'Character' },
    ]);
    expect(segments.filter((s) => s.category).map((s) => s.text)).toEqual(['Captain Aurelian']);
  });

  it('returns the text unmatched when there are no entities to highlight', () => {
    expect(highlightEntitiesInText('plain text', [])).toEqual([{ text: 'plain text' }]);
  });
});

describe('Home audiobook estimate', () => {
  it('converts a word count into finished narration hours using the fixed rule of thumb', () => {
    expect(estimateFinishedHours(9300)).toBe(1);
    expect(estimateFinishedHours(0)).toBe(0);
  });
});

describe('Manuscript search/bookmark line numbers (R5)', () => {
  const chapter = {
    paragraphIds: [
      { id: 'p10', index: 10 },
      { id: 'p11', index: 11 },
      { id: 'p12', index: 12 },
    ],
  };

  it('reads the in-chapter position from paragraphIds, for a chapter that was never loaded', () => {
    expect(chapterLineNumber(chapter, 10, new Map())).toBe(1);
    expect(chapterLineNumber(chapter, 12, new Map())).toBe(3);
  });

  it('falls back to loaded line numbers when the chapter has no paragraphIds (pre-migration manuscripts)', () => {
    expect(chapterLineNumber(undefined, 10, new Map([[10, 7]]))).toBe(7);
  });

  it('falls back to the raw global paragraph index as a last resort', () => {
    expect(chapterLineNumber(undefined, 10, new Map())).toBe(10);
    expect(chapterLineNumber({ paragraphIds: undefined }, 10, new Map())).toBe(10);
  });

  it('prefers paragraphIds over a stale loaded map', () => {
    expect(chapterLineNumber(chapter, 11, new Map([[11, 99]]))).toBe(2);
  });
});

describe('Manuscript chapter title/subtitle subset (R2)', () => {
  const chapters = [
    { id: 'c1', title: 'Down the Rabbit-Hole', subtitle: undefined },
    { id: 'c2', title: 'The Pool of Tears', subtitle: 'A soggy start' },
    { id: 'c3', title: 'Advice from a Caterpillar', subtitle: undefined },
  ];

  it('matches a chapter whose title contains the query, case-insensitively', () => {
    expect(chapterTextMatches(chapters, 'rabbit')).toEqual(new Set(['c1']));
    expect(chapterTextMatches(chapters, 'POOL')).toEqual(new Set(['c2']));
  });

  it('matches a chapter whose subtitle contains the query', () => {
    expect(chapterTextMatches(chapters, 'soggy')).toEqual(new Set(['c2']));
  });

  it('returns nothing for a blank query', () => {
    expect(chapterTextMatches(chapters, '')).toEqual(new Set());
    expect(chapterTextMatches(chapters, '   ')).toEqual(new Set());
  });

  it('returns nothing when no title or subtitle matches', () => {
    expect(chapterTextMatches(chapters, 'nonexistent')).toEqual(new Set());
  });
});

describe('windowExcerpt (R3)', () => {
  const long = 'A'.repeat(30) + 'RABBIT' + 'B'.repeat(60); // len 96, match at [30,36)

  it('returns the text unchanged when it already fits the budget', () => {
    expect(windowExcerpt('short line', 0, 5, 38)).toEqual({ text: 'short line', matchStart: 0, matchLength: 5 });
  });

  it('cuts only the tail (ellipsis on the right) when the match falls within the first budget characters', () => {
    const result = windowExcerpt(long, 30, 6, 38);
    expect(result.text.startsWith('…')).toBe(false);
    expect(result.text.endsWith('…')).toBe(true);
    expect(result.text.slice(result.matchStart, result.matchStart + result.matchLength)).toBe('RABBIT');
    expect(result.text.length).toBe(39); // 38 chars + the trailing ellipsis
  });

  it('adds a left ellipsis (and a right one if text remains) when the match starts beyond the budget', () => {
    const farText = 'B'.repeat(60) + 'RABBIT' + 'A'.repeat(30); // match at [60, 66)
    const result = windowExcerpt(farText, 60, 6, 38);
    expect(result.text.startsWith('…')).toBe(true);
    expect(result.text.slice(result.matchStart, result.matchStart + result.matchLength)).toBe('RABBIT');
  });

  it('adds only a left ellipsis when the match sits at the very end, with nothing left to show after it', () => {
    const endText = 'B'.repeat(90) + 'RABBIT'; // match at [90, 96)
    const result = windowExcerpt(endText, 90, 6, 38);
    expect(result.text.startsWith('…')).toBe(true);
    expect(result.text.endsWith('…')).toBe(false);
    expect(result.text.slice(result.matchStart, result.matchStart + result.matchLength)).toBe('RABBIT');
  });

  it('never cuts the match itself, across a spread of match positions', () => {
    const filler = (n: number) => 'x'.repeat(n);
    for (const start of [0, 10, 40, 79, 80, 120, 155]) {
      const text = `${filler(start)}RABBIT${filler(160 - start)}`;
      const result = windowExcerpt(text, start, 6, 38);
      expect(result.text.slice(result.matchStart, result.matchStart + result.matchLength)).toBe('RABBIT');
    }
  });

  it('truncates the match itself when the match term alone is wider than the budget', () => {
    const term = 'X'.repeat(50);
    const result = windowExcerpt(term, 0, 50, 38);
    expect(result.matchStart).toBe(0);
    expect(result.text.endsWith('…')).toBe(true);
    expect(result.text.length).toBe(38); // 37 chars of the term + the ellipsis
  });

  it('clamps an out-of-range match instead of slicing negatively or past the end', () => {
    expect(() => windowExcerpt('short', -5, 3, 38)).not.toThrow();
    expect(() => windowExcerpt('short', 3, 100, 38)).not.toThrow();
  });
});

describe('Credits time (audiobook-credits-templates.prd.md, Phase 2)', () => {
  it('times each credits segment at the same 155 wpm figure as the narration estimate', () => {
    // 155 words/min: a 155-word segment reads in exactly 60s.
    expect(estimateCreditsSeconds([155])).toBe(60);
    expect(estimateCreditsSeconds([0])).toBe(0);
  });

  it('sums multiple segments (opening and closing are separate files, ACX convention/C11)', () => {
    expect(estimateCreditsSeconds([155, 310])).toBe(180);
  });

  it('returns 0 for no segments', () => {
    expect(estimateCreditsSeconds([])).toBe(0);
  });

  it('defaults room tone to 0 seconds per file (C9: no Settings knob until Phase 5)', () => {
    expect(CREDITS_ROOM_TONE_SECONDS_PER_FILE).toBe(0);
    expect(estimateCreditsSeconds([155])).toBe(estimateCreditsSeconds([155], 0));
  });

  it('adds an explicit room-tone allowance once per segment/file when given one', () => {
    expect(estimateCreditsSeconds([155, 155], 2)).toBe(124);
  });
});

describe('Story Bible entity list sorting', () => {
  const rows = [entity({ id: 'b', canonical_name: 'Bram', occurrence_count: 5 }), entity({ id: 'a', canonical_name: 'Aurelian', occurrence_count: 12 })];
  it('sorts by name ascending or descending', () => {
    expect(sortEntities(rows, { key: 'name', dir: 'asc' }).map((e) => e.id)).toEqual(['a', 'b']);
    expect(sortEntities(rows, { key: 'name', dir: 'desc' }).map((e) => e.id)).toEqual(['b', 'a']);
  });
  it('sorts by occurrence count', () => {
    expect(sortEntities(rows, { key: 'occurrences', dir: 'desc' }).map((e) => e.id)).toEqual(['a', 'b']);
  });
});
