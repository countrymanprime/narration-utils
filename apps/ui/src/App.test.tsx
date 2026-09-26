// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { ApiProvider } from './api/ApiContext';
import { createMockApi } from './api/mockApi';
import { ThemeProvider } from './theme/ThemeContext';
import { parseWire } from './api/wire/parseWire';
import { bootstrapSchema } from './api/schemas/system';
import type { GuideBuildResult, WorkJob } from './types';
import type { JobEnded } from './api/contracts/system';
import { CommandRouter } from './input/router';

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
        {/* Matches main.tsx's tree (input-commands-and-pedals.prd.md Phase 2): App now calls useCommand for
            nav.back/nav.forward, which throws outside a <CommandRouter>. */}
        <CommandRouter>
          <App />
        </CommandRouter>
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

  it('shows the Manuscript page an inline error with Retry when its chapters cannot be read, beside the notice Home raised for the same data', async () => {
    renderApp({}, { invalidPayload: 'manuscript' });
    await waitFor(() => screen.getByRole('heading', { name: 'Welcome back' }));
    // Home's audiobook estimate reads the same chapters, so it tells the narrator at once, and the notice stays (ADR 0075) ...
    const message = 'The app received data it could not read.';
    await waitFor(() => expect(screen.getAllByText(message)).toHaveLength(1));
    fireEvent.click(screen.getAllByRole('button', { name: /Manuscript/ })[0]);
    // ... so once the page has its own inline error the same words are on screen twice, which is why the visual driver waits for both.
    expect(await screen.findByText('This page could not be loaded')).toBeTruthy();
    expect(screen.getAllByText(message)).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
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

  it("opens Settings > Credits from the teleprompter's unresolved-token warning (credits PRD Phase 4, C6)", async () => {
    window.history.replaceState(null, '', '/teleprompter');
    renderApp();
    const picker = (await screen.findByLabelText('Chapter')) as HTMLSelectElement;
    await waitFor(() => expect(Array.from(picker.options, (option) => option.textContent)).toContain('Closing credits'));
    fireEvent.change(picker, { target: { value: 'credits:closing' } });

    fireEvent.click(await screen.findByRole('button', { name: 'Fill them in Settings' }));

    expect(await screen.findByRole('combobox', { name: 'Template' })).toBeTruthy();
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
    // Delete only exists in edit mode (ADR 0087): the new entry opens read-only, like any other.
    fireEvent.click(await screen.findByRole('button', { name: 'Edit this entry' }));
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
    await waitFor(() => expect(screen.getByRole('status').firstElementChild).not.toBeNull());
    const first = screen.getByRole('status').firstElementChild;
    const text = screen.getByRole('status').textContent;
    fireEvent.click(screen.getByRole('button', { name: /Suggest from manuscript/ }));

    // The same text replaces the message that is showing, as a new element that starts its time again, and does not stack a copy.
    await waitFor(() => expect(screen.getByRole('status').firstElementChild).not.toBe(first));
    expect(screen.getByRole('status').textContent).toBe(text);
    expect(screen.getByRole('status').children).toHaveLength(1);
  });

  it('tells the narrator a rebuild finished after they left the Story Bible, and keeps a failure until it is dismissed', async () => {
    let announce: (event: JobEnded) => void = () => {};
    renderApp({
      subscribeJobEnded: (listener) => {
        announce = listener;
        return () => {};
      },
    });
    await screen.findByRole('heading', { name: 'Welcome back' });
    fireEvent.click(screen.getAllByRole('button', { name: 'Proofing' })[0]);
    await screen.findByRole('heading', { name: 'Proofing' });

    act(() => announce({ id: 'guide-1', kind: 'story_bible', outcome: 'success', message: 'Story Bible rebuild complete.', durationMs: 4200 }));
    expect(within(screen.getByRole('status')).getByText('Story Bible rebuild complete.')).toBeTruthy();

    act(() =>
      announce({ id: 'run-1', kind: 'transcript_compare', outcome: 'error', message: 'The comparison could not read the REAPER audio.', durationMs: 900 }),
    );
    const alert = within(screen.getByRole('alert'));
    expect(alert.getByText('The comparison could not read the REAPER audio.')).toBeTruthy();
    fireEvent.click(alert.getByRole('button', { name: 'Dismiss message' }));
    expect(screen.queryByText('The comparison could not read the REAPER audio.')).toBeNull();

    // The import has its own modal dialog, so it is not announced a second time.
    act(() => announce({ id: 'import-1', kind: 'manuscript_import', outcome: 'success', message: 'Manuscript imported.', durationMs: 1200 }));
    expect(screen.queryByText('Manuscript imported.')).toBeNull();
  });

  it('raises an OS notification for a slow job finishing while the window is unfocused, and not otherwise (N1-N4)', async () => {
    let announce: ((event: JobEnded) => void) | undefined;
    const systemNotify = vi.fn(async () => {});
    const hasFocus = vi.spyOn(document, 'hasFocus');
    renderApp({
      subscribeJobEnded: (listener) => {
        announce = listener;
        return () => {};
      },
      systemNotify,
    });
    await screen.findByRole('heading', { name: 'Welcome back' });
    // Home can render before App's job:ended subscription effect has run; announcing earlier would go nowhere.
    await waitFor(() => expect(announce).toBeDefined());
    const send = (event: JobEnded) => announce?.(event);

    hasFocus.mockReturnValue(true);
    act(() => send({ id: 'guide-1', kind: 'story_bible', outcome: 'success', message: 'Story Bible rebuild complete.', durationMs: 40_000 }));
    expect(systemNotify).not.toHaveBeenCalled();

    hasFocus.mockReturnValue(false);
    act(() => send({ id: 'guide-2', kind: 'story_bible', outcome: 'success', message: 'Story Bible rebuild complete.', durationMs: 3_000 }));
    expect(systemNotify).not.toHaveBeenCalled();

    act(() => send({ id: 'guide-3', kind: 'story_bible', outcome: 'success', message: 'Story Bible rebuild complete.', durationMs: 40_000 }));
    await waitFor(() => expect(systemNotify).toHaveBeenCalledWith('story_bible', 'Task finished', 'Story Bible rebuild complete.'), { timeout: 10_000 });

    hasFocus.mockRestore();
  });

  it('closes the rebuild dialog by itself once the host reports the build done', async () => {
    const job = { id: 'guide-9', kind: 'story_bible' as const, message: 'Extracting names', percent: 40, logs: [], elapsed: 12 };
    let calls = 0;
    renderApp({ guideBuildState: async () => ({ ...job, phase: ++calls === 1 ? ('running' as const) : ('success' as const) }) });
    await screen.findByRole('heading', { name: 'Welcome back' });
    fireEvent.click(screen.getAllByRole('button', { name: 'Story Bible' })[0]);
    await screen.findByRole('dialog', { name: 'Rebuild Story Bible' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Rebuild Story Bible' })).toBeNull(), { timeout: 3000 });
  });

  it('keeps the rebuild dialog open with the reason when asking the host how far the build is fails', async () => {
    const running = { id: 'guide-9', kind: 'story_bible' as const, phase: 'running' as const, message: 'Extracting names', percent: 40, logs: [], elapsed: 12 };
    let calls = 0;
    renderApp({
      guideBuildState: async () => {
        if (++calls === 1) return running;
        throw new Error('the host stopped answering');
      },
    });
    await screen.findByRole('heading', { name: 'Welcome back' });
    fireEvent.click(screen.getAllByRole('button', { name: 'Story Bible' })[0]);
    const dialog = await screen.findByRole('dialog', { name: 'Rebuild Story Bible' });
    expect(await within(dialog).findAllByText(/the host stopped answering/)).not.toHaveLength(0);
  });

  it('says so when refreshing the project after an attach fails, instead of an unhandled rejection', async () => {
    let attach: (state: { attached: boolean }) => void = () => {};
    const source = createMockApi();
    let calls = 0;
    renderApp({
      bootstrap: async () => {
        if (++calls > 1) throw new Error('the host is busy');
        return source.bootstrap();
      },
      subscribeProjectAttach: (listener) => {
        attach = listener;
        return () => {};
      },
    });
    await screen.findByRole('heading', { name: 'Welcome back' });
    act(() => attach({ attached: true }));
    expect(await screen.findByText(/the host is busy/)).toBeTruthy();
    expect(within(screen.getByRole('alert')).getByText(/the host is busy/)).toBeTruthy();
  });

  it('choosing a manuscript file: busy while the host dialog is open, one dialog, and a failure is a toast', async () => {
    const selectManuscript = vi.fn(() => new Promise<never>(() => {}));
    renderApp({ selectManuscript });
    await screen.findByRole('heading', { name: 'Welcome back' });
    const choose = screen.getByRole('button', { name: 'Replace manuscript' });
    fireEvent.click(choose);
    fireEvent.click(choose);
    await waitFor(() => expect(choose.getAttribute('aria-busy')).toBe('true'));
    expect(selectManuscript).toHaveBeenCalledTimes(1);
    cleanup();

    renderApp({ selectManuscript: () => Promise.reject(new Error('the file dialog could not open')) });
    await screen.findByRole('heading', { name: 'Welcome back' });
    fireEvent.click(screen.getByRole('button', { name: 'Replace manuscript' }));
    expect(await within(await screen.findByRole('alert')).findByText(/the file dialog could not open/)).toBeTruthy();
  });

  it('Clear derived project data stays open and busy while it runs and cannot be confirmed twice', async () => {
    const clearProjectData = vi.fn(() => new Promise<void>(() => {}));
    renderApp({ clearProjectData });
    await screen.findByRole('heading', { name: 'Welcome back' });
    fireEvent.click(screen.getAllByRole('button', { name: 'Settings' })[0]);
    fireEvent.click(await screen.findByRole('tab', { name: 'This Project' }));
    fireEvent.click(await screen.findByRole('tab', { name: /Project data/i }));
    fireEvent.click(await screen.findByRole('button', { name: /Clear derived project data/ }));
    const confirm = await screen.findByRole('button', { name: 'Clear project data' });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    await waitFor(() => expect(confirm.getAttribute('aria-busy')).toBe('true'));
    expect(clearProjectData).toHaveBeenCalledTimes(1);
    expect((screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('says the rebuild was heard and starts only one when the button is pressed twice', async () => {
    const guideBuild = vi.fn(() => new Promise<GuideBuildResult>(() => {}));
    renderApp({ guideBuild });
    await screen.findByRole('heading', { name: 'Welcome back' });
    fireEvent.click(screen.getAllByRole('button', { name: 'Story Bible' })[0]);
    await screen.findByRole('heading', { name: 'Story Bible' });
    const build = await screen.findByRole('button', { name: 'Build / refresh Story Bible' });
    fireEvent.click(build);
    fireEvent.click(build);
    await waitFor(() => expect(build.getAttribute('aria-busy')).toBe('true'));
    expect(guideBuild).toHaveBeenCalledTimes(1);
  });

  it('shows a rebuild that is still running when the narrator comes back to the Story Bible, and lets them send it to the background', async () => {
    const running = { id: 'guide-9', kind: 'story_bible' as const, phase: 'running' as const, message: 'Extracting names', percent: 40, logs: [], elapsed: 12 };
    renderApp({ guideBuildState: async () => running });
    await screen.findByRole('heading', { name: 'Welcome back' });
    fireEvent.click(screen.getAllByRole('button', { name: 'Story Bible' })[0]);
    const dialog = await screen.findByRole('dialog', { name: 'Rebuild Story Bible' });
    expect(within(dialog).getByText(/keeps running/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Continue in background' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Rebuild Story Bible' })).toBeNull());
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

  it('opens Review from the navigation, and a finding there opens the manuscript at its line', async () => {
    renderApp();
    await screen.findByRole('heading', { name: 'Welcome back' });
    fireEvent.click(screen.getAllByRole('button', { name: 'Review' })[0]);
    await screen.findByRole('heading', { name: 'Review' });
    expect(window.location.pathname).toBe('/review');
    const row = await screen.findByText(/pink eyes/);
    fireEvent.click(row);
    fireEvent.click(await screen.findByRole('button', { name: 'Show in manuscript' }));
    await waitFor(() => expect(window.location.pathname).toBe('/manuscript'));
  });

  it('keeps Review reachable without a manuscript', async () => {
    const source = createMockApi();
    renderApp({ bootstrap: async () => ({ ...(await source.bootstrap()), manuscript: null }) });
    await screen.findByRole('heading', { name: 'Welcome back' });
    const reviewButtons = screen.getAllByRole('button', { name: 'Review' });
    expect(reviewButtons.every((button) => !(button as HTMLButtonElement).disabled)).toBe(true);
    fireEvent.click(reviewButtons[0]);
    await screen.findByRole('heading', { name: 'Review' });
  });

  it('opens Delivery from the navigation without a manuscript, and its Change profile opens Settings at Delivery', async () => {
    const source = createMockApi();
    renderApp({ bootstrap: async () => ({ ...(await source.bootstrap()), manuscript: null }) });
    await screen.findByRole('heading', { name: 'Welcome back' });
    const deliveryButtons = screen.getAllByRole('button', { name: 'Delivery' });
    expect(deliveryButtons.every((button) => !(button as HTMLButtonElement).disabled)).toBe(true);
    fireEvent.click(deliveryButtons[0]);
    await screen.findByRole('heading', { name: 'Delivery', level: 1 });
    expect(window.location.pathname).toBe('/delivery');
    fireEvent.click(await screen.findByRole('button', { name: 'Change profile' }));
    await waitFor(() => expect(window.location.pathname).toBe('/settings'));
    expect(await screen.findByRole('combobox', { name: 'Delivery profile for this project' })).toBeTruthy();
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

  it('chooses the Global default profile, duplicates ACX, edits the copy and deletes it in Settings > Delivery', async () => {
    const store = createMockApi();
    const deliverySelectProfile = vi.fn(store.deliverySelectProfile);
    const deliverySaveProfile = vi.fn(store.deliverySaveProfile);
    renderApp({ ...store, deliverySelectProfile, deliverySaveProfile });
    await waitFor(() => screen.getByRole('heading', { name: 'Welcome back' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Settings' })[0]);
    await screen.findByRole('heading', { name: 'Settings' });

    fireEvent.click(await screen.findByRole('tab', { name: 'Delivery' }));
    const choice = await screen.findByRole('combobox', { name: 'Default delivery profile' });
    expect((choice as HTMLSelectElement).value).toBe('acx@2026-09');
    expect(screen.getByText(/Built in · read-only · 13 rules · from help.acx.com, read 2026-09-20/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Duplicate' }));
    const editor = await screen.findByRole('dialog', { name: 'Edit profile' });
    fireEvent.change(within(editor).getByRole('textbox', { name: 'Name' }), { target: { value: 'My ACX, tighter peak' } });
    fireEvent.change(within(editor).getByRole('textbox', { name: 'Peak, highest (dBFS)' }), { target: { value: '-3.5' } });
    expect(within(editor).getByText('Changed')).toBeTruthy();
    fireEvent.click(within(editor).getByRole('switch', { name: 'Room tone, head on' }));
    fireEvent.click(within(editor).getByRole('button', { name: 'Save profile' }));
    await waitFor(() => expect(deliverySaveProfile).toHaveBeenCalledTimes(1));
    const edit = deliverySaveProfile.mock.calls[0][0];
    expect(edit.name).toBe('My ACX, tighter peak');
    expect(edit.rules.find((rule) => rule.id === 'acx.peak')?.max).toBe(-3.5);
    expect(edit.rules.find((rule) => rule.id === 'acx.room_tone_head')?.off).toBe(true);
    expect(await screen.findByText(/revision 2 · 1 number changed · 1 rule off/)).toBeTruthy();

    fireEvent.change(screen.getByRole('combobox', { name: 'Default delivery profile' }), { target: { value: edit.id } });
    await waitFor(() => expect(deliverySelectProfile).toHaveBeenCalledWith('global', edit.id, ''));
    expect(await screen.findByText(/Used by: Global default/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete profile' }));
    await waitFor(() => expect(screen.queryByText('My ACX, tighter peak')).toBeNull());
    expect((screen.getByRole('combobox', { name: 'Default delivery profile' }) as HTMLSelectElement).value).toBe('acx@2026-09');
  });

  it('offers the recording check settings at their defaults and saves a changed threshold', async () => {
    const store = createMockApi();
    const saveSettings = vi.fn(store.saveSettings);
    renderApp({ saveSettings, settingsForScope: store.settingsForScope });
    await waitFor(() => screen.getByRole('heading', { name: 'Welcome back' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Settings' })[0]);
    await screen.findByRole('heading', { name: 'Settings' });

    fireEvent.click(await screen.findByRole('tab', { name: 'Recording check' }));
    expect(await screen.findByText('Proposed values, not yet calibrated')).toBeTruthy();
    expect(screen.getByText(/at least 80% of its words read and no more than 3 words in a row/)).toBeTruthy();
    fireEvent.change(await screen.findByRole('textbox', { name: 'Longest run of missing words allowed' }), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(saveSettings).toHaveBeenCalledWith('RecordingCoverage', 'global', { max_missing_run: '5' }));
    expect(await screen.findByText(/no more than 5 words in a row/)).toBeTruthy();
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
      preview: {
        format: 'docx' as const,
        sourceName: 'Alice.docx',
        paragraphCount: 240,
        chapterTitles: ['Chapter 1'],
        sections: [{ id: 'section-0001', title: 'Chapter 1', contentKind: 'narration' as const, paragraphCount: 240 }],
        notices: ['Heading "Chapter 1Down" had no gap between its number and title; split into "Chapter 1" and "Down".'],
      },
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
      // This test is about the import dialog's own activity log and Home's refresh, not the B1-B3 chained build
      // (default on, D8): turn it off so the import dialog stays open with a manual Close, as asserted below.
      settingsForScope: async () => ({
        ManuscriptGuide: [
          { key: 'build_after_import', label: '', kind: 'bool', choices: [], value: 'false', isSet: true, effectiveValue: 'false', effectiveSource: 'project' },
        ],
      }),
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
        <CommandRouter>
          <App />
        </CommandRouter>
      </ApiProvider>,
    );

    await screen.findByRole('heading', { name: 'Welcome back' });
    expect(screen.getByText(/No imported manuscript/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Import manuscript' }));
    await screen.findByRole('alertdialog', { name: 'Import Alice.docx' });
    expect(preview).toHaveBeenCalledWith('mock-import', { markdownHeadingLevel: 1 });
    // The review says what was found and what the importer repaired; the log and progress bar belong to the commit dialog that follows.
    const review = within(screen.getByRole('alertdialog', { name: 'Import Alice.docx' }));
    expect(review.getByText('DOCX · 240 paragraphs · 1 narration chapter.')).toBeTruthy();
    expect(review.getByText(/1 repair made to the source/)).toBeTruthy();
    expect(review.getByText(/had no gap between its number and title/)).toBeTruthy();
    expect(review.queryByText('Preview activity')).toBeNull();
    expect(document.querySelector('.progressbar')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    const activity = await screen.findByRole('dialog', { name: 'Import manuscript' });
    expect(activity.querySelector('.progressbar')).toBeTruthy();
    expect(await screen.findByText('Writing the project-owned manuscript…')).toBeTruthy();
    expect((await screen.findAllByText('Manuscript import complete.')).length).toBeGreaterThanOrEqual(2);
    await waitFor(() => expect(bootstrap.mock.calls.length).toBeGreaterThanOrEqual(2));
    expect(await screen.findByText(/Manuscript found/)).toBeTruthy();
    expect(await screen.findByText('1,234 words · 1 chapters · ~155 words/min narrated')).toBeTruthy();

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

  // Phase 8 (PRD project-workspace-and-daw-link.prd.md): the Settings DAW panel's launch action and its two new
  // fields (reaper_path override, auto_start_launcher toggle, D10 default off).
  it('launches REAPER from the global Settings DAW panel', async () => {
    const launchDaw = vi.fn(createMockApi().launchDaw);
    renderApp({ launchDaw });
    await screen.findByRole('heading', { name: 'Welcome back' });
    fireEvent.click(screen.getAllByRole('button', { name: 'Settings' })[0]);
    await screen.findByRole('heading', { name: 'Settings' });
    fireEvent.click(screen.getByRole('tab', { name: 'DAW Integration' }));

    const launchButton = await screen.findByRole('button', { name: 'Launch REAPER' });
    expect((launchButton as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(launchButton);
    await waitFor(() => expect(launchDaw).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/REAPER started/)).toBeTruthy();

    expect(await screen.findByLabelText('REAPER executable (override)')).toBeTruthy();
    expect(screen.getByRole('switch', { name: 'Start the launcher script automatically' })).toBeTruthy();
  });

  it('disables Launch REAPER until a DAW project file is linked', async () => {
    renderApp({ bootstrap: async () => ({ ...(await createMockApi().bootstrap()), dawFileLinked: false }) });
    await screen.findByRole('heading', { name: 'Welcome back' });
    fireEvent.click(screen.getAllByRole('button', { name: 'Settings' })[0]);
    await screen.findByRole('heading', { name: 'Settings' });
    fireEvent.click(screen.getByRole('tab', { name: 'DAW Integration' }));

    const launchButton = await screen.findByRole('button', { name: 'Launch REAPER' });
    expect((launchButton as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Link a REAPER project \(\.rpp\) file before starting REAPER\./)).toBeTruthy();
  });

  // The DAW catalog and "Get it" flow (docs/architecture/daw-integration.md): a machine-wide
  // detection fact shown in the same global Settings DAW panel, above the project-scoped launcher fields.
  it('shows REAPER detected in the DAW catalog panel when it is already installed', async () => {
    renderApp();
    await screen.findByRole('heading', { name: 'Welcome back' });
    fireEvent.click(screen.getAllByRole('button', { name: 'Settings' })[0]);
    await screen.findByRole('heading', { name: 'Settings' });
    fireEvent.click(screen.getByRole('tab', { name: 'DAW Integration' }));

    expect(await screen.findByText('REAPER detected')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Get REAPER' })).toBeNull();
  });

  it('offers to open REAPER’s download page when it is not detected', async () => {
    const dawCatalogOpenDownloadPage = vi.fn(createMockApi().dawCatalogOpenDownloadPage);
    renderApp({ dawCatalogOpenDownloadPage }, { dawCatalogInstalled: false });
    await screen.findByRole('heading', { name: 'Welcome back' });
    fireEvent.click(screen.getAllByRole('button', { name: 'Settings' })[0]);
    await screen.findByRole('heading', { name: 'Settings' });
    fireEvent.click(screen.getByRole('tab', { name: 'DAW Integration' }));

    expect(await screen.findByText('REAPER not detected')).toBeTruthy();
    const getButton = screen.getByRole('button', { name: 'Get REAPER' });
    fireEvent.click(getButton);
    await waitFor(() => expect(dawCatalogOpenDownloadPage).toHaveBeenCalledWith('reaper'));
  });

  // docs/architecture/daw-integration.md: a manual re-check, since detection otherwise only runs
  // when the panel mounts, and a narrator who just installed REAPER should not have to leave and reopen Settings.
  it('re-checks the DAW catalog on Check again', async () => {
    const dawCatalogList = vi.fn(createMockApi().dawCatalogList);
    renderApp({ dawCatalogList });
    await screen.findByRole('heading', { name: 'Welcome back' });
    fireEvent.click(screen.getAllByRole('button', { name: 'Settings' })[0]);
    await screen.findByRole('heading', { name: 'Settings' });
    fireEvent.click(screen.getByRole('tab', { name: 'DAW Integration' }));

    await screen.findByText('REAPER detected');
    const calls = dawCatalogList.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
    await waitFor(() => expect(dawCatalogList.mock.calls.length).toBeGreaterThan(calls));
  });

  // Phase 3's "Could" item: a handoff into the DAW Link flow (project-workspace-and-daw-link.prd.md, W19) once a
  // DAW is detected, reusing the same shared linkDawFile() action the header pill and Tracks page already use.
  it('offers to link a REAPER project from the DAW catalog panel once REAPER is detected and nothing is linked yet', async () => {
    renderApp({}, { dawFileLinked: false });
    await screen.findByRole('heading', { name: 'Welcome back' });
    fireEvent.click(screen.getAllByRole('button', { name: 'Settings' })[0]);
    await screen.findByRole('heading', { name: 'Settings' });
    fireEvent.click(screen.getByRole('tab', { name: 'DAW Integration' }));

    await screen.findByText('REAPER detected');
    fireEvent.click(screen.getByRole('button', { name: 'Link a REAPER project file' }));
    await waitFor(() => expect(screen.getByText('REAPER project linked.')).toBeTruthy());
  });

  it('does not offer the DAW catalog handoff link once a REAPER project is already linked', async () => {
    renderApp();
    await screen.findByRole('heading', { name: 'Welcome back' });
    fireEvent.click(screen.getAllByRole('button', { name: 'Settings' })[0]);
    await screen.findByRole('heading', { name: 'Settings' });
    fireEvent.click(screen.getByRole('tab', { name: 'DAW Integration' }));

    await screen.findByText('REAPER detected');
    expect(screen.queryByRole('button', { name: 'Link a REAPER project file' })).toBeNull();
  });
});

// app-navigation-and-zoom-controls.prd.md Phase 1: page-level Back and Forward in the header, their
// shortcuts, and the two guards they share with the nav (unsaved Settings, leaving Proofing).
describe('App Back and Forward (Phase 1)', () => {
  it('are disabled on the first page and enable after moving, one page at a time', async () => {
    renderApp();
    await screen.findByRole('heading', { name: 'Welcome back' });
    expect((screen.getByRole('button', { name: 'Back' }) as HTMLButtonElement).getAttribute('aria-disabled')).toBe('true');
    expect((screen.getByRole('button', { name: 'Forward' }) as HTMLButtonElement).getAttribute('aria-disabled')).toBe('true');

    fireEvent.click(screen.getAllByRole('button', { name: 'Manuscript' })[0]);
    await screen.findByRole('heading', { name: 'Manuscript' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Back' }).getAttribute('aria-disabled')).toBeNull());

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    await screen.findByRole('heading', { name: 'Welcome back' });
    // The location updates at once; `useAppHistory`'s own `idx` (and so the disabled state) settles one
    // render later, once its effect has run - real for a person, imperceptible, but needs a wait here.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Back' }).getAttribute('aria-disabled')).toBe('true'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Forward' }).getAttribute('aria-disabled')).toBeNull());

    fireEvent.click(screen.getByRole('button', { name: 'Forward' }));
    await screen.findByRole('heading', { name: 'Manuscript' });
  });

  it('Alt+Left and Alt+Right do what the buttons do', async () => {
    renderApp();
    await screen.findByRole('heading', { name: 'Welcome back' });
    fireEvent.click(screen.getAllByRole('button', { name: 'Manuscript' })[0]);
    await screen.findByRole('heading', { name: 'Manuscript' });

    // `code` is what the registry's KeyboardSource matches on (PRD Q1: the physical key, not the layout-dependent
    // character); a real Alt+Left keydown carries both, so the fixture does too.
    fireEvent.keyDown(document, { key: 'ArrowLeft', code: 'ArrowLeft', altKey: true });
    await screen.findByRole('heading', { name: 'Welcome back' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Forward' }).getAttribute('aria-disabled')).toBeNull());

    fireEvent.keyDown(document, { key: 'ArrowRight', code: 'ArrowRight', altKey: true });
    await screen.findByRole('heading', { name: 'Manuscript' });
  });

  it("the mouse's back and forward buttons do what the header buttons do", async () => {
    renderApp();
    await screen.findByRole('heading', { name: 'Welcome back' });
    fireEvent.click(screen.getAllByRole('button', { name: 'Manuscript' })[0]);
    await screen.findByRole('heading', { name: 'Manuscript' });

    fireEvent.mouseUp(document, { button: 3 });
    await screen.findByRole('heading', { name: 'Welcome back' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Forward' }).getAttribute('aria-disabled')).toBeNull());

    fireEvent.mouseUp(document, { button: 4 });
    await screen.findByRole('heading', { name: 'Manuscript' });
  });

  it('Back from dirty Settings shows the same "Unsaved settings" confirm as the nav, and completes the move on Save', async () => {
    const saveSettings = vi.fn(createMockApi().saveSettings);
    renderApp({ saveSettings });
    await screen.findByRole('heading', { name: 'Welcome back' });
    fireEvent.click(screen.getAllByRole('button', { name: 'Settings' })[0]);
    await screen.findByRole('heading', { name: 'Settings' });

    const modelField = await screen.findByDisplayValue('normal');
    fireEvent.change(modelField, { target: { value: 'verbose' } });
    expect(screen.getByRole('button', { name: 'Back' }).getAttribute('aria-disabled')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(await screen.findByText('Save or discard changes before leaving Settings?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save & continue' }));

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Welcome back' })).toBeTruthy());
    expect(saveSettings).toHaveBeenCalledWith('General', 'global', expect.objectContaining({ log_verbosity: 'verbose' }));
  });

  it('Back from Proofing resets the transcript run, like the nav', async () => {
    const transcriptReset = vi.fn(createMockApi().transcriptReset);
    renderApp({ transcriptReset });
    await screen.findByRole('heading', { name: 'Welcome back' });
    fireEvent.click(screen.getAllByRole('button', { name: 'Proofing' })[0]);
    await screen.findByRole('heading', { name: 'Proofing' });

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    await screen.findByRole('heading', { name: 'Welcome back' });
    expect(transcriptReset).toHaveBeenCalled();
  });

  // input-commands-and-pedals.prd.md Phase 2: nav.back/nav.forward are now global commands, and nothing yet wraps an
  // open dialog's content in <CommandScope kind="dialog"> (Phase 7 does that for its own sheet), so App.tsx keeps the
  // direct `[role="dialog"]`/`[role="alertdialog"]` check the old listener made by hand instead of relying on scope
  // resolution for it. A plain probe element (rather than a real app dialog, which also marks the page behind it
  // inert and would make every other assertion here fail for an unrelated reason) isolates exactly that check.
  it('Alt+Left does nothing while something on screen has role="dialog", and works again once it is gone', async () => {
    renderApp();
    await screen.findByRole('heading', { name: 'Welcome back' });
    fireEvent.click(screen.getAllByRole('button', { name: 'Manuscript' })[0]);
    await screen.findByRole('heading', { name: 'Manuscript' });

    const probe = document.createElement('div');
    probe.setAttribute('role', 'dialog');
    document.body.appendChild(probe);
    try {
      fireEvent.keyDown(document, { key: 'ArrowLeft', code: 'ArrowLeft', altKey: true });
      expect(screen.getByRole('heading', { name: 'Manuscript' })).toBeTruthy();
    } finally {
      probe.remove();
    }

    fireEvent.keyDown(document, { key: 'ArrowLeft', code: 'ArrowLeft', altKey: true });
    await screen.findByRole('heading', { name: 'Welcome back' });
  });
});
