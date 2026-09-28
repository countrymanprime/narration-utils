// @vitest-environment jsdom
// The Proof chapter view's readiness panel (proofing-readiness-signals.prd.md Phase 6): this one chapter's pickup
// roll-up and delivery-check suggestion, SR's evidence popover, and its chosen rendered file.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { ApiProvider } from '../../api/ApiContext';
import { createMockApi } from '../../api/mockApi';
import { WIRE_CHAPTERS } from '../../api/mockFixtures';
import type { ManuscriptChapter, NarrationApi } from '../../types';
import { ProofingStagePanel } from './ProofingStagePanel';

afterEach(cleanup);

// The fixture's two chapters already in Proofing status (mockFixtures.ts: index 8 and 9).
const [c9, c10] = WIRE_CHAPTERS.filter((chapter) => chapter.status === 'proofing');

function renderPanel(
  api: NarrationApi,
  chapter: ManuscriptChapter | undefined,
  { notify = vi.fn(), goToManuscript = vi.fn(), onStatusChanged = vi.fn(), onOpenFinding = vi.fn() } = {},
) {
  render(
    <MemoryRouter>
      <ApiProvider api={api}>
        <ProofingStagePanel
          notify={notify}
          chapter={chapter}
          goToManuscript={goToManuscript}
          refreshKey="test"
          onStatusChanged={onStatusChanged}
          onOpenFinding={onOpenFinding}
        />
      </ApiProvider>
    </MemoryRouter>,
  );
  return { notify, goToManuscript, onStatusChanged, onOpenFinding };
}

describe('the Proof chapter view’s readiness panel', () => {
  it('renders nothing for a chapter that is not in Proofing', () => {
    renderPanel(createMockApi(), { ...c9, status: 'editing' });
    expect(screen.queryByText('Proofing readiness')).toBeNull();
  });

  it('renders nothing while the chapter has not loaded yet', () => {
    renderPanel(createMockApi(), undefined);
    expect(screen.queryByText('Proofing readiness')).toBeNull();
  });

  it('shows an unchecked chapter’s suggestion by default', async () => {
    renderPanel(createMockApi(), c9);
    await waitFor(() => expect(screen.getByText(/Can.t tell yet/)).toBeTruthy());
    expect(screen.getByText('Proofing readiness')).toBeTruthy();
  });

  it('shows a recommended verdict, confirms it, and reports the new status', async () => {
    const api = createMockApi({}, { stages: { proofing: { [c9.id]: 'met' } } });
    const { notify, onStatusChanged } = renderPanel(api, c9);
    await waitFor(() => expect(screen.getByText('Suggested: Finalized')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: `Confirm ${c9.title} as Finalized` }));
    await waitFor(() => expect(notify).toHaveBeenCalledWith(`${c9.title} moved to Finalized.`));
    expect(onStatusChanged).toHaveBeenCalledWith('finalized');
  });

  it('shows a not-ready verdict when a pickup is open, and opens it inline from the evidence', async () => {
    const api = createMockApi({}, { stages: { proofing: { [c9.id]: 'not_met' } } });
    const { onOpenFinding } = renderPanel(api, c9);
    await waitFor(() => expect(screen.getByText('Not ready for Finalized')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: `Why: ${c9.title}` }));
    const view = await screen.findByRole('dialog');
    fireEvent.click(await within(view).findByRole('button', { name: 'Open this note' }));
    expect(onOpenFinding).toHaveBeenCalledWith(`mock-proofing-finding-${c9.id}`);
  });

  it('names the cause of an unknown pickup check and opens the audio engine panel, never "Open recording check"', async () => {
    const api = createMockApi({}, { stages: { proofing: { [c9.id]: { unknown: 'unmapped_track' } } } });
    renderPanel(api, c9);
    await waitFor(() => expect(screen.getByText(/no track linked/)).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: `Why: ${c9.title}` }));
    const view = await screen.findByRole('dialog');
    expect(within(view).getByRole('button', { name: 'Open the audio engine panel' })).toBeTruthy();
    expect(within(view).queryByRole('button', { name: /Open recording check/ })).toBeNull();
    expect(within(view).queryByRole('button', { name: /Open editing check/ })).toBeNull();
  });

  it('dismisses a suggestion without changing the status, and Revert restores a confirmed chapter', async () => {
    const api = createMockApi({}, { stages: { proofing: { [c9.id]: 'met' } } });
    renderPanel(api, c9);
    await waitFor(() => expect(screen.getByText('Suggested: Finalized')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: `Dismiss the suggestion for ${c9.title}` }));
    await waitFor(() => expect(screen.getByText('Suggestion dismissed (Finalized)')).toBeTruthy());
  });

  it('shows the second Proofing chapter’s own readiness too', async () => {
    renderPanel(createMockApi(), c10);
    await waitFor(() => expect(screen.getByText(/Can.t tell yet/)).toBeTruthy());
  });

  it('shows the chosen rendered file, offers Measure once one is chosen, and updates it after measuring', async () => {
    const { notify } = renderPanel(createMockApi(), c9);
    await waitFor(() => expect(screen.getByText('Choose the rendered file for this chapter.')).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'Measure' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Choose rendered file' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Measure' })).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Change' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Clear' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Measure' }));
    await waitFor(() => expect(screen.getByText(/Measured/)).toBeTruthy());
    expect(notify).not.toHaveBeenCalledWith(expect.stringContaining('error'), 'error');

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    await waitFor(() => expect(screen.getByText('Choose the rendered file for this chapter.')).toBeTruthy());
  });
});
