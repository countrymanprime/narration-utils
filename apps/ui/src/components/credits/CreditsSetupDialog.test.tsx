// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiProvider } from '../../api/ApiContext';
import { createMockApi } from '../../api/mockApi';
import type { CreditsSetupState, NarrationApi } from '../../types';
import { CreditsSetupDialog } from './CreditsSetupDialog';

afterEach(cleanup);

const STATE: CreditsSetupState = {
  needed: true,
  banner: true,
  dismissed: '',
  dismissedAt: null,
  documentId: 'doc-1',
  narratorGlobal: '',
  fields: [
    {
      token: 'Title',
      field: 'title',
      candidate: { token: 'Title', value: 'After the Applause', source: 'the title page', confidence: 'high', lines: ['AFTER', 'THE', 'APPLAUSE'] },
    },
    { token: 'Author', field: 'author', candidate: { token: 'Author', value: 'Adrian Crow', source: 'the byline and the copyright line', confidence: 'high' } },
    { token: 'Narrator', field: 'narrator', candidate: null },
  ],
  candidates: [
    { token: 'Year', value: '2026', source: 'the copyright line', confidence: 'high' },
    { token: 'CopyrightHolder', value: 'Adrian Crow', source: 'the copyright line', confidence: 'high' },
  ],
};

const byText = (text: string) => screen.getByText((_, element) => element?.textContent === text && element.children.length === 0);

function renderDialog(state: CreditsSetupState = STATE, overrides: Partial<NarrationApi> = {}, notify = vi.fn()) {
  const api = createMockApi(overrides);
  const onDone = vi.fn();
  const onMoreFields = vi.fn();
  render(
    <ApiProvider api={api}>
      <CreditsSetupDialog state={state} onDone={onDone} onMoreFields={onMoreFields} notify={notify} />
    </ApiProvider>,
  );
  return { api, onDone, onMoreFields, notify };
}

describe('CreditsSetupDialog (credits-token-setup-and-front-matter-detection.prd.md, Phase 2)', () => {
  it('prefills every field from its detected candidate and shows the source caption, recased where the manuscript line was all capitals', () => {
    renderDialog();
    expect(screen.getByRole('dialog', { name: 'Set up the credits' })).toBeTruthy();
    expect(screen.getByText(/Your opening and closing credits need 3 values\. We filled in what the manuscript already says/)).toBeTruthy();
    expect(screen.getByLabelText('Title')).toHaveProperty('value', 'After the Applause');
    expect(screen.getByLabelText('Author')).toHaveProperty('value', 'Adrian Crow');
    expect(byText('From the title page, lines 1–3: AFTER / THE / APPLAUSE (recased)')).toBeTruthy();
    expect(byText('From the byline and the copyright line')).toBeTruthy();
    // No candidate for Narrator: prefilled empty, with the "not detected" caption instead of a source.
    expect(screen.getByLabelText('Narrator')).toHaveProperty('value', '');
    expect(byText('Not set yet: nothing in the manuscript names the narrator.')).toBeTruthy();
  });

  it('marks a low-confidence candidate "check this"', () => {
    renderDialog({
      ...STATE,
      fields: [
        {
          token: 'Publisher',
          field: 'publisher',
          candidate: { token: 'Publisher', value: 'Macmillan', source: 'a line ending in "Publishers"', confidence: 'low' },
        },
      ],
      candidates: [],
    });
    expect(byText('From a line ending in "Publishers" (check this)')).toBeTruthy();
  });

  it('names the detected-but-unasked candidates and links to Settings > Credits (CS4 "More fields")', () => {
    const { onMoreFields } = renderDialog();
    expect(
      screen.getByText(
        (_, element) =>
          element?.tagName === 'P' &&
          element.textContent ===
            'Only empty values are filled in; nothing you have already set is changed. Year and Copyright Holder were also found and are waiting in Settings > Credits.',
      ),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Settings > Credits' }));
    expect(onMoreFields).toHaveBeenCalledTimes(1);
  });

  it('drops the "More fields" sentence when nothing extra was detected', () => {
    renderDialog({ ...STATE, candidates: [] });
    expect(screen.getByText('Only empty values are filled in; nothing you have already set is changed.')).toBeTruthy();
  });

  it('Save writes only the confirmed fields (creditsSetupSave never sees an unlisted key) and reports the new state', async () => {
    const creditsSetupSave = vi.fn().mockResolvedValue({ ...STATE, needed: false });
    const { onDone } = renderDialog(STATE, { creditsSetupSave });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(creditsSetupSave).toHaveBeenCalledTimes(1));
    expect(creditsSetupSave.mock.calls[0][0]).toEqual({ title: 'After the Applause', author: 'Adrian Crow', narrator: '' });
    await waitFor(() => expect(onDone).toHaveBeenCalledWith({ ...STATE, needed: false }));
  });

  it('"Use for all my projects" is checked by default and saves the global narrator setting before Save', async () => {
    const saveSettings = vi.fn().mockResolvedValue({});
    const creditsSetupSave = vi.fn().mockResolvedValue(STATE);
    renderDialog(STATE, { saveSettings, creditsSetupSave });
    fireEvent.change(screen.getByLabelText('Narrator'), { target: { value: 'Ada Finch' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(saveSettings).toHaveBeenCalledWith('General', 'global', { narrator_name: 'Ada Finch' }));
  });

  it('unchecking "Use for all my projects" saves only the project value, not the global default', async () => {
    const saveSettings = vi.fn().mockResolvedValue({});
    const creditsSetupSave = vi.fn().mockResolvedValue(STATE);
    renderDialog(STATE, { saveSettings, creditsSetupSave });
    fireEvent.click(screen.getByRole('checkbox', { name: /^Use for all my projects/ }));
    fireEvent.change(screen.getByLabelText('Narrator'), { target: { value: 'Ada Finch' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(creditsSetupSave).toHaveBeenCalled());
    expect(saveSettings).not.toHaveBeenCalled();
  });

  it('"Not now" dismisses for the session and reports the new state, without writing any field', async () => {
    const creditsSetupDismiss = vi.fn().mockResolvedValue({ ...STATE, needed: false, dismissed: 'session' });
    const creditsSetupSave = vi.fn();
    const { onDone } = renderDialog(STATE, { creditsSetupDismiss, creditsSetupSave });
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    await waitFor(() => expect(creditsSetupDismiss).toHaveBeenCalledWith('session'));
    expect(creditsSetupSave).not.toHaveBeenCalled();
    await waitFor(() => expect(onDone).toHaveBeenCalledWith({ ...STATE, needed: false, dismissed: 'session' }));
  });

  it('"Don\'t ask for this project" dismisses at the project scope', async () => {
    const creditsSetupDismiss = vi.fn().mockResolvedValue({ ...STATE, needed: false, banner: false, dismissed: 'project' });
    const { onDone } = renderDialog(STATE, { creditsSetupDismiss });
    fireEvent.click(screen.getByRole('button', { name: /^Don.t ask for this project$/ }));
    await waitFor(() => expect(creditsSetupDismiss).toHaveBeenCalledWith('project'));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith({ ...STATE, needed: false, banner: false, dismissed: 'project' }));
  });

  it('closing the dialog (the header Close button) behaves like "Not now"', async () => {
    const creditsSetupDismiss = vi.fn().mockResolvedValue({ ...STATE, needed: false, dismissed: 'session' });
    renderDialog(STATE, { creditsSetupDismiss });
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(creditsSetupDismiss).toHaveBeenCalledWith('session'));
  });

  it('reports an API error through notify and never calls onDone', async () => {
    const creditsSetupSave = vi.fn().mockRejectedValue(new Error('disk full'));
    const { onDone, notify } = renderDialog(STATE, { creditsSetupSave });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(notify).toHaveBeenCalled());
    expect(onDone).not.toHaveBeenCalled();
  });

  it('shows no "Use for all my projects" checkbox when Narrator is not among the asked fields', () => {
    renderDialog({ ...STATE, fields: STATE.fields.filter((field) => field.field !== 'narrator') });
    expect(screen.queryByRole('checkbox', { name: /^Use for all my projects/ })).toBeNull();
  });
});
