// @vitest-environment jsdom
// The stage suggestions on the Home estimate card, end to end against the mock host (chapter-stage-recommendations.prd.md Phase 5):
// the rows, the summary chips, Confirm, Dismiss, Revert, a refused decision, Check now, the error state and the evidence view.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { ApiProvider } from '../../api/ApiContext';
import { createMockApi } from '../../api/mockApi';
import { WIRE_CHAPTERS } from '../../api/mockFixtures';
import type { StagesSeed } from '../../api/stagesMock';
import type { NarrationApi } from '../../types';
import { AudiobookEstimatePanel } from '../home/AudiobookEstimatePanel';

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

function renderPanel(api: NarrationApi, notify = vi.fn(), goToManuscript = vi.fn()) {
  render(
    <MemoryRouter>
      <ApiProvider api={api}>
        <AudiobookEstimatePanel notify={notify} goToManuscript={goToManuscript} />
      </ApiProvider>
    </MemoryRouter>,
  );
  return { notify, goToManuscript };
}

async function expandBreakdown() {
  fireEvent.click(await screen.findByRole('button', { name: /Show per-chapter breakdown/ }));
  await screen.findByText('Suggested: Editing');
}

const row = (title: string) => screen.getByRole('link', { name: new RegExp(`^${title} —`) }).closest('tr') as HTMLElement;

describe('stage suggestions on Home', () => {
  it('summarizes suggestions and changed evidence on the collapsed card, and a chip opens the breakdown', async () => {
    renderPanel(mixedApi());
    const chip = await screen.findByRole('button', { name: '1 chapter has a suggestion' });
    expect(screen.getByRole('button', { name: '1 chapter’s evidence changed' })).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
    fireEvent.click(chip);
    expect(screen.getByRole('table')).toBeTruthy();
  });

  it('shows no chip when nothing is suggested and no evidence changed', async () => {
    renderPanel(createMockApi());
    await screen.findByText('Audiobook estimate');
    fireEvent.click(screen.getByRole('button', { name: /Show per-chapter breakdown/ }));
    await waitFor(() => expect(within(row('Chapter 6')).getByText('Not ready for Editing')).toBeTruthy());
    expect(screen.queryByRole('button', { name: /has a suggestion/ })).toBeNull();
  });

  it('gives every row its verdict next to the status select, which stays', async () => {
    renderPanel(mixedApi());
    await expandBreakdown();
    expect(within(row('Chapter 4')).getByLabelText('Chapter 4 status')).toBeTruthy();
    expect(within(row('Chapter 4')).getByRole('button', { name: 'Confirm Chapter 4 as Editing' })).toBeTruthy();
    expect(within(row('Chapter 5')).getByText('Can’t tell yet: no track linked')).toBeTruthy();
    expect(within(row('Chapter 6')).getByText('Not ready for Editing')).toBeTruthy();
    expect(within(row('Chapter 7')).getByText('Evidence changed since you confirmed')).toBeTruthy();
    expect(within(row('Chapter 8')).getByText('Confirmed from Recording')).toBeTruthy();
    // A finalized chapter is not evaluated, and its row says nothing.
    expect(within(row('Chapter 1')).queryByRole('button', { name: /Why/ })).toBeNull();
  });

  it('confirms a suggestion: the status moves, the row offers Revert, and Revert moves it back', async () => {
    const api = mixedApi();
    const { notify } = renderPanel(api);
    await expandBreakdown();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Chapter 4 as Editing' }));
    await waitFor(() => expect((screen.getByLabelText('Chapter 4 status') as HTMLSelectElement).value).toBe('editing'));
    expect(notify).toHaveBeenCalledWith('Chapter 4 moved to Editing.');
    expect((await api.manuscriptChapters()).find((chapter) => chapter.id === c4)?.status).toBe('editing');
    fireEvent.click(within(row('Chapter 4')).getByRole('button', { name: 'Revert to Recording: Chapter 4' }));
    await waitFor(() => expect((screen.getByLabelText('Chapter 4 status') as HTMLSelectElement).value).toBe('recording'));
    expect(within(row('Chapter 4')).getByText('Suggested: Editing')).toBeTruthy();
  });

  it('dismisses a suggestion without touching the status', async () => {
    const api = mixedApi();
    renderPanel(api);
    await expandBreakdown();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss the suggestion for Chapter 4' }));
    await waitFor(() => expect(within(row('Chapter 4')).getByText('Suggestion dismissed (Editing)')).toBeTruthy());
    expect((screen.getByLabelText('Chapter 4 status') as HTMLSelectElement).value).toBe('recording');
    expect(screen.queryByRole('button', { name: /has a suggestion/ })).toBeNull();
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
    const { notify } = renderPanel(api);
    await expandBreakdown();
    const reads = stageRecommendations.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Chapter 4 as Editing' }));
    await waitFor(() => expect(notify).toHaveBeenCalledWith('The evidence changed while you were looking; check again.', 'error'));
    await waitFor(() => expect(stageRecommendations.mock.calls.length).toBe(reads + 1));
    expect((screen.getByLabelText('Chapter 4 status') as HTMLSelectElement).value).toBe('recording');
  });

  it('reads every row as "Couldn’t check" when the suggestions cannot be read, and Check now tries again', async () => {
    let fail = true;
    const base = mixedApi();
    const api = {
      ...base,
      stageRecommendations: async () => {
        if (fail) throw new Error('the saved REAPER project could not be read');
        return base.stageRecommendations();
      },
    };
    renderPanel(api);
    expect(await screen.findByRole('button', { name: 'Couldn’t check stage suggestions' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Show per-chapter breakdown/ }));
    expect(screen.getByRole('alert').textContent).toBe('Couldn’t check stage suggestions: the saved REAPER project could not be read');
    expect(within(row('Chapter 4')).getByText('Couldn’t check')).toBeTruthy();
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Check now' }));
    await waitFor(() => expect(within(row('Chapter 4')).getByText('Suggested: Editing')).toBeTruthy());
  });

  it('says a row is being checked until the first read answers', async () => {
    let answer: () => void = () => {};
    const base = mixedApi();
    const api = {
      ...base,
      stageRecommendations: () =>
        new Promise<Awaited<ReturnType<typeof base.stageRecommendations>>>((resolve) => (answer = () => void base.stageRecommendations().then(resolve))),
    };
    renderPanel(api);
    fireEvent.click(await screen.findByRole('button', { name: /Show per-chapter breakdown/ }));
    expect(within(row('Chapter 4')).getByText('Checking…')).toBeTruthy();
    answer();
    await waitFor(() => expect(within(row('Chapter 4')).getByText('Suggested: Editing')).toBeTruthy());
  });

  it('reads the suggestions again after the status is changed by hand', async () => {
    const base = mixedApi();
    const stageRecommendations = vi.fn(base.stageRecommendations);
    renderPanel({ ...base, stageRecommendations });
    await expandBreakdown();
    const reads = stageRecommendations.mock.calls.length;
    fireEvent.change(screen.getByLabelText('Chapter 6 status'), { target: { value: 'editing' } });
    await waitFor(() => expect(stageRecommendations.mock.calls.length).toBe(reads + 1));
    await waitFor(() => expect(within(row('Chapter 6')).queryByText('Not ready for Editing')).toBeNull());
  });
});

describe('the evidence view', () => {
  it('states what was checked, the evidence, the saved project it was read from, and confirms from there', async () => {
    renderPanel(mixedApi());
    await expandBreakdown();
    fireEvent.click(screen.getByRole('button', { name: 'Why: Chapter 4' }));
    const view = await screen.findByRole('dialog', { name: 'Stage suggestion: Chapter 4' });
    expect(within(view).getByText(/looks ready to move from Recording to Editing/)).toBeTruthy();
    const check = within(view).getByRole('region', { name: /Every paragraph of the chapter’s text is in the recording/ });
    expect(within(check).getByText('Met.')).toBeTruthy();
    expect(within(check).getByText('Text present:')).toBeTruthy();
    expect(within(check).getByText(/Based on the saved REAPER project, file modified/)).toBeTruthy();
    fireEvent.click(within(view).getByRole('button', { name: 'Confirm Editing' }));
    await waitFor(() => expect((screen.getByLabelText('Chapter 4 status') as HTMLSelectElement).value).toBe('editing'));
    expect(await within(view).findByRole('region', { name: 'Confirmed' })).toBeTruthy();
  });

  it('names the cause of an unknown check and opens the recording check that resolves it', async () => {
    renderPanel(mixedApi());
    await expandBreakdown();
    fireEvent.click(screen.getByRole('button', { name: 'Why: Chapter 5' }));
    const view = await screen.findByRole('dialog', { name: 'Stage suggestion: Chapter 5' });
    expect(within(view).getByText('Can’t tell yet.')).toBeTruthy();
    expect(within(view).getByText(/never counts as done/)).toBeTruthy();
    expect(within(view).getByText('Link the track in the recording check, or on the Tracks page.')).toBeTruthy();
    fireEvent.click(within(view).getByRole('button', { name: 'Open recording check' }));
    expect(await screen.findByRole('dialog', { name: 'Recording check: Chapter 5' })).toBeTruthy();
  });

  it('links a paragraph the evidence names to the manuscript', async () => {
    const { goToManuscript } = renderPanel(mixedApi());
    await expandBreakdown();
    fireEvent.click(screen.getByRole('button', { name: 'Why: Chapter 6' }));
    const view = await screen.findByRole('dialog', { name: 'Stage suggestion: Chapter 6' });
    expect(within(view).getByText('Not met.')).toBeTruthy();
    fireEvent.click(within(view).getByRole('button', { name: /^Go to paragraph \d+$/ }));
    expect(goToManuscript).toHaveBeenCalledWith(WIRE_CHAPTERS[5].id, expect.any(Number));
  });

  it('shows the check that is no longer met after a confirmation, and reverts from there', async () => {
    renderPanel(mixedApi());
    await expandBreakdown();
    fireEvent.click(screen.getByRole('button', { name: 'Why: Chapter 7' }));
    const view = await screen.findByRole('dialog', { name: 'Stage suggestion: Chapter 7' });
    const notice = within(view).getByRole('region', { name: 'Evidence changed since you confirmed' });
    expect(within(notice).getByText(/Nothing has changed/)).toBeTruthy();
    expect(within(view).getByText('What changed')).toBeTruthy();
    fireEvent.click(within(notice).getByRole('button', { name: 'Revert to Recording' }));
    await waitFor(() => expect((screen.getByLabelText('Chapter 7 status') as HTMLSelectElement).value).toBe('recording'));
  });
});
