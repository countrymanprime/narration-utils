import type { Discrepancy, GuideEntity, GuideEvidence, TranscriptState } from './types';

export const isTranscriptActive = (phase: TranscriptState['phase']) => phase === 'preparing' || phase === 'running';
export const selectDiscrepancy = (rows: Discrepancy[], id?: string): Discrepancy | undefined => rows.find((row) => row.id === id) ?? rows[0];
export const canAddEquivalence = (row?: Discrepancy): boolean =>
  Boolean(row && row.kind === 'MISREAD' && row.docText && row.audioText && !row.docText.includes(' ') && !row.audioText.includes(' '));

// The backend's category values ("Place") never changed - only the label
// shown to the user did ("Location") - so these two stay the single place
// that translates between them. Lore/Item/Event are manual-only categories
// (nothing in rule/spaCy extraction can guess them), and Needs Review/Draft
// are system states a user can never pick for themselves - see
// CREATABLE_CATEGORIES below and manuscript_guide.py's SYSTEM_CATEGORIES.
export const CATEGORY_LABELS: Record<string, string> = {
  Character: 'Character',
  Place: 'Location',
  Organization: 'Organization',
  Lore: 'Lore',
  Item: 'Item',
  Event: 'Event',
  'Needs Review': 'Needs Review',
  Draft: 'Choose category',
};
export const CREATABLE_CATEGORIES = ['Character', 'Location', 'Organization', 'Lore', 'Item', 'Event'];
export const STORY_BIBLE_TABS = ['All', 'Character', 'Location', 'Organization', 'Lore', 'Item', 'Event', 'Needs Review'];
export const categoryLabel = (category: string): string => CATEGORY_LABELS[category] ?? category;
export const categoryValue = (label: string): string => (label === 'Location' ? 'Place' : label);
export const categoryCssName = (category: string): string => (category === 'Needs Review' ? 'Review' : category);

// Backs the Story Bible alias field's "this matches an existing entity" combobox
// prompt - a case-insensitive substring match against another entity's
// canonical name or any of its aliases, which is what unlocks the Merge action
// instead of just adding a plain alias. Draft entries are excluded because
// they aren't real entries yet (nothing to merge into or review).
export const findAliasMatches = (entities: GuideEntity[], query: string, excludeId?: string, limit = 5): GuideEntity[] => {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  return entities
    .filter((entity) => entity.id !== excludeId && entity.category !== 'Draft')
    .filter((entity) => entity.canonical_name.toLowerCase().includes(needle) || entity.aliases.some((alias) => alias.text.toLowerCase().includes(needle)))
    .slice(0, limit);
};

export type TaggedEvidence = GuideEvidence & { alias?: string };
// Merges an entity's own evidence with every alias's evidence into one list,
// tagging alias-sourced items - the approved design shows these together
// (with an "alias: X" label) rather than only ever showing the canonical
// name's own occurrences.
export const allEvidence = (entity: GuideEntity): TaggedEvidence[] => [
  ...entity.occurrences,
  ...entity.aliases.flatMap((alias) => alias.occurrences.map((occurrence) => ({ ...occurrence, alias: alias.text }))),
];

export type HighlightSegment = { text: string; match: boolean };
// Splits an excerpt into plain/matched segments so the entity's own name and
// aliases can be highlighted inline, longest term first so e.g. "Aurelian
// Voss" doesn't get split up by a shorter "Voss" alias mid-match.
export const highlightTerms = (text: string, terms: string[]): HighlightSegment[] => {
  const cleaned = Array.from(new Set(terms.map((term) => term.trim()).filter(Boolean))).sort((a, b) => b.length - a.length);
  if (!cleaned.length) return [{ text, match: false }];
  const pattern = new RegExp(`(${cleaned.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
  return text
    .split(pattern)
    .filter((part) => part.length > 0)
    .map((part) => ({ text: part, match: cleaned.some((term) => term.toLowerCase() === part.toLowerCase()) }));
};

export type ManuscriptHighlightSegment = { text: string; category?: string };
// Manuscript paragraphs can contain several different entities' names in one
// sentence, unlike a Story Bible evidence excerpt (always one entity's own
// terms) - so this tracks which entity's category each matched span belongs
// to, rather than highlightTerms' single true/false match flag above.
export const highlightEntitiesInText = (text: string, entities: { name: string; category: string }[]): ManuscriptHighlightSegment[] => {
  const terms = entities.filter((entity) => entity.name.trim()).sort((a, b) => b.name.length - a.name.length);
  if (!terms.length) return [{ text }];
  const categoryByLowerName = new Map(terms.map((entity) => [entity.name.toLowerCase(), entity.category]));
  const pattern = new RegExp(`(${terms.map((entity) => entity.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
  return text
    .split(pattern)
    .filter((part) => part.length > 0)
    .map((part) => ({ text: part, category: categoryByLowerName.get(part.toLowerCase()) }));
};

// Fixed industry rule of thumb used by the Home audiobook-estimate panel:
// ~150 spoken words/minute narrated, ~9,300 words per finished audio hour.
// Record/edit/proof phases use standard multipliers of that finished length.
export const WORDS_PER_FINISHED_HOUR = 9300;
export const estimateFinishedHours = (wordCount: number): number => wordCount / WORDS_PER_FINISHED_HOUR;

export type EntitySort = { key: 'name' | 'occurrences'; dir: 'asc' | 'desc' };
export const sortEntities = (entities: GuideEntity[], sort: EntitySort): GuideEntity[] => {
  const factor = sort.dir === 'asc' ? 1 : -1;
  return [...entities].sort((a, b) => {
    const left = sort.key === 'occurrences' ? a.occurrence_count : a.canonical_name.toLowerCase();
    const right = sort.key === 'occurrences' ? b.occurrence_count : b.canonical_name.toLowerCase();
    return (left > right ? 1 : left < right ? -1 : 0) * factor;
  });
};
