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

  it('wires every primary page through the application router', async () => {
    renderApp();
    await screen.findByRole('heading', { name: 'Welcome back' });

    fireEvent.click(screen.getAllByRole('button', { name: 'Manuscript' })[0]);
    await screen.findByRole('heading', { name: 'Manuscript' });

    fireEvent.click(screen.getAllByRole('button', { name: 'Proofing' })[0]);
    await screen.findByRole('heading', { name: 'Proofing' });

    fireEvent.click(screen.getAllByRole('button', { name: 'Story Bible' })[0]);
    await screen.findByRole('heading', { name: 'Story Bible' });

    fireEvent.click(screen.getAllByRole('button', { name: 'Settings' })[0]);
    await screen.findByRole('heading', { name: 'Settings' });

    fireEvent.click(screen.getAllByRole('button', { name: 'Home' })[0]);
    await screen.findByRole('heading', { name: 'Welcome back' });
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

  it('keeps fast manuscript-import activity visible and refreshes the Home state without a browser reload', async () => {
    const source = createMockApi();
    let imported = false;
    const importedChapters = [{ id: 'c-1', title: 'Chapter 1', index: 0, wordCount: 1234, status: 'not_started' as const }];
    const bootstrap = vi.fn(async () => {
      const data = await source.bootstrap();
      return { ...data, manuscript: imported ? data.manuscript : null };
    });
    const api = createMockApi({
      bootstrap,
      manuscriptChapters: async () => (imported ? importedChapters : []),
      manuscriptImportCommit: async () => {
        imported = true;
        return {
          id: 'mock-import',
          kind: 'manuscript_import',
          phase: 'success',
          percent: 100,
          elapsed: 1,
          message: 'Manuscript import complete.',
          logs: [
            'Selected Alice.docx.',
            'Parsing and validating the manuscript…',
            'Import preview is ready.',
            'Writing the project-owned manuscript…',
            'Manuscript import complete.',
          ],
          result: { id: 'alice', format: 'docx', sourceName: 'Alice.docx', importedAt: '2026-01-01T00:00:00Z' },
        };
      },
    });
    render(
      <ApiProvider api={api}>
        <App />
      </ApiProvider>,
    );

    await screen.findByRole('heading', { name: 'Welcome back' });
    expect(screen.getByText(/No imported manuscript/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Import manuscript…' }));
    await screen.findByRole('dialog', { name: 'Import Alice.docx' });
    expect(screen.getByText('Preview activity')).toBeTruthy();
    expect(document.querySelector('.progressbar')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    const activity = await screen.findByRole('dialog', { name: 'Import manuscript' });
    expect(activity.querySelector('.progressbar')).toBeTruthy();
    expect(await screen.findByText('Writing the project-owned manuscript…')).toBeTruthy();
    expect((await screen.findAllByText('Manuscript import complete.')).length).toBeGreaterThanOrEqual(2);
    await waitFor(() => expect(bootstrap.mock.calls.length).toBeGreaterThanOrEqual(2));
    expect(screen.getByText(/Manuscript found/)).toBeTruthy();
    expect(await screen.findByText('1,234 words · 1 chapters · ~150 words/min narrated')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog', { name: 'Import manuscript' })).toBeNull();
    fireEvent.click(screen.getAllByRole('button', { name: 'Story Bible' })[0]);
    await screen.findByRole('heading', { name: 'Story Bible' });
    fireEvent.click(screen.getAllByRole('button', { name: 'Home' })[0]);
    await screen.findByRole('heading', { name: 'Welcome back' });
    expect(screen.getByText(/Manuscript found/)).toBeTruthy();
  });
});
