import type { Discrepancy, GuideEntity, GuideEvidence, ManuscriptChapter, ManuscriptParagraph, TranscriptState } from './types';

export const isTranscriptActive = (phase: TranscriptState['phase']) => phase === 'preparing' || phase === 'running' || phase === 'inspecting';
// Reference-material sections (Contents, Characters, ...) stay in manuscript.json for data
// integrity but shouldn't clutter chapter navigation/listing surfaces or the continuous reader
// itself - see ChapterNav.tsx and Manuscript.tsx (ADR 0090, which reverses the reader-view clause
// of ADR 0005; this predicate's original scope was the panel only).
export const isListableChapter = (chapter: Pick<ManuscriptChapter, 'contentKind'>): boolean => (chapter.contentKind ?? 'narration') !== 'reference';
export const selectDiscrepancy = (rows: Discrepancy[], id?: string): Discrepancy | undefined => rows.find((row) => row.id === id) ?? rows[0];
export const canAddEquivalence = (row?: Discrepancy): boolean =>
  Boolean(row && row.kind === 'MISREAD' && row.docText && row.audioText && !row.docText.includes(' ') && !row.audioText.includes(' '));

// The backend's category values ("Place") never changed - only the label
// shown to the user did ("Location") - so these two stay the single place
// that translates between them. Lore/Item/Event are manual-only categories
// (nothing in rule/spaCy extraction can guess them), and Needs Review/Draft
// are system states a user can never pick for themselves - see
// CREATABLE_CATEGORIES below and manuscript_guide.py's SYSTEM_CATEGORIES.
const CATEGORY_LABELS: Record<string, string> = {
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
// ~155 spoken words/minute narrated, ~9,300 words per finished audio hour.
// Record/edit/proof phases use standard multipliers of that finished length.
const WORDS_PER_FINISHED_HOUR = 9300;
export const estimateFinishedHours = (wordCount: number): number => wordCount / WORDS_PER_FINISHED_HOUR;

// Credits time (audiobook-credits-templates.prd.md, Phase 2, Open Question C9): the same 155 wpm figure as
// estimateFinishedHours above ("Estimate constants disagree" is the PRD's own named risk, so this reuses
// WORDS_PER_FINISHED_HOUR rather than a second 155/60 constant). Credits are read as separate files from the
// narration chapters (ACX convention, Open Question C11), so each segment (an opening or closing template's
// rendered text) is timed on its own and carries its own room-tone padding: the narrator's General >
// "Room tone per credits file" setting (Phase 5, ADR 0151), which defaults to 0 seconds per file (C9).
export const CREDITS_ROOM_TONE_SECONDS_PER_FILE = 0;
export const estimateCreditsSeconds = (segmentWordCounts: number[], roomToneSecondsPerFile = CREDITS_ROOM_TONE_SECONDS_PER_FILE): number =>
  segmentWordCounts.reduce((total, words) => total + (words / WORDS_PER_FINISHED_HOUR) * 3600 + roomToneSecondsPerFile, 0);
// Chapter announcements (Phase 5, ADR 0151) are read at the head of each chapter's own file, not as files of their own,
// so they are timed at the same rate with no room tone.
export const estimateAnnouncementSeconds = (announcementWordCounts: number[]): number => estimateCreditsSeconds(announcementWordCounts, 0);
// A retail sample's length as the narrator reads it ("2m 05s"), the same rounding the host's refusal message uses.
export const formatMinutesSeconds = (seconds: number): string => {
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}m ${String(whole % 60).padStart(2, '0')}s`;
};
// The room tone setting's value as the estimate uses it: a whole number of seconds, 0 when unset or unreadable.
export const roomToneSeconds = (value: string | undefined): number => {
  const seconds = Number.parseInt(value ?? '', 10);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
};

// A chapter or credits card's read time (manuscript-credits-card-parity.prd.md, MC6): the same 200 words/minute figure
// the chapter header always used, but now shared by every card so a short credits segment reads "~2 s read" instead of
// rounding up to "~1 min read". Seconds under a minute (below 200 words); minutes at and above it, matching the old
// chapter-only formula exactly there (the round trip through seconds cannot push a large word count's minutes off by one).
export const readTimeLabel = (words: number): string => {
  const totalSeconds = Math.round((words / 200) * 60);
  if (totalSeconds < 60) return `~${totalSeconds} s read`;
  return `~${Math.round(words / 200)} min read`;
};

// The reader numbers each paragraph 1, 2, 3... within its own chapter (see
// ParagraphView's chapterParagraphIndex) rather than by its global index or
// its raw source-document line - anything elsewhere that references "line
// N" (search results, bookmarks) needs this same number, keyed by global
// paragraph index, to point at what the reader actually shows.
export const chapterLineNumbers = (paragraphs: ManuscriptParagraph[]): Map<number, number> => {
  const map = new Map<number, number>();
  const counts: Record<string, number> = {};
  paragraphs.forEach((paragraph) => {
    counts[paragraph.chapter] = (counts[paragraph.chapter] || 0) + 1;
    map.set(paragraph.index, counts[paragraph.chapter]);
  });
  return map;
};

// The line number a search hit or bookmark should show for a global paragraph index, in a chapter
// that may not be loaded (collapsed, never expanded). `chapter.paragraphIds` already carries each
// paragraph's position within its own chapter as imported, so this needs no paragraph body to be
// fetched (R5). Manuscripts imported before `paragraphIds` existed fall back to `loadedLineNumbers`
// (chapterLineNumbers of whatever chapters happen to be expanded), and finally to the raw global
// paragraph index if neither source has it - never undefined, so a row always shows something.
export const chapterLineNumber = (
  chapter: Pick<ManuscriptChapter, 'paragraphIds'> | undefined,
  paragraphIndex: number,
  loadedLineNumbers: Map<number, number>,
): number => {
  const position = chapter?.paragraphIds?.findIndex((row) => row.index === paragraphIndex) ?? -1;
  if (position >= 0) return position + 1;
  return loadedLineNumbers.get(paragraphIndex) ?? paragraphIndex;
};

// The chapter-title/subtitle subset (R2): filtered client-side from the already-loaded `chapters`
// list, so it costs no request and updates on every keystroke - unlike the debounced line search,
// which waits (SEARCH_DEBOUNCE_MS) and hits Go. Returns the matching chapter ids; a blank query
// matches nothing (an empty search shows the plain chapter list, not "everything").
export const chapterTextMatches = (chapters: Pick<ManuscriptChapter, 'id' | 'title' | 'subtitle'>[], query: string): Set<string> => {
  const needle = query.trim().toLowerCase();
  if (!needle) return new Set();
  return new Set(
    chapters
      .filter((chapter) => chapter.title.toLowerCase().includes(needle) || (chapter.subtitle ?? '').toLowerCase().includes(needle))
      .map((chapter) => chapter.id),
  );
};

// The result row's character budget (R3): measured from the panel's own layout, not a guess. The
// panel is `w-[min(20rem,100vw)]` with `p-[1.1rem]` padding (SlideOver.tsx), leaving a hit row about
// 220-230px wide at the row's 0.74rem font size - about 35-40 characters - so this is that measured
// width, taken once rather than re-measured live (a ResizeObserver/canvas.measureText round trip)
// since the panel's width and the row font size are both fixed layout constants, not user-resizable.
// Not exported: the only caller is windowExcerpt's own default; tests pass an explicit budget.
const SEARCH_EXCERPT_BUDGET = 38;

export type WindowedExcerpt = { text: string; matchStart: number; matchLength: number };

// Windows a long excerpt around its match to fit a result row (R3). The match is never cut, except
// when the match term alone is wider than the budget, which then truncates the term itself. When the
// match already falls within the first `budget` characters, only the tail is cut (ellipsis on the
// right - the common case, a match near the start of a paragraph). Otherwise the window shifts to
// keep the match in view, extending right with whatever budget the match itself did not use, then
// falling back to left context with what remains - an ellipsis appears on the left (and the right
// too, if text remains after the window).
export function windowExcerpt(text: string, matchStart: number, matchLength: number, budget: number = SEARCH_EXCERPT_BUDGET): WindowedExcerpt {
  const length = text.length;
  const start = Math.min(Math.max(matchStart, 0), length);
  const matchLen = Math.min(Math.max(matchLength, 0), length - start);
  const end = start + matchLen;
  if (length <= budget) return { text, matchStart: start, matchLength: matchLen };
  if (matchLen >= budget) {
    const cut = Math.max(0, budget - 1);
    return { text: `${text.slice(start, start + cut)}…`, matchStart: 0, matchLength: cut };
  }
  if (end <= budget) return { text: `${text.slice(0, budget)}…`, matchStart: start, matchLength: matchLen };
  const remaining = budget - matchLen;
  const rightBudget = Math.min(remaining, length - end);
  const leftBudget = remaining - rightBudget;
  const windowStart = Math.max(0, start - leftBudget);
  const windowEnd = Math.min(length, end + rightBudget);
  const prefix = windowStart > 0 ? '…' : '';
  const suffix = windowEnd < length ? '…' : '';
  return {
    text: `${prefix}${text.slice(windowStart, windowEnd)}${suffix}`,
    matchStart: start - windowStart + prefix.length,
    matchLength: matchLen,
  };
}

export type EntitySort = { key: 'name' | 'occurrences'; dir: 'asc' | 'desc' };
export const sortEntities = (entities: GuideEntity[], sort: EntitySort): GuideEntity[] => {
  const factor = sort.dir === 'asc' ? 1 : -1;
  return [...entities].sort((a, b) => {
    const left = sort.key === 'occurrences' ? a.occurrence_count : a.canonical_name.toLowerCase();
    const right = sort.key === 'occurrences' ? b.occurrence_count : b.canonical_name.toLowerCase();
    return (left > right ? 1 : left < right ? -1 : 0) * factor;
  });
};
