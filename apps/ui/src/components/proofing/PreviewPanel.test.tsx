// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PreviewPanel } from './PreviewPanel';
import { ApiProvider } from '../../api/ApiContext';
import { createMockApi } from '../../api/mockApi';
import type { ManuscriptChapter, PreviewCandidate, PreviewResult } from '../../types';

afterEach(cleanup);

const CHAPTER: ManuscriptChapter = {
  id: 'chapter-1',
  title: 'Chapter One',
  index: 0,
  wordCount: 800,
  status: 'not_started',
  paragraphIds: [
    { id: 'p-1', index: 10 },
    { id: 'p-2', index: 11 },
    { id: 'p-3', index: 12 },
  ],
};

const CANDIDATE: PreviewCandidate = {
  chapterId: 'chapter-1',
  chapterTitle: 'Chapter One',
  paragraphIds: ['p-1', 'p-2', 'p-3'],
  wordCount: 780,
  estimatedSeconds: 302,
  shorter: false,
  reasons: ['Mixes narration and dialogue (33% of paragraphs have dialogue).', 'Starts and ends on paragraph boundaries.'],
  warnings: [],
};

function apiWith(result: PreviewResult, chapters: ManuscriptChapter[] = [CHAPTER]) {
  return createMockApi({
    previewCandidates: () => Promise.resolve(result),
    manuscriptChapters: () => Promise.resolve(chapters),
  });
}

describe('PreviewPanel (proofing-preview-suggestion.prd.md Phase 3)', () => {
  it('shows a computing message while the read is in flight', async () => {
    const hang = vi.fn(() => new Promise<PreviewResult>(() => {}));
    render(
      <ApiProvider api={createMockApi({ previewCandidates: hang })}>
        <PreviewPanel notify={vi.fn()} goToManuscript={vi.fn()} />
      </ApiProvider>,
    );
    expect(screen.getByRole('status').textContent).toMatch(/computing/i);
  });

  it('says so when there is no manuscript', async () => {
    render(
      <ApiProvider api={apiWith({ outcome: 'no_manuscript', candidates: [] })}>
        <PreviewPanel notify={vi.fn()} goToManuscript={vi.fn()} />
      </ApiProvider>,
    );
    await screen.findByText(/import a manuscript/i);
  });

  it('says so when nothing is eligible', async () => {
    render(
      <ApiProvider api={apiWith({ outcome: 'nothing_eligible', candidates: [] })}>
        <PreviewPanel notify={vi.fn()} goToManuscript={vi.fn()} />
      </ApiProvider>,
    );
    await screen.findByText(/no eligible text/i);
  });

  it('lists each candidate with its chapter, paragraph range, length, word count and reasons', async () => {
    render(
      <ApiProvider api={apiWith({ outcome: 'ok', candidates: [CANDIDATE] })}>
        <PreviewPanel notify={vi.fn()} goToManuscript={vi.fn()} />
      </ApiProvider>,
    );
    await screen.findByText('Chapter One');
    screen.getByText('paragraphs 1 to 3');
    screen.getByText('5:02');
    screen.getByText('780');
    screen.getByText(/Mixes narration and dialogue/);
  });

  it('shows a warning in text and an icon, never by colour alone', async () => {
    const warned: PreviewCandidate = { ...CANDIDATE, shorter: true, warnings: ['This chapter is shorter than the target length even in full.'] };
    render(
      <ApiProvider api={apiWith({ outcome: 'ok', candidates: [warned] })}>
        <PreviewPanel notify={vi.fn()} goToManuscript={vi.fn()} />
      </ApiProvider>,
    );
    const warning = await screen.findByText(/shorter than the target length/);
    // The icon sits beside the words - the words carry the meaning on their own (WCAG 1.4.1).
    expect(warning.closest('li')?.querySelector('svg')).toBeTruthy();
  });

  it('opens a candidate in the reader at its first paragraph', async () => {
    const goToManuscript = vi.fn();
    render(
      <ApiProvider api={apiWith({ outcome: 'ok', candidates: [CANDIDATE] })}>
        <PreviewPanel notify={vi.fn()} goToManuscript={goToManuscript} />
      </ApiProvider>,
    );
    fireEvent.click(await screen.findByRole('button', { name: /open chapter one in the manuscript reader/i }));
    expect(goToManuscript).toHaveBeenCalledWith('chapter-1', 10);
  });

  it('copies the range and length, then shows it was copied', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(
      <ApiProvider api={apiWith({ outcome: 'ok', candidates: [CANDIDATE] })}>
        <PreviewPanel notify={vi.fn()} goToManuscript={vi.fn()} />
      </ApiProvider>,
    );
    const copy = await screen.findByRole('button', { name: /copy range and length for chapter one/i });

    vi.useFakeTimers();
    try {
      await act(async () => {
        fireEvent.click(copy);
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(writeText).toHaveBeenCalledWith('Chapter One, paragraphs 1 to 3 (5:02)');
      screen.getByRole('button', { name: /^copied$/i });

      act(() => vi.advanceTimersByTime(2000));
      screen.getByRole('button', { name: /copy range and length for chapter one/i });
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports a failed read instead of an unhandled rejection', async () => {
    render(
      <ApiProvider api={createMockApi({ previewCandidates: () => Promise.reject(new Error('the host is busy')) })}>
        <PreviewPanel notify={vi.fn()} goToManuscript={vi.fn()} />
      </ApiProvider>,
    );
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/the host is busy/);
  });
});
