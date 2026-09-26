// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiProvider } from '../../api/ApiContext';
import { createMockApi } from '../../api/mockApi';
import type { CreditsSetupState, NarrationApi } from '../../types';
import { CreditsSetupBanner } from './CreditsSetupBanner';

afterEach(cleanup);

const STATE: CreditsSetupState = {
  needed: false,
  banner: true,
  dismissed: 'session',
  dismissedAt: null,
  documentId: 'doc-1',
  narratorGlobal: '',
  fields: [
    { token: 'Title', field: 'title', candidate: null },
    { token: 'Author', field: 'author', candidate: null },
    { token: 'Narrator', field: 'narrator', candidate: null },
  ],
  candidates: [],
};

function renderBanner(state: CreditsSetupState = STATE, overrides: Partial<NarrationApi> = {}, notify = vi.fn()) {
  const api = createMockApi(overrides);
  const onDone = vi.fn();
  const onFillIn = vi.fn();
  render(
    <ApiProvider api={api}>
      <CreditsSetupBanner state={state} onDone={onDone} onFillIn={onFillIn} notify={notify} />
    </ApiProvider>,
  );
  return { api, onDone, onFillIn, notify };
}

describe('CreditsSetupBanner (credits-token-setup-and-front-matter-detection.prd.md, Phase 3)', () => {
  it('names the unresolved tokens and how they will read', () => {
    renderBanner();
    expect(screen.getByText('The credits need 3 values')).toBeTruthy();
    expect(screen.getByText(/Title, Author, Narrator will be read as written, in brackets\./)).toBeTruthy();
  });

  it('singular wording for one token', () => {
    renderBanner({ ...STATE, fields: [STATE.fields[0]] });
    expect(screen.getByText('The credits need 1 value')).toBeTruthy();
  });

  it('Fill in calls onFillIn without touching the host', () => {
    const { onFillIn, api } = renderBanner();
    const spy = vi.spyOn(api, 'creditsSetupDismiss');
    fireEvent.click(screen.getByRole('button', { name: 'Fill in' }));
    expect(onFillIn).toHaveBeenCalledTimes(1);
    expect(spy).not.toHaveBeenCalled();
  });

  it('"Don\'t ask for this project" dismisses at the project scope and reports the new state', async () => {
    const creditsSetupDismiss = vi.fn().mockResolvedValue({ ...STATE, banner: false, dismissed: 'project' });
    const { onDone } = renderBanner(STATE, { creditsSetupDismiss });
    fireEvent.click(screen.getByRole('button', { name: /^Don.t ask for this project$/ }));
    await waitFor(() => expect(creditsSetupDismiss).toHaveBeenCalledWith('project'));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith({ ...STATE, banner: false, dismissed: 'project' }));
  });

  it('reports an API error through notify and never calls onDone', async () => {
    const creditsSetupDismiss = vi.fn().mockRejectedValue(new Error('disk full'));
    const { onDone, notify } = renderBanner(STATE, { creditsSetupDismiss });
    fireEvent.click(screen.getByRole('button', { name: /^Don.t ask for this project$/ }));
    await waitFor(() => expect(notify).toHaveBeenCalled());
    expect(onDone).not.toHaveBeenCalled();
  });
});
