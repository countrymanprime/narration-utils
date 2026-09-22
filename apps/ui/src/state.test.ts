import { describe, expect, it } from 'vitest';
import {
  allEvidence,
  canAddEquivalence,
  categoryLabel,
  categoryValue,
  estimateFinishedHours,
  findAliasMatches,
  highlightEntitiesInText,
  highlightTerms,
  isTranscriptActive,
  selectDiscrepancy,
  sortEntities,
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
