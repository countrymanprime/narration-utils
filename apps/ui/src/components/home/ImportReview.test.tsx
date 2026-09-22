// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ImportReview, ImportSummary } from './ImportReview';
import type { ReviewGroupOpen } from './importReviewModel';
import { mockImportPreview, type MockImportKind } from '../../api/mockImportPreview';
import type { ManuscriptImportPreview, ManuscriptImportSelection } from '../../types';

afterEach(() => {
  (document.activeElement as HTMLElement | null)?.blur();
  cleanup();
});

// The review is controlled, as Home holds it: the choices and the groups the narrator opened by hand live above it.
function Harness({
  preview,
  onHeadingLevelChange = () => {},
  buildStoryBible,
  start = {},
}: {
  preview: ManuscriptImportPreview;
  onHeadingLevelChange?: (level: number) => void;
  buildStoryBible?: { checked: boolean; onChange: (checked: boolean) => void };
  start?: ManuscriptImportSelection;
}) {
  const [selection, setSelection] = useState<ManuscriptImportSelection>(start);
  const [groupOpen, setGroupOpen] = useState<ReviewGroupOpen>({});
  return (
    <>
      <ImportSummary preview={preview} selection={selection} requiresReset={false} />
      <ImportReview
        preview={preview}
        selection={selection}
        onSelectionChange={(update) => setSelection(update)}
        headingLevel={1}
        onHeadingLevelChange={onHeadingLevelChange}
        groupOpen={groupOpen}
        onGroupOpenChange={(group, open) => setGroupOpen((current) => ({ ...current, [group]: open }))}
        buildStoryBible={buildStoryBible}
      />
    </>
  );
}

const renderReview = (kind: MockImportKind = 'docx', props: Partial<Parameters<typeof Harness>[0]> = {}) =>
  render(<Harness preview={mockImportPreview(kind)} {...props} />);
const groupButton = (name: RegExp) => screen.getByRole('button', { name });

describe('ImportReview', () => {
  it('lists the detected chapters of a PDF, which has no sections to review', () => {
    render(<Harness preview={{ format: 'pdf', sourceName: 'Old.pdf', paragraphCount: 10, chapterTitles: ['One', 'Two'] }} />);
    expect(screen.getByText('Detected chapters: One · Two')).toBeTruthy();
    expect(screen.queryByText('Review what was found')).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('is grouped by what each section will be, with a count on every group', () => {
    renderReview();
    expect(groupButton(/^Narration chapters 5 chapters$/).getAttribute('aria-expanded')).toBe('true');
    expect(groupButton(/^Front matter 1 section$/).getAttribute('aria-expanded')).toBe('true');
    expect(groupButton(/^Reference material 2 sections$/).getAttribute('aria-expanded')).toBe('true');
    expect(groupButton(/^Story Bible character suggestions 3 of 3 checked$/).getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByRole('combobox', { name: 'Glossary content type' })).toBeTruthy();
  });

  it('does not show the sentence about reference material, nor the preview activity', () => {
    renderReview();
    expect(screen.queryByText(/stays readable but is excluded/)).toBeNull();
    expect(screen.queryByText('Preview activity')).toBeNull();
    expect(document.querySelector('.progressbar')).toBeNull();
  });

  it('puts a note on front matter and on reference material, each true for its group, and none on the chapters', () => {
    renderReview();
    expect(screen.getByRole('button', { name: 'About reference material' }).getAttribute('aria-description')).toBe(
      'Excluded from audiobook totals, Proofing and the chapter list. Still readable in the manuscript.',
    );
    expect(screen.getByRole('button', { name: 'About front matter' }).getAttribute('aria-description')).toMatch(/excluded from audiobook totals and Proofing/);
    expect(screen.getAllByRole('button', { name: /^About / })).toHaveLength(2);
  });

  it('shows the note when the keyboard reaches the icon, and Escape hides it', async () => {
    const user = userEvent.setup();
    renderReview();
    const info = screen.getByRole('button', { name: 'About reference material' });
    for (let presses = 0; document.activeElement !== info && presses < 20; presses++) await user.tab();
    expect(document.activeElement).toBe(info);
    expect((await screen.findByRole('tooltip')).textContent).toMatch(/Still readable in the manuscript/);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('collapses and expands a group on a press, and keeps what the narrator chose', async () => {
    const user = userEvent.setup();
    renderReview();
    await user.click(groupButton(/^Narration chapters/));
    expect(screen.queryByRole('combobox', { name: 'Chapter Three content type' })).toBeNull();
    await user.click(groupButton(/^Narration chapters/));
    expect(screen.getByRole('combobox', { name: 'Chapter Three content type' })).toBeTruthy();
  });

  it('moves a reclassified row to its new group at once, updates the counts, and keeps focus on the select', async () => {
    renderReview();
    fireEvent.change(screen.getByRole('combobox', { name: 'Glossary content type' }), { target: { value: 'narration' } });
    expect(groupButton(/^Narration chapters 6 chapters$/)).toBeTruthy();
    expect(groupButton(/^Reference material 1 section$/)).toBeTruthy();
    expect(screen.getByText(/^DOCX · 221 paragraphs · 6 narration chapters\.$/)).toBeTruthy();
    const moved = screen.getByRole('combobox', { name: 'Glossary content type' }) as HTMLSelectElement;
    expect(moved.value).toBe('narration');
    expect(document.activeElement).toBe(moved);
  });

  it('opens a group that a row is moved into, and removes a group left with no rows', async () => {
    const user = userEvent.setup();
    renderReview();
    await user.click(groupButton(/^Narration chapters/));
    fireEvent.change(screen.getByRole('combobox', { name: 'Front Matter content type' }), { target: { value: 'narration' } });
    expect(screen.queryByRole('button', { name: /^Front matter/ })).toBeNull();
    expect(groupButton(/^Narration chapters 6 chapters$/).getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('combobox', { name: 'Front Matter content type' })).toBeTruthy();
  });

  it('counts the character suggestions live, opens them once one is unchecked, and selects all or none', async () => {
    const user = userEvent.setup();
    renderReview();
    await user.click(groupButton(/^Story Bible character suggestions/));
    await user.click(screen.getByRole('checkbox', { name: /^The White Rabbit/ }));
    expect(groupButton(/^Story Bible character suggestions 2 of 3 checked$/).getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText(/2 of 3 character suggestions checked/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Select none' }));
    expect(groupButton(/^Story Bible character suggestions 0 of 3 checked$/)).toBeTruthy();
    expect(screen.getAllByRole('checkbox').every((box) => box.getAttribute('aria-checked') === 'false')).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Select all' }));
    expect(groupButton(/^Story Bible character suggestions 3 of 3 checked$/)).toBeTruthy();
  });

  it('says what the importer repaired, and shows nothing about repairs when it repaired nothing', () => {
    const { unmount } = renderReview('repaired');
    expect(groupButton(/^Repairs 2 made to the source$/).getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText(/CHAPTER ONEDown the Rabbit-Hole/)).toBeTruthy();
    expect(screen.getByText(/2 repairs made to the source/)).toBeTruthy();
    unmount();
    renderReview('docx');
    expect(screen.queryByRole('button', { name: /^Repairs/ })).toBeNull();
  });

  it('a Markdown file has the heading level in an options group, and reports the level chosen', () => {
    const onHeadingLevelChange = vi.fn();
    renderReview('markdown', { onHeadingLevelChange });
    expect(screen.getByText('Import options')).toBeTruthy();
    fireEvent.change(screen.getByRole('combobox', { name: 'Markdown chapter heading level' }), { target: { value: '3' } });
    expect(onHeadingLevelChange).toHaveBeenCalledWith(3);
  });

  it('a Word file has no options to show, and no checkbox for building the Story Bible until it is handed one', () => {
    renderReview('docx');
    expect(screen.queryByText('Import options')).toBeNull();
    expect(screen.queryByRole('checkbox', { name: /Build the Story Bible after import/ })).toBeNull();
  });

  it('draws the Story Bible build choice when handed one, and reports a change (the seam for the briefs work)', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderReview('docx', { buildStoryBible: { checked: true, onChange } });
    const box = screen.getByRole('checkbox', { name: /Build the Story Bible after import/ });
    expect(box.getAttribute('aria-checked')).toBe('true');
    await user.click(box);
    expect(onChange.mock.calls[0]?.[0]).toBe(false);
  });

  it('keeps a long title and subtitle in one row that can be cut short, with the whole line for a hover', () => {
    renderReview();
    const row = screen.getByText('Chapter Four');
    expect(row.className).toContain('truncate');
    expect(row.getAttribute('title')).toMatch(/^Chapter Four — In Which Alice Considers/);
  });
});

describe('ImportSummary', () => {
  it('leads with the format, size and narration chapters, then what else exists, and adds what a replacement clears', () => {
    render(<ImportSummary preview={mockImportPreview('docx')} selection={{}} requiresReset />);
    expect(screen.getByText(/^DOCX · 221 paragraphs · 5 narration chapters\. This replaces the active manuscript and clears Story Bible/)).toBeTruthy();
    expect(screen.getByText('1 front matter section · 2 reference sections · 3 of 3 character suggestions checked')).toBeTruthy();
  });
});
