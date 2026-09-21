// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { ApiProvider } from './api/ApiContext';
import { createMockApi } from './api/mockApi';
import { ThemeProvider } from './theme/ThemeContext';
import { parseWire } from './api/wire/parseWire';
import { bootstrapSchema } from './api/schemas/system';
import type { WorkJob } from './types';

// BrowserRouter reads/writes the real window.location via history.pushState,
// which jsdom keeps alive across tests in this file - reset it so each test
// starts at "/".
beforeEach(() => {
  window.history.replaceState(null, '', '/');
});
afterEach(cleanup);

function renderApp(overrides: Parameters<typeof createMockApi>[0] = {}, initial: Parameters<typeof createMockApi>[1] = {}) {
  const api = createMockApi(overrides, initial);
  render(
    <ThemeProvider>
      <ApiProvider api={api}>
        <App />
      </ApiProvider>
    </ThemeProvider>,
  );
  return api;
}

// A project with no imported manuscript but a manuscript file in its folder.
const bootstrapWithCandidate = (manuscriptCandidate: { path: string; name: string }) => async () => ({
  ...(await createMockApi().bootstrap()),
  manuscript: null,
  manuscriptCandidate,
});

describe('App (integration, driven through the mock NarrationApi)', () => {
  it('shows the startup screen, then Home once bootstrap resolves', async () => {
    renderApp();
    expect(screen.getByText(/Opening Narration Console/)).toBeTruthy();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Welcome back' })).toBeTruthy());
    expect(screen.getAllByText('Alice’s Adventures in Wonderland').length).toBeGreaterThan(0);
    expect(screen.getByText(/2,672 words across 3 narratable chapters/)).toBeTruthy();
    expect(await screen.findByText(/Chapter 1 · 3 audio items/)).toBeTruthy();
    expect(screen.queryByText(/Ch\.1 take 4/)).toBeNull();
  });

  it('shows an actionable error screen when bootstrap fails', async () => {
    renderApp({ bootstrap: () => Promise.reject(new Error('no project open')) });
    await waitFor(() => expect(screen.getByText('Desktop host needs attention')).toBeTruthy());
    expect(screen.getByText(/no project open/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Retry connection/ })).toBeTruthy();
  });

  it('shows a plain message, technical details and Copy details when Bootstrap does not match its schema', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const good = await createMockApi().bootstrap();
    renderApp({
      bootstrap: async () =>
        parseWire(
          bootstrapSchema,
          { ...good, projectName: 42, transcript: { ...good.transcript, phase: 'bogus' } },
          { boundary: 'host.binding', payload: 'Bootstrap' },
        ),
    });

    await waitFor(() => expect(screen.getByText('Desktop host needs attention')).toBeTruthy());
    expect(screen.getByText('The app received data it could not read.')).toBeTruthy();
    const details = screen.getByLabelText('Technical details').textContent ?? '';
    expect(details).toContain('host.binding Bootstrap');
    expect(details).toContain('projectName');
    expect(details).toContain('transcript.phase');
    fireEvent.click(screen.getByRole('button', { name: /Copy details/ }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(details));
    expect(await screen.findByRole('button', { name: /Copied/ })).toBeTruthy();
  });

  it('shows the Story Bible page an inline error with Retry when its entities cannot be read, and keeps navigation', async () => {
    renderApp({}, { invalidPayload: 'storybible' });
    await waitFor(() => screen.getByRole('heading', { name: 'Welcome back' }));
    fireEvent.click(screen.getByRole('button', { name: /Open Story Bible/ }));
    expect(await screen.findByText('This page could not be loaded')).toBeTruthy();
    expect(screen.getByText('The app received data it could not read.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
    // The rest of the app still works: the navigation is there and leads on.
    fireEvent.click(screen.getAllByRole('button', { name: /Home/ })[0]);
    expect(await screen.findByRole('heading', { name: 'Welcome back' })).toBeTruthy();
  });

  it('shows the narrator a notice the host sends, such as a file it kept aside', async () => {
    renderApp({}, { notice: 'Your notes file could not be read. It was kept next to the original, and a fresh one was started.' });
    expect(await screen.findByText(/Your notes file could not be read/)).toBeTruthy();
  });

  it('tells the narrator when a check the app made on its own found a newer version', async () => {
    renderApp({}, { update: 'found' });
    expect(await screen.findByText(/Version 0\.2\.7 is available\. See Settings/)).toBeTruthy();
  });

  it('says nothing about updates when the check found nothing newer', async () => {
    renderApp({}, { update: 'current' });
    await waitFor(() => screen.getByRole('heading', { name: 'Welcome back' }));
    expect(screen.queryByText(/is available/)).toBeNull();
  });

  it('tells the narrator once when live updates from the host have been failing', async () => {
    renderApp({}, { liveUpdatesDegraded: true });
    expect(await screen.findByText(/live updates from the desktop host could not be read/)).toBeTruthy();
  });

  it('reports an incompatible host as a version problem even when its Bootstrap would not match', async () => {
    const bootstrap = vi.fn().mockRejectedValue(new Error('must not be reached'));
    renderApp({ ready: async () => ({ apiVersion: 99, diagnosticId: 'future-host' }), bootstrap });
    await waitFor(() => expect(screen.getByText(/Desktop host API version 99 is incompatible/)).toBeTruthy());
    expect(bootstrap).not.toHaveBeenCalled();
    expect(screen.queryByText('The app received data it could not read.')).toBeNull();
  });

  it('rejects an incompatible desktop-host API version', async () => {
    renderApp({ ready: async () => ({ apiVersion: 1, diagnosticId: 'old-host' }) });
    await waitFor(() => expect(screen.getByText('Desktop host needs attention')).toBeTruthy());
    expect(screen.getByText(/Desktop host API version 1 is incompatible/)).toBeTruthy();
  });

  it('navigates to Story Bible and lists entities from the backend', async () => {
    renderApp();
    await waitFor(() => screen.getByRole('heading', { name: 'Welcome back' }));
    fireEvent.click(screen.getByRole('button', { name: /Open Story Bible/ }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Story Bible' })).toBeTruthy());
    expect((await screen.findAllByText('Alice')).length).toBeGreaterThan(0);
  });

  it('does not create a Story Bible entity until a category is chosen for a new entry', async () => {
    const api = renderApp();
    const guideCreate = vi.spyOn(api, 'guideCreate');
    await waitFor(() => screen.getByRole('heading', { name: 'Welcome back' }));
    fireEvent.click(screen.getByRole('button', { name: /Open Story Bible/ }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Story Bible' })).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'Add entity' }));
    expect(await screen.findByDisplayValue(/New entity/)).toBeTruthy();
    expect(guideCreate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Choose category' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Character/ }));
    await waitFor(() => expect(guideCreate).toHaveBeenCalledTimes(1));
    expect(guideCreate).toHaveBeenCalledWith(expect.stringMatching(/New entity/), 'Character', []);
    expect(await screen.findByRole('button', { name: 'Delete entity' })).toBeTruthy();
  });

  it('opens Review Entry as a read-only overlay without discarding the in-progress edit', async () => {
    renderApp();
    await waitFor(() => screen.getByRole('heading', { name: 'Welcome back' }));
    fireEvent.click(screen.getByRole('button', { name: /Open Story Bible/ }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Story Bible' })).toBeTruthy());

    fireEvent.click((await screen.findAllByText('Alice'))[0]);
    const nameInput = await screen.findByDisplayValue('Alice');
    fireEvent.change(nameInput, { target: { value: 'Alice (editing)' } });

    const aliasInput = screen.getByPlaceholderText('Add an alias or find a matching entry…');
    fireEvent.change(aliasInput, { target: { value: 'White Rabbit' } });
    const matchList = await screen.findByRole('listbox', { name: 'Matching Story Bible entries' });
    fireEvent.click(within(matchList).getByRole('option', { name: /White Rabbit/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Review entry' }));

    expect(await screen.findByRole('button', { name: 'Close review panel' })).toBeTruthy();
    expect((screen.getByDisplayValue('Alice (editing)') as HTMLInputElement).value).toBe('Alice (editing)');
  });

  it('shows a repeated message as a fresh toast, so a second click on the same action gives a new signal', async () => {
    renderApp({ transcriptSuggestHints: async () => ({ terms: [], found: 0 }) });
    await screen.findByRole('heading', { name: 'Welcome back' });
    fireEvent.click(screen.getAllByRole('button', { name: 'Proofing' })[0]);
    await screen.findByRole('heading', { name: 'Proofing' });

    fireEvent.click(await screen.findByRole('button', { name: /Suggest from manuscript/ }));
    const first = await screen.findByRole('status');
    fireEvent.click(screen.getByRole('button', { name: /Suggest from manuscript/ }));

    await waitFor(() => expect(screen.getByRole('status')).not.toBe(first));
    expect(screen.getByRole('status').textContent).toBe(first.textContent);
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

  it('locks manuscript-dependent navigation and Home cards until a manuscript is imported', async () => {
    const source = createMockApi();
    renderApp({ bootstrap: async () => ({ ...(await source.bootstrap()), manuscript: null }) });
    await screen.findByRole('heading', { name: 'Welcome back' });

    for (const name of ['Manuscript', 'Proofing', 'Story Bible', 'Teleprompter']) {
      expect(screen.getAllByRole('button', { name }).every((button) => (button as HTMLButtonElement).disabled)).toBe(true);
    }
    expect((screen.getByRole('button', { name: 'Open Proofing' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Open Story Bible' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Import manuscript' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Import legacy Word file' })).toBeNull();
  });

  it('opens the Teleprompter with a manuscript, and sends a direct URL to Home without one', async () => {
    window.history.replaceState(null, '', '/');
    renderApp();
    await screen.findByRole('heading', { name: 'Welcome back' });

    fireEvent.click(screen.getAllByRole('button', { name: 'Teleprompter' })[0]);

    await screen.findByRole('heading', { name: 'Teleprompter' });
    expect(window.location.pathname).toBe('/teleprompter');
    cleanup();

    window.history.replaceState(null, '', '/teleprompter');
    const source = createMockApi();
    renderApp({ bootstrap: async () => ({ ...(await source.bootstrap()), manuscript: null }) });
    await screen.findByRole('heading', { name: 'Welcome back' });
    expect(window.location.pathname).toBe('/');
  });

  it('keeps Tracks reachable without a manuscript and lists the mock API tracks on its page', async () => {
    const source = createMockApi();
    renderApp({ bootstrap: async () => ({ ...(await source.bootstrap()), manuscript: null }) });
    await screen.findByRole('heading', { name: 'Welcome back' });

    const tracksButtons = screen.getAllByRole('button', { name: 'Tracks' });
    expect(tracksButtons.every((button) => !(button as HTMLButtonElement).disabled)).toBe(true);
    fireEvent.click(tracksButtons[0]);

    await screen.findByRole('heading', { name: 'Tracks' });
    expect(await screen.findByRole('button', { name: /Chapter 1/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Click Track/ })).toBeTruthy();
    expect(window.location.pathname).toBe('/tracks');
  });

  it('redirects a direct manuscript-dependent URL to Home when no manuscript exists', async () => {
    window.history.replaceState(null, '', '/proofing');
    const source = createMockApi();
    renderApp({ bootstrap: async () => ({ ...(await source.bootstrap()), manuscript: null }) });
    await screen.findByRole('heading', { name: 'Welcome back' });
    expect(window.location.pathname).toBe('/');
  });

  it('Story Bible has no stale detection notice, and entry actions render as icon-only buttons on one row', async () => {
    renderApp();
    await waitFor(() => screen.getByRole('heading', { name: 'Welcome back' }));
    fireEvent.click(screen.getByRole('button', { name: /Open Story Bible/ }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Story Bible' })).toBeTruthy());
    await screen.findAllByText('Alice');

    expect(screen.queryByText(/Detection cleaned up/)).toBeNull();

    expect(screen.queryByRole('button', { name: 'Save changes to this entry' })).toBeNull();
    const editButton = await screen.findByRole('button', { name: 'Edit this entry' });
    expect(editButton.textContent?.trim()).toBe('');
    fireEvent.click(editButton);
    expect((await screen.findByRole('button', { name: 'Save changes to this entry' })).textContent?.trim()).toBe('');

    const addAliasButton = screen.getByRole('button', { name: 'Add alias' });
    const rescanButton = screen.getByRole('button', { name: /Rescan occurrences/ });
    expect(addAliasButton.closest('[data-alias-actions]')).toBe(rescanButton.closest('[data-alias-actions]'));
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

  it('saves only the settings the narrator changed, so a field with no value yet is never sent as an empty string', async () => {
    const saveSettings = vi.fn(createMockApi().saveSettings);
    renderApp({ saveSettings });
    await waitFor(() => screen.getByRole('heading', { name: 'Welcome back' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Settings' })[0]);
    await screen.findByRole('heading', { name: 'Settings' });

    // A project has no override for any Proofing field until one is saved, so all of them are unset (empty) here. The
    // host rejects an empty choice or colour ("unsupported value for chunk_seconds"), so only the edited field may go.
    fireEvent.click(screen.getByRole('tab', { name: 'This Project' }));
    fireEvent.click(await screen.findByRole('tab', { name: 'Proofing' }));
    fireEvent.change(await screen.findByRole('combobox', { name: 'Default Whisper model' }), { target: { value: 'large-v3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(saveSettings).toHaveBeenCalledTimes(1));
    expect(saveSettings).toHaveBeenCalledWith('TranscriptCompare', 'project', { model_size: 'large-v3' });
  });

  it('does not call the host when an edit was put back, and leaves nothing marked unsaved', async () => {
    const saveSettings = vi.fn(createMockApi().saveSettings);
    renderApp({ saveSettings });
    await waitFor(() => screen.getByRole('heading', { name: 'Welcome back' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Settings' })[0]);
    await screen.findByRole('heading', { name: 'Settings' });

    const verbosity = await screen.findByDisplayValue('normal');
    fireEvent.change(verbosity, { target: { value: 'verbose' } });
    fireEvent.change(verbosity, { target: { value: 'normal' } });
    expect(screen.getByText('Unsaved changes')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(screen.queryByText('Unsaved changes')).toBeNull());
    expect(saveSettings).not.toHaveBeenCalled();
  });

  it('does not write an override when a field with no value of its own is put back to the value it inherits', async () => {
    const saveSettings = vi.fn(createMockApi().saveSettings);
    renderApp({ saveSettings });
    await waitFor(() => screen.getByRole('heading', { name: 'Welcome back' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Settings' })[0]);
    await screen.findByRole('heading', { name: 'Settings' });

    // A project shows the Global value ("small") for a field it has no override for. Changing it and changing it back must
    // not pin that value in the project, or a later change to the Global default would no longer reach it.
    fireEvent.click(screen.getByRole('tab', { name: 'This Project' }));
    fireEvent.click(await screen.findByRole('tab', { name: 'Proofing' }));
    const model = await screen.findByRole('combobox', { name: 'Default Whisper model' });
    fireEvent.change(model, { target: { value: 'large-v3' } });
    fireEvent.change(model, { target: { value: 'small' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(screen.queryByText('Unsaved changes')).toBeNull());
    expect(saveSettings).not.toHaveBeenCalled();
  });

  it('names the Settings tabs and keeps the selected one while unsaved changes ask before a switch', async () => {
    renderApp();
    await waitFor(() => screen.getByRole('heading', { name: 'Welcome back' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Settings' })[0]);
    await screen.findByRole('heading', { name: 'Settings' });
    expect(screen.getByRole('tablist', { name: 'Settings scope' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Global' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tablist', { name: 'Settings categories' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'General' }).getAttribute('aria-selected')).toBe('true');

    // A clean switch of scope happens at once, and the categories of that scope follow (General is Global only).
    fireEvent.click(screen.getByRole('tab', { name: 'This Project' }));
    await waitFor(() => expect(screen.getByRole('tab', { name: 'This Project' }).getAttribute('aria-selected')).toBe('true'));
    await waitFor(() => expect(screen.queryByRole('tab', { name: 'General' })).toBeNull());
    expect(
      within(screen.getByRole('tablist', { name: 'Settings categories' }))
        .getAllByRole('tab')
        .filter((tab) => tab.getAttribute('aria-selected') === 'true'),
    ).toHaveLength(1);
    fireEvent.click(screen.getByRole('tab', { name: 'Global' }));
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Global' }).getAttribute('aria-selected')).toBe('true'));

    fireEvent.click(screen.getByRole('tab', { name: 'General' }));
    // With an unsaved change, a switch asks first and the selection does not move until it is confirmed.
    fireEvent.change(await screen.findByDisplayValue('normal'), { target: { value: 'verbose' } });
    fireEvent.click(screen.getByRole('tab', { name: 'This Project' }));
    expect(await screen.findByText('Save or discard changes before continuing?')).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Global', hidden: true }).getAttribute('aria-selected')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Discard & continue' }));
    await waitFor(() => expect(screen.getByRole('tab', { name: 'This Project' }).getAttribute('aria-selected')).toBe('true'));
  });

  it('keeps fast manuscript-import activity visible and refreshes the Home state without a browser reload', async () => {
    const source = createMockApi();
    const readyJob = {
      id: 'mock-import',
      kind: 'manuscript_import' as const,
      phase: 'ready' as const,
      message: 'Import preview is ready.',
      percent: 100,
      logs: ['Selected manuscript', 'Import preview is ready.'],
      elapsed: 1,
      preview: { format: 'docx' as const, sourceName: 'Alice.docx', paragraphCount: 240, chapterTitles: ['Chapter 1'] },
    };
    // The host is the single source of truth for a job; polling reads the same
    // state the preview/commit calls return.
    let hostJob: WorkJob = readyJob;
    const preview = vi.fn(async () => (hostJob = readyJob));
    let imported = false;
    const importedChapters = [{ id: 'c-1', title: 'Chapter 1', index: 0, wordCount: 1234, status: 'not_started' as const }];
    const bootstrap = vi.fn(async () => {
      const data = await source.bootstrap();
      return { ...data, manuscript: imported ? data.manuscript : null };
    });
    const api = createMockApi({
      bootstrap,
      manuscriptImportPreview: preview,
      manuscriptImportState: async () => hostJob,
      manuscriptChapters: async () => (imported ? importedChapters : []),
      manuscriptImportCommit: async (): Promise<WorkJob> => {
        imported = true;
        return (hostJob = {
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
        });
      },
    });
    render(
      <ApiProvider api={api}>
        <App />
      </ApiProvider>,
    );

    await screen.findByRole('heading', { name: 'Welcome back' });
    expect(screen.getByText(/No imported manuscript/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Import manuscript' }));
    await screen.findByRole('alertdialog', { name: 'Import Alice.docx' });
    expect(preview).toHaveBeenCalledWith('mock-import', { markdownHeadingLevel: 1 });
    expect(screen.getByText('Preview activity')).toBeTruthy();
    expect(document.querySelector('.progressbar')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    const activity = await screen.findByRole('dialog', { name: 'Import manuscript' });
    expect(activity.querySelector('.progressbar')).toBeTruthy();
    expect(await screen.findByText('Writing the project-owned manuscript…')).toBeTruthy();
    expect((await screen.findAllByText('Manuscript import complete.')).length).toBeGreaterThanOrEqual(2);
    await waitFor(() => expect(bootstrap.mock.calls.length).toBeGreaterThanOrEqual(2));
    expect(await screen.findByText(/Manuscript found/)).toBeTruthy();
    expect(await screen.findByText('1,234 words · 1 chapters · ~150 words/min narrated')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog', { name: 'Import manuscript' })).toBeNull();
    fireEvent.click(screen.getAllByRole('button', { name: 'Story Bible' })[0]);
    await screen.findByRole('heading', { name: 'Story Bible' });
    fireEvent.click(screen.getAllByRole('button', { name: 'Home' })[0]);
    await screen.findByRole('heading', { name: 'Welcome back' });
    expect(screen.getByText(/Manuscript found/)).toBeTruthy();
  });

  it('offers to import a manuscript file found in the project folder, and stays quiet once declined', async () => {
    const candidate = { path: 'C:/Projects/Voltage/manuscript.docx', name: 'manuscript.docx' };
    renderApp({ bootstrap: bootstrapWithCandidate(candidate) });
    expect(await screen.findByRole('alertdialog', { name: 'Import manuscript?' })).toBeTruthy();
    expect(screen.getByText(/Found manuscript.docx in this project folder/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog', { name: 'Import manuscript?' })).toBeNull();
  });

  it('imports the offered manuscript file through the host when accepted', async () => {
    const candidate = { path: 'C:/Projects/Voltage/notes/manuscript.md', name: 'manuscript.md' };
    const api = renderApp({ bootstrap: bootstrapWithCandidate(candidate) });
    const beginImport = vi.spyOn(api, 'manuscriptBeginImport');
    await screen.findByRole('alertdialog', { name: 'Import manuscript?' });

    fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    await waitFor(() => expect(beginImport).toHaveBeenCalledWith(candidate.path));
    expect(await screen.findByRole('alertdialog', { name: 'Import Alice.docx' })).toBeTruthy();
  });

  it('shows the project picker instead of the routed app when a standalone launch has no attached project folder', async () => {
    renderApp({}, { projectFolder: '' });
    await waitFor(() => expect(screen.getByText('Open a project')).toBeTruthy());
    expect(screen.queryByRole('heading', { name: 'Welcome back' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Manuscript' })).toBeNull();
    expect(screen.queryByRole('navigation')).toBeNull();
  });

  it('transitions from the project picker to the routed app once a project is attached', async () => {
    renderApp({}, { projectFolder: '' });
    await waitFor(() => expect(screen.getByText('Voltage and the Undercroft')).toBeTruthy());

    fireEvent.click(screen.getByText('Voltage and the Undercroft'));

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Welcome back' })).toBeTruthy());
    expect(screen.queryByText('Open a project')).toBeNull();
  });
});
