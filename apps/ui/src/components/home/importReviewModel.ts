import type { ManuscriptContentKind, ManuscriptImportPreview, ManuscriptImportSection, ManuscriptImportSelection } from '../../types';

// The pure half of the import review: what the narrator's choices come to. The summary line, the groups and the rows are all read from
// these functions, so they cannot disagree after a section is reclassified (the summary is a count of the rows, not a second opinion).

/** The groups of the review, in the order they are listed. `characters` and `repairs` hold no section rows. */
export type ReviewGroupKey = ManuscriptContentKind | 'characters' | 'repairs';

/** What the narrator opened or closed by hand; a group that is not here takes its default (`isGroupOpen`). */
export type ReviewGroupOpen = Partial<Record<ReviewGroupKey, boolean>>;

/** More narration chapters than this start collapsed: a long list of chapters that the importer got right is not where a decision is needed. */
export const MANY_NARRATION_CHAPTERS = 8;
/** As many repairs as this are listed at once; more start collapsed. */
const FEW_REPAIRS = 3;

export type ReviewCounts = {
  narration: number;
  opening: number;
  reference: number;
  suggestionsChecked: number;
  suggestionsTotal: number;
  repairs: number;
};

/** The kind a section will be written as: what the narrator chose for it, or else what the importer proposed. */
export function effectiveKind(section: ManuscriptImportSection, selection: ManuscriptImportSelection): ManuscriptContentKind {
  return selection.sectionKinds?.[section.id] ?? section.contentKind;
}

/** No explicit list means every suggestion is checked (the wire behaviour: commit always sends the whole list it computes). */
export function checkedCandidateIds(preview: ManuscriptImportPreview, selection: ManuscriptImportSelection): string[] {
  return selection.characterCandidateIds ?? (preview.characterCandidates ?? []).map((candidate) => candidate.id);
}

/** Sections by the kind they will be written as, each list in the order the importer sent them. */
export function groupSections(
  sections: readonly ManuscriptImportSection[],
  selection: ManuscriptImportSelection,
): Record<ManuscriptContentKind, ManuscriptImportSection[]> {
  const groups: Record<ManuscriptContentKind, ManuscriptImportSection[]> = { narration: [], opening: [], reference: [] };
  for (const section of sections) groups[effectiveKind(section, selection)].push(section);
  return groups;
}

export function reviewCounts(preview: ManuscriptImportPreview, selection: ManuscriptImportSelection): ReviewCounts {
  const groups = groupSections(preview.sections ?? [], selection);
  const listed = new Set((preview.characterCandidates ?? []).map((candidate) => candidate.id));
  return {
    narration: groups.narration.length,
    opening: groups.opening.length,
    reference: groups.reference.length,
    suggestionsChecked: checkedCandidateIds(preview, selection).filter((id) => listed.has(id)).length,
    suggestionsTotal: listed.size,
    repairs: preview.notices?.length ?? 0,
  };
}

/** Expand the exceptions (front matter, reference material, a suggestion left unchecked, a few repairs); the chapters the importer got right start collapsed when there are many. */
export function isGroupOpen(key: ReviewGroupKey, chosen: ReviewGroupOpen, counts: ReviewCounts): boolean {
  const byHand = chosen[key];
  if (byHand !== undefined) return byHand;
  switch (key) {
    case 'narration':
      return counts.narration <= MANY_NARRATION_CHAPTERS;
    case 'characters':
      return counts.suggestionsChecked < counts.suggestionsTotal;
    case 'repairs':
      return counts.repairs <= FEW_REPAIRS;
    default:
      return true;
  }
}

export function plural(count: number, singular: string, many = `${singular}s`): string {
  return count === 1 ? singular : many;
}

/**
 * The two lines that say what was found. The headline counts narration chapters only (front matter and reference material are not
 * chaptered audio: they are excluded from the totals), and the second line lists the rest that exists. A PDF has no sections, so it keeps the
 * host's title count.
 */
export function describeReview(preview: ManuscriptImportPreview, counts: ReviewCounts): { headline: string; detail: string } {
  const hasSections = (preview.sections ?? []).length > 0;
  const chapters = hasSections
    ? `${counts.narration} narration ${plural(counts.narration, 'chapter')}`
    : `${preview.chapterTitles.length || 1} proposed ${plural(preview.chapterTitles.length || 1, 'chapter')}`;
  const detail = [
    counts.opening > 0 ? `${counts.opening} front matter ${plural(counts.opening, 'section')}` : '',
    counts.reference > 0 ? `${counts.reference} reference ${plural(counts.reference, 'section')}` : '',
    counts.suggestionsTotal > 0
      ? `${counts.suggestionsChecked} of ${counts.suggestionsTotal} character ${plural(counts.suggestionsTotal, 'suggestion')} checked`
      : '',
    counts.repairs > 0 ? `${counts.repairs} ${plural(counts.repairs, 'repair')} made to the source` : '',
  ].filter(Boolean);
  return {
    headline: `${preview.format.toUpperCase()} · ${preview.paragraphCount} ${plural(preview.paragraphCount, 'paragraph')} · ${chapters}.`,
    detail: detail.join(' · '),
  };
}
