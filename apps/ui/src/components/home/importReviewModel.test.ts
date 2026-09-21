import { describe, expect, it } from 'vitest';
import { mockImportPreview } from '../../api/mockImportPreview';
import type { ManuscriptImportPreview } from '../../types';
import { describeReview, effectiveKind, groupSections, isGroupOpen, MANY_NARRATION_CHAPTERS, plural, reviewCounts } from './importReviewModel';

const preview = mockImportPreview('docx');
const section = (id: string) => {
  const found = preview.sections?.find((item) => item.id === id);
  if (!found) throw new Error(`no section ${id}`);
  return found;
};

describe('effectiveKind', () => {
  it('is the kind the importer proposed until the narrator chooses another', () => {
    expect(effectiveKind(section('section-0001'), {})).toBe('narration');
    expect(effectiveKind(section('section-0001'), { sectionKinds: { 'section-0001': 'reference' } })).toBe('reference');
    expect(effectiveKind(section('section-0006'), { sectionKinds: { 'section-0001': 'reference' } })).toBe('reference');
  });
});

describe('reviewCounts', () => {
  it('counts the sections of each effective kind and the suggestions still checked', () => {
    expect(reviewCounts(preview, {})).toEqual({ narration: 5, opening: 1, reference: 2, suggestionsChecked: 3, suggestionsTotal: 3, repairs: 0 });
  });

  it('follows a reclassification, so the summary and the rows cannot disagree', () => {
    const counts = reviewCounts(preview, { sectionKinds: { 'section-0001': 'reference', 'section-0006': 'narration', 'section-0008': 'narration' } });
    expect(counts).toMatchObject({ narration: 6, opening: 0, reference: 2 });
  });

  it('counts the suggestions of an explicit list, and treats no list as every suggestion checked', () => {
    expect(reviewCounts(preview, { characterCandidateIds: ['candidate-section-0007-002'] })).toMatchObject({ suggestionsChecked: 1, suggestionsTotal: 3 });
    expect(reviewCounts(preview, { characterCandidateIds: [] })).toMatchObject({ suggestionsChecked: 0, suggestionsTotal: 3 });
  });

  it('ignores a checked id the preview does not list', () => {
    expect(reviewCounts(preview, { characterCandidateIds: ['candidate-gone'] })).toMatchObject({ suggestionsChecked: 0 });
  });

  it('counts the repairs the importer reported', () => {
    expect(reviewCounts(mockImportPreview('repaired'), {}).repairs).toBe(2);
  });

  it('a preview with no sections (a PDF) has none of any kind', () => {
    const pdf: ManuscriptImportPreview = { format: 'pdf', sourceName: 'a.pdf', paragraphCount: 3, chapterTitles: ['One', 'Two'] };
    expect(reviewCounts(pdf, {})).toEqual({ narration: 0, opening: 0, reference: 0, suggestionsChecked: 0, suggestionsTotal: 0, repairs: 0 });
  });
});

describe('groupSections', () => {
  it('lists each kind in the order the sections came, wherever the importer put them', () => {
    const groups = groupSections(preview.sections ?? [], { sectionKinds: { 'section-0003': 'reference' } });
    expect(groups.narration.map((item) => item.title)).toEqual(['Chapter One', 'Chapter Two', 'Chapter Four', 'Chapter Five']);
    expect(groups.reference.map((item) => item.title)).toEqual(['Chapter Three', 'Glossary', 'Characters']);
    expect(groups.opening.map((item) => item.title)).toEqual(['Front Matter']);
  });
});

describe('isGroupOpen', () => {
  const counts = reviewCounts(preview, {});

  it('opens the exceptions and leaves the character suggestions closed while every one is checked', () => {
    expect(isGroupOpen('opening', {}, counts)).toBe(true);
    expect(isGroupOpen('reference', {}, counts)).toBe(true);
    expect(isGroupOpen('narration', {}, counts)).toBe(true);
    expect(isGroupOpen('characters', {}, counts)).toBe(false);
  });

  it('opens the character suggestions once one is unchecked', () => {
    expect(isGroupOpen('characters', {}, reviewCounts(preview, { characterCandidateIds: ['candidate-section-0007-001'] }))).toBe(true);
  });

  it('closes the narration chapters when there are many', () => {
    expect(isGroupOpen('narration', {}, { ...counts, narration: MANY_NARRATION_CHAPTERS })).toBe(true);
    expect(isGroupOpen('narration', {}, { ...counts, narration: MANY_NARRATION_CHAPTERS + 1 })).toBe(false);
  });

  it('opens the repairs when there are a few and closes them when there are many', () => {
    expect(isGroupOpen('repairs', {}, { ...counts, repairs: 3 })).toBe(true);
    expect(isGroupOpen('repairs', {}, { ...counts, repairs: 4 })).toBe(false);
  });

  it('gives way to what the narrator chose, either way', () => {
    expect(isGroupOpen('characters', { characters: true }, counts)).toBe(true);
    expect(isGroupOpen('reference', { reference: false }, counts)).toBe(false);
  });
});

describe('plural', () => {
  it('uses the singular for exactly one, and adds an s otherwise, or the plural given', () => {
    expect(plural(1, 'chapter')).toBe('chapter');
    expect(plural(0, 'chapter')).toBe('chapters');
    expect(plural(2, 'chapter')).toBe('chapters');
    expect(plural(2, 'entry', 'entries')).toBe('entries');
  });
});

describe('describeReview', () => {
  it('names the format, the paragraphs and only the narration chapters in the headline, with the rest on a second line', () => {
    expect(describeReview(preview, reviewCounts(preview, {}))).toEqual({
      headline: 'DOCX · 221 paragraphs · 5 narration chapters.',
      detail: '1 front matter section · 2 reference sections · 3 of 3 character suggestions checked',
    });
  });

  it('says one, not "1 chapters", and leaves out what was not found', () => {
    const small: ManuscriptImportPreview = {
      format: 'markdown',
      sourceName: 'a.md',
      paragraphCount: 1,
      chapterTitles: ['One'],
      sections: [{ id: 's1', title: 'One', contentKind: 'narration', paragraphCount: 1 }],
    };
    expect(describeReview(small, reviewCounts(small, {}))).toEqual({ headline: 'MARKDOWN · 1 paragraph · 1 narration chapter.', detail: '' });
  });

  it('counts the repairs, and one suggestion in the singular', () => {
    const repaired = mockImportPreview('repaired');
    const single = { ...repaired, characterCandidates: repaired.characterCandidates?.slice(0, 1) };
    expect(describeReview(single, reviewCounts(single, {})).detail).toBe(
      '1 front matter section · 2 reference sections · 1 of 1 character suggestion checked · 2 repairs made to the source',
    );
  });

  it('a PDF, which has no sections, keeps the proposed chapter count', () => {
    const pdf: ManuscriptImportPreview = { format: 'pdf', sourceName: 'a.pdf', paragraphCount: 3, chapterTitles: ['One', 'Two'] };
    expect(describeReview(pdf, reviewCounts(pdf, {}))).toEqual({ headline: 'PDF · 3 paragraphs · 2 proposed chapters.', detail: '' });
  });
});
