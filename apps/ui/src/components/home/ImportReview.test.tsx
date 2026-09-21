// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ImportReview } from './ImportReview';
import { mockImportPreview } from '../../api/mockImportPreview';
import type { ManuscriptImportPreview } from '../../types';

afterEach(cleanup);

const idle = { percent: 100, logs: [] };

function renderReview(preview: ManuscriptImportPreview, onHeadingLevelChange = vi.fn()) {
  render(
    <ImportReview preview={preview} job={idle} selection={{}} onSelectionChange={() => {}} headingLevel={1} onHeadingLevelChange={onHeadingLevelChange} />,
  );
  return { onHeadingLevelChange };
}

describe('ImportReview', () => {
  it('lists the detected chapters of a PDF, which has no sections to review', () => {
    renderReview({ format: 'pdf', sourceName: 'Old.pdf', paragraphCount: 10, chapterTitles: ['One', 'Two'] });
    expect(screen.getByText('Detected chapters: One · Two')).toBeTruthy();
    expect(screen.queryByText('Review imported structure')).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('shows the preview activity the host reported, one row per log line', () => {
    render(
      <ImportReview
        preview={mockImportPreview('docx')}
        job={{ percent: 100, logs: ['Opening Word document Alice.docx', 'Preview ready'] }}
        selection={{}}
        onSelectionChange={() => {}}
        headingLevel={1}
        onHeadingLevelChange={() => {}}
      />,
    );
    expect(screen.getByText('Preview activity')).toBeTruthy();
    expect(screen.getByText('Opening Word document Alice.docx')).toBeTruthy();
    expect(screen.getByText('Preview ready')).toBeTruthy();
    // The log scrolls once it is longer than its box, so it is a tab stop.
    expect(screen.getByText('Preview ready').parentElement?.getAttribute('tabindex')).toBe('0');
  });

  it('reports the heading level a Markdown file is read at when the narrator changes it', () => {
    const { onHeadingLevelChange } = renderReview(mockImportPreview('markdown'));
    fireEvent.change(screen.getByRole('combobox', { name: 'Markdown chapter heading level' }), { target: { value: '3' } });
    expect(onHeadingLevelChange).toHaveBeenCalledWith(3);
  });
});
