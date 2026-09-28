// @vitest-environment jsdom
// The stage suggestions on the Production board, end to end against the mock host (chapter-stage-recommendations.prd.md Phase 5): the
// current-stage cells, the summary chips, Confirm, Dismiss, Revert, a refused decision, Check now, the error state and the evidence view.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { useCallback, useState } from 'react';
import { ApiProvider } from '../../api/ApiContext';
import { createMockApi } from '../../api/mockApi';
import { WIRE_CHAPTERS } from '../../api/mockFixtures';
import type { ProductionOverview } from '../../api/contracts/production';
import type { StagesSeed } from '../../api/stagesMock';
import type { NarrationApi } from '../../types';
import type { Notify } from '../primitives/Toast';
import { ChapterBoard } from '../production/ChapterBoard';

afterEach(cleanup);

const [c4, c5, , c7, c8] = WIRE_CHAPTERS.slice(3, 8).map((chapter) => chapter.id);

/** The `?mockStages=mixed` seed of main.tsx: one chapter in each state. */
const MIXED: StagesSeed = {
  recording: { [c5]: { unknown: 'unmapped_track' }, [c7]: 'not_met', [c8]: 'met' },
  confirmed: [c7, c8],
};

function mixedApi(overrides: Partial<NarrationApi> = {}) {
  return createMockApi(overrides, { stages: MIXED, coverage: { measured: { [c4]: 1 } } });
}

// The board as the Production home holds it, reading the overview again whenever the board says something changed.
function Board({ api, initial, ...props }: { api: NarrationApi; initial: ProductionOverview; notify: Notify; goToScript: () => void }) {
  const [overview, setOverview] = useState(initial);
  const changed = useCallback(() => void api.productionOverview().then(setOverview), [api]);
  return <ChapterBoard overview={overview} {...props} goToProofChapter={() => {}} onChanged={changed} />;
}

async function renderBoard(api: NarrationApi, notify = vi.fn(), goToScript = vi.fn()) {
  const overview = await api.productionOverview();
  render(
    <MemoryRouter>
      <ApiProvider api={api}>
        <Board api={api} initial={overview} notify={notify} goToScript={goToScript} />
      </ApiProvider>
    </MemoryRouter>,
  );
  await screen.findByRole('grid', { name: 'Chapter pipeline' });
  return { notify, goToScript };
}

/** One board cell, by the chapter's title and the column's name. */
const cell = (title: string, column: string) => {
  const grid = screen.getByRole('grid', { name: 'Chapter pipeline', hidden: true });
  const columns = within(grid)
    .getAllByRole('columnheader', { hidden: true })
    .map((header) => header.textContent);
  const row = within(grid)
    .getByRole('rowheader', { name: new RegExp(`^${title} —`), hidden: true })
    .closest('tr') as HTMLElement;
  return within(row).getAllByRole('gridcell', { hidden: true })[columns.indexOf(column) - 1];
};

/** Opens a chapter's stage suggestion from its current stage cell. */
const openStage = async (title: string, column: 'Record' | 'Edit' = 'Record') => {
  fireEvent.click(cell(title, column));
  return screen.findByRole('dialog', { name: new RegExp(`^Stage suggestion: ${title} —`) });
};

const statusOf = (view: HTMLElement, title: string) => (within(view).getByLabelText(`${title} status`) as HTMLSelectElement).value;

describe('stage suggestions on the board', () => {
  it('summarizes suggestions and changed evidence in chips, and a chip opens the first suggested chapter', async () => {
    await renderBoard(mixedApi());
    const chip = await screen.findByRole('button', { name: '1 chapter has a suggestion' });
    expect(screen.getByRole('button', { name: '1 chapter’s evidence changed' })).toBeTruthy();
    fireEvent.click(chip);
    expect(await screen.findByRole('dialog', { name: 'Stage suggestion: Chapter 4 — The Rabbit Sends in a Little Bill' })).toBeTruthy();
  });

  it('shows no chip when nothing is suggested and no evidence changed', async () => {
    await renderBoard(createMockApi());
    expect(cell('Chapter 6', 'Record').textContent).toBe('Not ready');
    await waitFor(() => expect(screen.queryByRole('button', { name: /has a suggestion/ })).toBeNull());
    expect(screen.queryByRole('button', { name: /evidence changed/ })).toBeNull();
  });

  it("gives every chapter's current stage cell its verdict", async () => {
    await renderBoard(mixedApi());
    expect(cell('Chapter 4', 'Record').textContent).toBe('Ready');
    expect(cell('Chapter 5', 'Record').textContent).toBe('Not checked');
    expect(cell('Chapter 6', 'Record').textContent).toBe('Not ready');
    await waitFor(() => expect(cell('Chapter 7', 'Edit').textContent).toBe('Evidence changed'));
    expect(cell('Chapter 8', 'Record').textContent).toBe('✓');
    // A finalized chapter is not evaluated: every stage it passed reads ✓.
    expect(['Record', 'Edit', 'Proof'].map((column) => cell('Chapter 1', column).textContent)).toEqual(['✓', '✓', '✓']);
  });

  it('confirms a suggestion: the status moves, the view offers Revert, and Revert moves it back', async () => {
    const api = mixedApi();
    const { notify } = await renderBoard(api);
    const view = await openStage('Chapter 4');
    expect(statusOf(view, 'Chapter 4')).toBe('recording');
    fireEvent.click(await within(view).findByRole('button', { name: 'Confirm Editing' }));
    await waitFor(() => expect(statusOf(view, 'Chapter 4')).toBe('editing'));
    expect(notify).toHaveBeenCalledWith('Chapter 4 moved to Editing.');
    expect((await api.manuscriptChapters()).find((chapter) => chapter.id === c4)?.status).toBe('editing');
    await waitFor(() => expect(cell('Chapter 4', 'Record').textContent).toBe('✓'));
    const confirmed = await within(view).findByRole('region', { name: 'Confirmed' });
    fireEvent.click(within(confirmed).getByRole('button', { name: 'Revert to Recording' }));
    await waitFor(() => expect(statusOf(view, 'Chapter 4')).toBe('recording'));
    await waitFor(() => expect(cell('Chapter 4', 'Record').textContent).toBe('Ready'));
  });

  it('dismisses a suggestion without touching the status', async () => {
    await renderBoard(mixedApi());
    const view = await openStage('Chapter 4');
    fireEvent.click(await within(view).findByRole('button', { name: 'Dismiss' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: /has a suggestion/, hidden: true })).toBeNull());
    expect(statusOf(view, 'Chapter 4')).toBe('recording');
    expect(within(view).queryByRole('button', { name: 'Dismiss' })).toBeNull();
  });

  it('says a refused decision and reads the suggestions again', async () => {
    const base = mixedApi();
    const stageRecommendations = vi.fn(base.stageRecommendations);
    const api = {
      ...base,
      stageRecommendations,
      stageConfirm: async () => ({
        status: 'refused' as const,
        reason: 'basis_changed' as const,
        message: 'the evidence changed while you were looking; check again',
      }),
    };
    const { notify } = await renderBoard(api);
    const view = await openStage('Chapter 4');
    const confirm = await within(view).findByRole('button', { name: 'Confirm Editing' });
    const reads = stageRecommendations.mock.calls.length;
    fireEvent.click(confirm);
    await waitFor(() => expect(notify).toHaveBeenCalledWith('The evidence changed while you were looking; check again.', 'error'));
    await waitFor(() => expect(stageRecommendations.mock.calls.length).toBe(reads + 1));
    expect(statusOf(view, 'Chapter 4')).toBe('recording');
  });

  it('says the suggestions could not be read, in the chip, the line and the stage view, and Try again retries', async () => {
    let fail = true;
    const base = mixedApi();
    const api = {
      ...base,
      stageRecommendations: async () => {
        if (fail) throw new Error('the saved REAPER project could not be read');
        return base.stageRecommendations();
      },
    };
    await renderBoard(api);
    expect(await screen.findByRole('button', { name: 'Couldn’t check stage suggestions' })).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toBe('Couldn’t check stage suggestions: the saved REAPER project could not be read');
    const view = await openStage('Chapter 4');
    expect(within(view).getByRole('alert').textContent).toMatch(/^Couldn’t check this chapter: the saved REAPER project could not be read/);
    fireEvent.click(within(view).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('button', { name: '1 chapter has a suggestion' })).toBeTruthy();
  });

  it('shows no Check now or Try again above the board after a successful read', async () => {
    await renderBoard(mixedApi());
    await screen.findByRole('button', { name: '1 chapter has a suggestion' });
    expect(screen.queryByRole('button', { name: 'Check now' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('says a chapter is being checked until the first read answers', async () => {
    let answer: () => void = () => {};
    const base = mixedApi();
    const api = {
      ...base,
      stageRecommendations: () =>
        new Promise<Awaited<ReturnType<typeof base.stageRecommendations>>>((resolve) => (answer = () => void base.stageRecommendations().then(resolve))),
    };
    await renderBoard(api);
    const view = await openStage('Chapter 4');
    expect(within(view).getByRole('status').textContent).toBe('Checking…');
    answer();
    expect(await within(view).findByText(/looks ready to move from Recording to Editing/)).toBeTruthy();
  });

  it('says so when the engine gives a chapter no stage suggestion', async () => {
    const base = mixedApi();
    const stageRecommendations = async () => {
      const read = await base.stageRecommendations();
      return { ...read, chapters: read.chapters.filter((chapter) => chapter.chapterId !== WIRE_CHAPTERS[10].id) };
    };
    await renderBoard({ ...base, stageRecommendations });
    await screen.findByRole('button', { name: '1 chapter has a suggestion' });
    const view = await openStage('Chapter 11');
    expect(await within(view).findByText('No stage suggestion for this chapter.')).toBeTruthy();
  });

  it('reads the suggestions again after the status is changed by hand', async () => {
    const base = mixedApi();
    const stageRecommendations = vi.fn(base.stageRecommendations);
    await renderBoard({ ...base, stageRecommendations });
    const view = await openStage('Chapter 6');
    await within(view).findByText('Not met.');
    const reads = stageRecommendations.mock.calls.length;
    fireEvent.change(within(view).getByLabelText('Chapter 6 status'), { target: { value: 'editing' } });
    await waitFor(() => expect(stageRecommendations.mock.calls.length).toBe(reads + 1));
    await waitFor(() => expect(cell('Chapter 6', 'Record').textContent).toBe('✓'));
  });

  it('reads the suggestions and the chapter list again when the window regains focus (home-stage-check-line.prd.md Phase 2)', async () => {
    const base = mixedApi();
    const stageRecommendations = vi.fn(base.stageRecommendations);
    const manuscriptChapters = vi.fn(base.manuscriptChapters);
    await renderBoard({ ...base, stageRecommendations, manuscriptChapters });
    await screen.findByRole('button', { name: '1 chapter has a suggestion' });
    const stageReads = stageRecommendations.mock.calls.length;
    const chapterReads = manuscriptChapters.mock.calls.length;
    fireEvent(window, new Event('focus'));
    await waitFor(() => expect(stageRecommendations.mock.calls.length).toBe(stageReads + 1));
    await waitFor(() => expect(manuscriptChapters.mock.calls.length).toBe(chapterReads + 1));
  });
});

describe('the evidence view', () => {
  it('states what was checked, the evidence, the saved project it was read from, and confirms from there', async () => {
    await renderBoard(mixedApi());
    const view = await openStage('Chapter 4');
    expect(await within(view).findByText(/looks ready to move from Recording to Editing/)).toBeTruthy();
    const check = within(view).getByRole('region', { name: /Every paragraph of the chapter’s text is in the recording/ });
    expect(within(check).getByText('Met.')).toBeTruthy();
    expect(within(check).getByText('Text present:')).toBeTruthy();
    expect(within(check).getByText(/Based on the saved REAPER project, file modified/)).toBeTruthy();
    fireEvent.click(within(view).getByRole('button', { name: 'Confirm Editing' }));
    await waitFor(() => expect(statusOf(view, 'Chapter 4')).toBe('editing'));
    expect(await within(view).findByRole('region', { name: 'Confirmed' })).toBeTruthy();
  });

  it('names the cause of an unknown check and opens the recording check that resolves it', async () => {
    await renderBoard(mixedApi());
    const view = await openStage('Chapter 5');
    expect(await within(view).findByText('Can’t tell yet.')).toBeTruthy();
    expect(within(view).getByText(/never counts as done/)).toBeTruthy();
    expect(within(view).getByText('Link the track in the recording check, or in the audio engine panel.')).toBeTruthy();
    fireEvent.click(within(view).getByRole('button', { name: 'Open recording check' }));
    expect(await screen.findByRole('dialog', { name: 'Recording check: Chapter 5 — Advice from a Caterpillar' })).toBeTruthy();
  });

  it('opens the recording and editing checks from the buttons above the verdict', async () => {
    await renderBoard(mixedApi());
    fireEvent.click(within(await openStage('Chapter 5')).getByRole('button', { name: 'Recording check' }));
    expect(await screen.findByRole('dialog', { name: 'Recording check: Chapter 5 — Advice from a Caterpillar' })).toBeTruthy();
    cleanup();
    await renderBoard(mixedApi());
    fireEvent.click(within(await openStage('Chapter 5')).getByRole('button', { name: 'Editing check' }));
    expect(await screen.findByRole('dialog', { name: 'Editing check: Chapter 5 — Advice from a Caterpillar' })).toBeTruthy();
  });

  it('links a paragraph the evidence names to the manuscript', async () => {
    const { goToScript } = await renderBoard(mixedApi());
    const view = await openStage('Chapter 6');
    expect(await within(view).findByText('Not met.')).toBeTruthy();
    fireEvent.click(within(view).getByRole('button', { name: /^Go to paragraph \d+$/ }));
    expect(goToScript).toHaveBeenCalledWith(WIRE_CHAPTERS[5].id, expect.any(Number));
  });

  it('shows the check that is no longer met after a confirmation, and reverts from there', async () => {
    await renderBoard(mixedApi());
    await waitFor(() => expect(cell('Chapter 7', 'Edit').textContent).toBe('Evidence changed'));
    const view = await openStage('Chapter 7', 'Edit');
    const notice = await within(view).findByRole('region', { name: 'Evidence changed since you confirmed' });
    expect(within(notice).getByText(/Nothing has changed/)).toBeTruthy();
    expect(within(view).getByText('What changed')).toBeTruthy();
    fireEvent.click(within(notice).getByRole('button', { name: 'Revert to Recording' }));
    await waitFor(() => expect(statusOf(view, 'Chapter 7')).toBe('recording'));
  });
});
