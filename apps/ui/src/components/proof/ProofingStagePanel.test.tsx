// @vitest-environment jsdom
// The Proofing page's own stage-suggestions panel (chapter-stage-recommendations.prd.md Phase 8): every narration
// chapter currently in Proofing, its verdict from the pickups signal (proofing-readiness-signals.prd.md Phase 1),
// and the same Confirm/Dismiss/Revert/Why affordances Home's breakdown table uses.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { ApiProvider } from '../../api/ApiContext';
import { createMockApi } from '../../api/mockApi';
import { WIRE_CHAPTERS } from '../../api/mockFixtures';
import type { NarrationApi } from '../../types';
import { ProofingStagePanel } from './ProofingStagePanel';

afterEach(cleanup);

// The fixture's two chapters already in Proofing status (mockFixtures.ts: index 8 and 9).
const [c9, c10] = WIRE_CHAPTERS.filter((chapter) => chapter.status === 'proofing');

function renderPanel(api: NarrationApi, notify = vi.fn(), goToManuscript = vi.fn()) {
  render(
    <MemoryRouter>
      <ApiProvider api={api}>
        <ProofingStagePanel notify={notify} goToManuscript={goToManuscript} refreshKey="test" />
      </ApiProvider>
    </MemoryRouter>,
  );
  return { notify, goToManuscript };
}

const row = (title: string) => screen.getByText(title).closest('tr') as HTMLElement;

describe('the Proofing page panel', () => {
  it('lists every chapter currently in Proofing, each unchecked by default', async () => {
    renderPanel(createMockApi());
    await waitFor(() => expect(within(row(c9.title)).getByText(/Can.t tell yet/)).toBeTruthy());
    expect(within(row(c10.title)).getByText(/Can.t tell yet/)).toBeTruthy();
    expect(screen.getByRole('table', { name: 'Chapters in proofing' })).toBeTruthy();
  });

  it('says no chapter is in Proofing when none are, instead of an empty table', async () => {
    const base = createMockApi();
    const api = { ...base, manuscriptChapters: async () => (await base.manuscriptChapters()).map((chapter) => ({ ...chapter, status: 'editing' as const })) };
    renderPanel(api);
    expect(await screen.findByText('No chapter is in Proofing right now.')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('reads "couldn’t read the chapter list" when the chapter list fails, without crashing on the suggestions read', async () => {
    const base = createMockApi();
    const api = { ...base, manuscriptChapters: async () => Promise.reject(new Error('the project could not be read')) };
    renderPanel(api);
    expect((await screen.findByRole('alert')).textContent).toBe('Couldn’t read the chapter list: the project could not be read');
  });

  it('shows a recommended verdict and confirms it, which moves the chapter to Finalized and off the panel', async () => {
    const api = createMockApi({}, { stages: { proofing: { [c9.id]: 'met' } } });
    const { notify } = renderPanel(api);
    await waitFor(() => expect(within(row(c9.title)).getByText('Suggested: Finalized')).toBeTruthy());
    fireEvent.click(within(row(c9.title)).getByRole('button', { name: `Confirm ${c9.title} as Finalized` }));
    await waitFor(() => expect(notify).toHaveBeenCalledWith(`${c9.title} moved to Finalized.`));
    await waitFor(() => expect(screen.queryByText(c9.title)).toBeNull());
    expect((await api.manuscriptChapters()).find((chapter) => chapter.id === c9.id)?.status).toBe('finalized');
  });

  it('shows a not-ready verdict when a pickup is open, naming the review page in the evidence', async () => {
    const api = createMockApi({}, { stages: { proofing: { [c9.id]: 'not_met' } } });
    renderPanel(api);
    await waitFor(() => expect(within(row(c9.title)).getByText('Not ready for Finalized')).toBeTruthy());
    fireEvent.click(within(row(c9.title)).getByRole('button', { name: `Why: ${c9.title}` }));
    const view = await screen.findByRole('dialog');
    expect(within(view).getByText(/open pickup/)).toBeTruthy();
    expect(within(view).getByText(/Review page/)).toBeTruthy();
  });

  it('names the cause of an unknown pickup check and links to the Tracks page, never "Open recording check"', async () => {
    const api = createMockApi({}, { stages: { proofing: { [c9.id]: { unknown: 'unmapped_track' } } } });
    renderPanel(api);
    await waitFor(() => expect(within(row(c9.title)).getByText(/no track linked/)).toBeTruthy());
    fireEvent.click(within(row(c9.title)).getByRole('button', { name: `Why: ${c9.title}` }));
    const view = await screen.findByRole('dialog');
    expect(within(view).getByRole('link', { name: 'Open Tracks' })).toBeTruthy();
    expect(within(view).queryByRole('button', { name: /Open recording check/ })).toBeNull();
    expect(within(view).queryByRole('button', { name: /Open editing check/ })).toBeNull();
  });

  it('dismisses a suggestion without changing the status, and Revert restores a confirmed chapter', async () => {
    const api = createMockApi({}, { stages: { proofing: { [c9.id]: 'met' } } });
    renderPanel(api);
    await waitFor(() => expect(within(row(c9.title)).getByText('Suggested: Finalized')).toBeTruthy());
    fireEvent.click(within(row(c9.title)).getByRole('button', { name: `Dismiss the suggestion for ${c9.title}` }));
    await waitFor(() => expect(within(row(c9.title)).getByText('Suggestion dismissed (Finalized)')).toBeTruthy());
    expect((await api.manuscriptChapters()).find((chapter) => chapter.id === c9.id)?.status).toBe('proofing');
  });
});
