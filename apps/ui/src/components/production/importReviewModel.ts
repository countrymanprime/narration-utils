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

/** A section whose heading has a second line the narrator can say is not its subtitle (story-bible-and-import-ux-briefs PRD, Phase 5). */
export function hasSubtitleChoice(section: ManuscriptImportSection): boolean {
  return Boolean(section.subtitle && section.subtitleOff);
}

/** Whether the review reads a section's second line as its subtitle: the row set by hand, else the review's default, else the importer's guess (yes). */
export function subtitleKept(section: ManuscriptImportSection, selection: ManuscriptImportSelection): boolean {
  return selection.subtitleOverrides?.[section.id] ?? selection.subtitleDefault ?? true;
}

/** Any section in the preview that has a subtitle choice: the default is offered only then. */
export function hasSubtitleChoices(preview: ManuscriptImportPreview): boolean {
  return (preview.sections ?? []).some(hasSubtitleChoice);
}

/**
 * The heading as it will be written: the title and subtitle the importer read, or, with the subtitle turned off, the title with the line
 * joined to it, or the title alone with the line kept as `textLine` because it becomes the chapter's first paragraph.
 */
export function reviewedHeading(
  section: ManuscriptImportSection,
  selection: ManuscriptImportSelection,
): { title: string; subtitle?: string; textLine?: string } {
  if (!hasSubtitleChoice(section) || subtitleKept(section, selection)) return { title: section.title, subtitle: section.subtitle };
  if (section.subtitleOff === 'body') return { title: section.title, textLine: section.subtitle };
  // Whitespace collapsed as the host joins it (importer.joinedTitle), so the row shows exactly what is written.
  return { title: `${section.title} ${section.subtitle}`.replace(/\s+/g, ' ').trim() };
}

/** What the commit sends: every section whose subtitle is turned off, by the row or by the default, as `false`. Undefined when there is none. */
export function subtitleOverridesToCommit(preview: ManuscriptImportPreview, selection: ManuscriptImportSelection): Record<string, boolean> | undefined {
  const off = (preview.sections ?? []).filter((section) => hasSubtitleChoice(section) && !subtitleKept(section, selection));
  return off.length > 0 ? Object.fromEntries(off.map((section) => [section.id, false])) : undefined;
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
