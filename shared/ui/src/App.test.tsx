// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { ApiProvider } from './api/ApiContext';
import { createMockApi } from './api/mockApi';

// BrowserRouter reads/writes the real window.location via history.pushState,
// which jsdom keeps alive across tests in this file - reset it so each test
// starts at "/".
beforeEach(() => {
  window.history.replaceState(null, '', '/');
});
afterEach(cleanup);

function renderApp(overrides: Parameters<typeof createMockApi>[0] = {}) {
  const api = createMockApi(overrides);
  render(
    <ApiProvider api={api}>
      <App />
    </ApiProvider>,
  );
  return api;
}

describe('App (integration, driven through the mock NarrationApi)', () => {
  it('shows the startup screen, then Home once bootstrap resolves', async () => {
    renderApp();
    expect(screen.getByText(/Opening Narration Console/)).toBeTruthy();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Welcome back' })).toBeTruthy());
    expect(screen.getAllByText('Alice’s Adventures in Wonderland').length).toBeGreaterThan(0);
  });

  it('shows an actionable error screen when bootstrap fails', async () => {
    renderApp({ bootstrap: () => Promise.reject(new Error('no project open')) });
    await waitFor(() => expect(screen.getByText('Desktop host needs attention')).toBeTruthy());
    expect(screen.getByText(/no project open/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Retry connection/ })).toBeTruthy();
  });

  it('navigates to Story Bible and lists entities from the backend', async () => {
    renderApp();
    await waitFor(() => screen.getByRole('heading', { name: 'Welcome back' }));
    fireEvent.click(screen.getByRole('button', { name: /Open Story Bible/ }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Story Bible' })).toBeTruthy());
    expect((await screen.findAllByText('Alice')).length).toBeGreaterThan(0);
  });

  it('Story Bible has no stale detection notice, and entry actions render as icon-only buttons on one row', async () => {
    renderApp();
    await waitFor(() => screen.getByRole('heading', { name: 'Welcome back' }));
    fireEvent.click(screen.getByRole('button', { name: /Open Story Bible/ }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Story Bible' })).toBeTruthy());
    await screen.findAllByText('Alice');

    expect(screen.queryByText(/Detection cleaned up/)).toBeNull();

    const saveButton = await screen.findByRole('button', { name: 'Save changes to this entry' });
    expect(saveButton.textContent?.trim()).toBe('');

    const addAliasButton = screen.getByRole('button', { name: 'Add alias' });
    const rescanButton = screen.getByRole('button', { name: /Rescan occurrences/ });
    expect(addAliasButton.closest('.alias-match-actions')).toBe(rescanButton.closest('.alias-match-actions'));
  });

  it('guards navigating away from unsaved Settings changes and saves on confirm', async () => {
    const saveSettings = vi.fn(createMockApi().saveSettings);
    renderApp({ saveSettings });
    await waitFor(() => screen.getByRole('heading', { name: 'Welcome back' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Settings' })[0]);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Settings' })).toBeTruthy());

    const modelField = await screen.findByDisplayValue('normal');
    fireEvent.change(modelField, { target: { value: 'verbose' } });
    expect(screen.getByText('Unsaved changes')).toBeTruthy();

    fireEvent.click(screen.getAllByRole('button', { name: 'Home' })[0]);
    expect(await screen.findByText('Save or discard changes before leaving Settings?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save & continue' }));

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Welcome back' })).toBeTruthy());
    expect(saveSettings).toHaveBeenCalledWith('General', 'global', expect.objectContaining({ log_verbosity: 'verbose' }));
  });
});
