// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiProvider } from '../../api/ApiContext';
import { createMockApi } from '../../api/mockApi';
import type { ManuscriptChapter, NarrationApi } from '../../types';
import { TooltipProvider } from '../primitives/Tooltip';
import { ChapterWaveformCard } from './ChapterWaveformCard';

afterEach(cleanup);

const chapters = [
  { id: 'ch-1', title: 'Down the Rabbit-Hole', number: 1 },
  { id: 'ch-2', title: 'The Pool of Tears', number: 2 },
] as unknown as ManuscriptChapter[];

function renderCard(overrides: Partial<NarrationApi> = {}, list: ManuscriptChapter[] = chapters) {
  const api = createMockApi(overrides);
  const onChapterChange = vi.fn();
  const onOpenChapter = vi.fn();
  const view = (chapterId: string) => (
    <ApiProvider api={api}>
      <TooltipProvider>
        <ChapterWaveformCard chapters={list} chapterId={chapterId} onChapterChange={onChapterChange} onOpenChapter={onOpenChapter} />
      </TooltipProvider>
    </ApiProvider>
  );
  const result = render(view('ch-1'));
  return { api, onChapterChange, onOpenChapter, rerender: (chapterId: string) => result.rerender(view(chapterId)) };
}

describe('ChapterWaveformCard', () => {
  it('offers every chapter in its selector and reports a change', async () => {
    const user = userEvent.setup();
    const { onChapterChange } = renderCard();
    const picker = screen.getByRole('combobox', { name: 'Chapter to open' });
    expect((picker as HTMLSelectElement).value).toBe('ch-1');
    await user.selectOptions(picker, 'ch-2');
    expect(onChapterChange).toHaveBeenCalledWith('ch-2');
  });

  it("opens the selected chapter's own view", async () => {
    const user = userEvent.setup();
    const { onOpenChapter } = renderCard();
    await user.click(screen.getByRole('button', { name: 'Open chapter' }));
    expect(onOpenChapter).toHaveBeenCalledWith('ch-1');
  });

  it('says so when the chapter has no recording, rather than drawing a fake waveform', async () => {
    renderCard({ tracksList: async () => ({ tracks: [] }) as never });
    expect(await screen.findByText(/has no recording to draw yet/i)).toBeTruthy();
    expect(screen.queryByRole('region', { name: "The chapter's waveform" })).toBeNull();
  });

  it('says so when there are no chapters at all', () => {
    renderCard({}, []);
    expect(screen.getByText(/no chapters to show/i)).toBeTruthy();
    expect(screen.queryByRole('combobox')).toBeNull();
  });

  it('shows a load failure inline', async () => {
    renderCard({ workspacePeaks: async () => Promise.reject(new Error('boom')) });
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/Couldn.t load/i));
  });
});
