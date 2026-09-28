// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ManuscriptChapter } from '../../api/contracts/manuscript';
import { RemovedFromRecordingList } from './RemovedFromRecordingList';

afterEach(cleanup);

const chapter = (overrides: Partial<ManuscriptChapter> = {}): ManuscriptChapter => ({
  id: 'c-part-two',
  title: 'PART TWO',
  index: 5,
  wordCount: 212,
  status: 'not_started',
  contentKind: 'reference',
  removedFromRecording: true,
  kindChangedAt: new Date().toISOString(),
  ...overrides,
});

describe('RemovedFromRecordingList', () => {
  it('renders nothing when no chapter is removed', () => {
    const { container } = render(<RemovedFromRecordingList chapters={[]} restoringId="" onRestore={() => {}} />);
    expect(container.textContent).toBe('');
  });

  it('lists a removed chapter with its word count and reason, and offers Restore', () => {
    render(<RemovedFromRecordingList chapters={[chapter()]} restoringId="" onRestore={() => {}} />);
    expect(screen.getByText('Removed from recording (1)')).toBeTruthy();
    expect(screen.getByText(/212 words · removed today as not a chapter/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Restore' })).toBeTruthy();
  });

  it('labels front matter distinctly from a non-chapter', () => {
    render(<RemovedFromRecordingList chapters={[chapter({ contentKind: 'opening' })]} restoringId="" onRestore={() => {}} />);
    expect(screen.getByText(/removed today as front matter/)).toBeTruthy();
  });

  it('calls onRestore with the chapter id', () => {
    const onRestore = vi.fn();
    render(<RemovedFromRecordingList chapters={[chapter()]} restoringId="" onRestore={onRestore} />);
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
    expect(onRestore).toHaveBeenCalledWith('c-part-two');
  });

  it('leaves a chapter that was not removed out of the list', () => {
    render(<RemovedFromRecordingList chapters={[chapter({ removedFromRecording: undefined })]} restoringId="" onRestore={() => {}} />);
    expect(screen.queryByText(/Removed from recording/)).toBeNull();
  });
});
