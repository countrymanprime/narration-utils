// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditingCheckPanel } from './EditingCheckPanel';
import { ApiProvider } from '../../api/ApiContext';
import { createMockApi } from '../../api/mockApi';
import { WIRE_CHAPTERS, editingCandidateFor } from '../../api/mockFixtures';

afterEach(cleanup);

// Chapter 7 (WIRE_CHAPTERS[6]) is already in `editing` status in the fixture manuscript (mockFixtures.ts), the only
// status the real engine (and this mock, apps/desktop/internal/stages D3) evaluates the editing signals for.
const chapter = WIRE_CHAPTERS[6];

type Initial = Parameters<typeof createMockApi>[1];

function renderPanel(initial: Initial = {}) {
  const api = createMockApi({}, initial);
  const notify = vi.fn();
  const close = vi.fn();
  render(
    <MemoryRouter>
      <ApiProvider api={api}>
        <EditingCheckPanel chapter={chapter} notify={notify} close={close} />
      </ApiProvider>
    </MemoryRouter>,
  );
  return { api, notify, close };
}

const panel = () => screen.findByRole('dialog', { name: new RegExp(`^Editing check: ${chapter.title}\\b`) });

describe('EditingCheckPanel', () => {
  it('shows the processed-audio caveat and a never-checked empty-space signal by default, with no scan started', async () => {
    renderPanel({ stages: { editing: { [chapter.id]: { unknown: 'never_analyzed' } } } });
    const dialog = await panel();
    expect(within(dialog).getByText(/Analysis of source audio; take FX, item gain and fades are not applied\./)).toBeTruthy();
    await waitFor(() => expect(within(dialog).getByText(/This chapter’s editing has not been checked yet\./)).toBeTruthy());
    // Click and breath are always unknown until Phase 4 validates them, whatever the chapter's own history.
    expect(within(dialog).getAllByText(/Not yet validated on the corpus/)).toHaveLength(2);
    expect(within(dialog).getByRole('button', { name: 'Check editing' })).toBeTruthy();
  });

  it('shows a stale reason at once, from the signal alone, with no click needed', async () => {
    renderPanel({ stages: { editing: { [chapter.id]: { unknown: 'stale' } } } });
    const dialog = await panel();
    await waitFor(() => expect(within(dialog).getByText(/Check editing again: since the last check an item/)).toBeTruthy());
  });

  it('an unmapped refusal offers the inline track link, and confirming it clears the refusal', async () => {
    const user = userEvent.setup();
    renderPanel({ editing: { refusal: 'unmapped' } });
    const dialog = await panel();
    await user.click(within(dialog).getByRole('button', { name: 'Check editing' }));
    await waitFor(() => expect(within(dialog).getByText(/This chapter can.t be checked yet/)).toBeTruthy());
    expect(within(dialog).getByText(/link this chapter to the REAPER track/)).toBeTruthy();
    await waitFor(() => screen.getByRole('combobox', { name: `Track for ${chapter.title}` }));
    await user.click(within(dialog).getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(within(dialog).queryByText(/This chapter can.t be checked yet/)).toBeNull());
  });

  it('running shows real progress and Cancel, and cancelling leaves a partial result the narrator can check again from', async () => {
    const user = userEvent.setup();
    renderPanel({ editing: { hold: true } });
    const dialog = await panel();
    await user.click(within(dialog).getByRole('button', { name: 'Check editing' }));
    await waitFor(() => expect(within(dialog).getByRole('progressbar', { name: 'Editing check progress' })).toBeTruthy());
    expect(within(dialog).queryByRole('button', { name: 'Check editing' })).toBeNull();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(within(dialog).queryByRole('progressbar')).toBeNull());
    expect(within(dialog).getByRole('button', { name: 'Check again' })).toBeTruthy();
  });

  it('lists a candidate with Hear, Accept, Dismiss, Defer and Go to in REAPER, and Accept saves through RD-4', async () => {
    const user = userEvent.setup();
    const candidate = editingCandidateFor(chapter.id, chapter.title, 0);
    renderPanel({ findings: [candidate], stages: { editing: { [chapter.id]: 'not_met' } } });
    const dialog = await panel();
    await waitFor(() => expect(within(dialog).getByText(/1 empty-space candidate/)).toBeTruthy());
    const row = within(dialog).getByLabelText(/Empty space at/);
    expect(within(row).getByRole('button', { name: /Hear/ })).toBeTruthy();
    expect(within(row).getByRole('button', { name: 'Go to in REAPER' })).toBeTruthy();
    await user.click(within(row).getByRole('button', { name: 'Accept' }));
    await waitFor(() => expect(within(row).getByText('Accepted.')).toBeTruthy());
  });

  it('has no source audio to hear for a candidate that is only a timeline gap between items', async () => {
    const candidate = editingCandidateFor(chapter.id, chapter.title, 0);
    const gapOnly = { ...candidate, time_range: { start: candidate.time_range!.start, end: candidate.time_range!.end } };
    renderPanel({ findings: [gapOnly] });
    const dialog = await panel();
    const row = await within(dialog).findByLabelText(/Empty space at/);
    expect(within(row).getByRole('button', { name: 'No audio to hear for Empty space' })).toHaveProperty('disabled', true);
  });
});
