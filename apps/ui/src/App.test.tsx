// @vitest-environment jsdom
import { act, cleanup, configure, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { chapterName } from './chapterName';
import { ApiProvider } from './api/ApiContext';
import { createMockApi } from './api/mockApi';
import { PRODUCTION_SCENARIOS } from './api/productionMock';
import { CommandRouter } from './input/router';
import { createJournal } from './studio/journal/createJournal';
import { ThemeProvider } from './theme/ThemeContext';
import { parseWire } from './api/wire/parseWire';
import { bootstrapSchema } from './api/schemas/system';
import type { GuideBuildResult, WorkJob } from './types';
import { WIRE_CHAPTERS, WIRE_TRACKS_PROJECT } from './api/mockFixtures';
import type { JobEnded } from './api/contracts/system';
import type { DawTransport } from './api/contracts/daw';
import { DESKTOP_HOST_API_VERSION } from './hostApi';
import { passing, profile as acxProfile } from './components/masterqc/files/testFiles';
import type { MeasureJob } from './types';

// BrowserRouter reads/writes the real window.location via history.pushState,
// which jsdom keeps alive across tests in this file - reset it so each test
// starts at "/".
beforeEach(() => {
  window.history.replaceState(null, '', '/');
});
afterEach(cleanup);

// This file mounts the whole app. On a small CI runner with the suite running in parallel that takes longer than the 5 s
// default of test-setup.ts, so its waits get more room (still under `testTimeout`, 15 s). A wait ends as soon as it holds.
configure({ asyncUtilTimeout: 12_000 });

function renderApp(overrides: Parameters<typeof createMockApi>[0] = {}, initial: Parameters<typeof createMockApi>[1] = {}) {
  const api = createMockApi(overrides, initial);
  render(
    <ThemeProvider>
      <ApiProvider api={api}>
        {/* Matches main.tsx's tree: App calls useCommand for nav.back/nav.forward, which throws outside a <CommandRouter>. */}
        <CommandRouter>
          <App />
        </CommandRouter>
      </ApiProvider>
    </ThemeProvider>,
  );
  return api;
}

// The app's own toast region (`useToasts`) comes first in the document; the overlay host mounted after it draws a second pair for
// `overlay.toast`, empty until a caller uses it (docs/architecture/studio-shell-and-registries.md#overlay-service moves the call sites over one slice at a time).
// The toast region's live lists (Toast.tsx), told apart from a page's own status lines by announcing additions only.
// The toast regions are portalled to <body> (the app's and the overlay host's, in that order of mounting): the one showing messages, else the first.
const appToasts = (role: 'status' | 'alert') => {
  const regions = screen.getAllByRole(role).filter((node) => node.getAttribute('aria-relevant') === 'additions');
  return regions.find((node) => node.childElementCount > 0) ?? regions[0]!;
};

// A project with no imported manuscript but a manuscript file in its folder.
const bootstrapWithCandidate = (manuscriptCandidate: { path: string; name: string }) => async () => ({
  ...(await createMockApi().bootstrap()),
  manuscript: null,
  manuscriptCandidate,
});

// A run under way: the mock's comparison runs for 2.6 s once started, long enough to leave the page in the middle of it.
const startRunOnChapterOne = async () => {
  await screen.findByRole('heading', { name: /^Proof · / });
  fireEvent.click(await screen.findByRole('button', { name: /Start comparison/ }));
  await screen.findByRole('button', { name: 'Cancel' });
};

/** Links Chapter 1 to its first track from the engine panel's Chapter links table (no chapter starts linked in the mock) and returns its row. */
const linkChapterOne = async () => {
  fireEvent.click(screen.getByRole('button', { name: /^REAPER: / }));
  const panel = await screen.findByRole('dialog', { name: 'Audio engine' });
  const table = await within(panel).findByRole('table', { name: 'Chapter links' });
  const row = within(table)
    .getAllByRole('row')
    .find((candidate) => within(candidate).queryByRole('cell', { name: /^Chapter 1( — |$)/ }))!;
  const select = within(row).getByRole('combobox') as HTMLSelectElement;
  fireEvent.change(select, { target: { value: select.options[0].value } });
  fireEvent.click(within(row).getByRole('button', { name: 'Confirm' }));
  await within(row).findByRole('link', { name: 'Open in Editing' });
  return row;
};

describe('App (integration, driven through the mock NarrationApi)', () => {
  it('shows the startup screen, then the Production home once bootstrap resolves', async () => {
    renderApp();
    expect(screen.getByText(/Opening Narration Studio/)).toBeTruthy();
    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'Production' })).toBeTruthy());
    expect(screen.getAllByText('Alice’s Adventures in Wonderland').length).toBeGreaterThan(0);
    expect(await screen.findByRole('table', { name: 'Chapter pipeline' })).toBeTruthy();
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
    await waitFor(() => screen.getByRole('heading', { level: 1, name: 'Production' }));
    fireEvent.click(screen.getAllByRole('button', { name: /^Story Bible/ })[0]);
    expect(await screen.findByText('This page could not be loaded')).toBeTruthy();
    expect(screen.getByText('The app received data it could not read.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
    // The rest of the app still works: the navigation is there and leads on.
    fireEvent.click(screen.getAllByRole('button', { name: 'Production' })[0]);
    expect(await screen.findByRole('heading', { level: 1, name: 'Production' })).toBeTruthy();
  });

  it('shows the Script page an inline error with Retry when its chapters cannot be read, beside the notice Home raised for the same data', async () => {
    renderApp({}, { invalidPayload: 'manuscript' });
    await waitFor(() => screen.getByRole('heading', { level: 1, name: 'Production' }));
    // Home's audiobook estimate reads the same chapters, so it tells the narrator at once, and the notice stays ...
    const message = 'The app received data it could not read.';
    await waitFor(() => expect(screen.getAllByText(message)).toHaveLength(1));
    fireEvent.click(screen.getAllByRole('button', { name: 'Script' })[0]);
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
    await waitFor(() => screen.getByRole('heading', { level: 1, name: 'Production' }));
    expect(screen.queryByText(/is available/)).toBeNull();
  });

  it('tells the narrator once when live updates from the host have been failing', async () => {
    renderApp({}, { liveUpdatesDegraded: true });
    expect(await screen.findByText(/live updates from the desktop host could not be read/)).toBeTruthy();
  });

  it('reports an incompatible host as a version problem even when its Bootstrap would not match', async () => {
    const bootstrap = vi.fn().mockRejectedValue(new Error('must not be reached'));
    const future = DESKTOP_HOST_API_VERSION + 1;
    renderApp({ ready: async () => ({ apiVersion: future, diagnosticId: 'future-host' }), bootstrap });
    await waitFor(() => expect(screen.getByText(new RegExp(`Desktop host API version ${future} is incompatible`))).toBeTruthy());
    expect(bootstrap).not.toHaveBeenCalled();
    expect(screen.queryByText('The app received data it could not read.')).toBeNull();
  });

  it('rejects an incompatible desktop-host API version', async () => {
    renderApp({ ready: async () => ({ apiVersion: 1, diagnosticId: 'old-host' }) });
    await waitFor(() => expect(screen.getByText('Desktop host needs attention')).toBeTruthy());
    expect(screen.getByText(/Desktop host API version 1 is incompatible/)).toBeTruthy();
  });

  it("opens Settings > Credits from the Booth's unresolved-token warning", async () => {
    window.history.replaceState(null, '', '/booth?credits=closing');
    renderApp();
    fireEvent.click(await screen.findByRole('button', { name: /Fill them in Settings$/ }));

    expect(await screen.findByRole('combobox', { name: 'Template' })).toBeTruthy();
    window.history.replaceState(null, '', '/');
  });

  // SN-O10: `/booth` is the Studio Next Booth (its Record control and footer key hints), for a chapter, the credits or no target.
  it.each(['/booth', '/booth?chapter=chapter-2', '/booth?credits=opening', '/booth?credits=closing'])(
    'the-booth-route-mounts-the-new-page: %s',
    async (address) => {
      window.history.replaceState(null, '', address);
      renderApp();
      await screen.findByRole('heading', { name: 'Booth' });
      expect(await screen.findByRole('button', { name: /^Record$/ })).toBeTruthy();
      expect(screen.queryByRole('button', { name: /^Microphone:/ })).toBeNull();
      expect(window.location.pathname).toBe('/booth');
      window.history.replaceState(null, '', '/');
    },
  );

  it('navigates to Story Bible and lists entities from the backend', async () => {
    renderApp();
    await waitFor(() => screen.getByRole('heading', { level: 1, name: 'Production' }));
    fireEvent.click(screen.getAllByRole('button', { name: /^Story Bible/ })[0]);
    await waitFor(() => expect(screen.getByRole('heading', { name: /^Story Bible/ })).toBeTruthy());
    expect((await screen.findAllByText('Alice')).length).toBeGreaterThan(0);
  });

  it('does not create a Story Bible entity until a category is chosen for a new entry', async () => {
    const api = renderApp();
    const guideCreate = vi.spyOn(api, 'guideCreate');
    await waitFor(() => screen.getByRole('heading', { level: 1, name: 'Production' }));
    fireEvent.click(screen.getAllByRole('button', { name: /^Story Bible/ })[0]);
    await waitFor(() => expect(screen.getByRole('heading', { name: /^Story Bible/ })).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: 'Add entity' }));
    expect(await screen.findByDisplayValue(/New entity/)).toBeTruthy();
    expect(guideCreate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Choose category' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Character/ }));
    await waitFor(() => expect(guideCreate).toHaveBeenCalledTimes(1));
    expect(guideCreate).toHaveBeenCalledWith(expect.stringMatching(/New entity/), 'Character', []);
    // Delete only exists in edit mode: the new entry opens read-only, like any other.
    fireEvent.click(await screen.findByRole('button', { name: 'Edit this entry' }));
    expect(await screen.findByRole('button', { name: 'Delete entity' })).toBeTruthy();
  });

  it('opens Review Entry as a read-only overlay without discarding the in-progress edit', async () => {
    renderApp();
    await waitFor(() => screen.getByRole('heading', { level: 1, name: 'Production' }));
    fireEvent.click(screen.getAllByRole('button', { name: /^Story Bible/ })[0]);
    await waitFor(() => expect(screen.getByRole('heading', { name: /^Story Bible/ })).toBeTruthy());

    fireEvent.click((await screen.findAllByText('Alice'))[0]);
    // An entry opens read-only (SN-B91); Edit this entry turns the fields on.
    fireEvent.click(await screen.findByRole('button', { name: 'Edit this entry' }));
    const nameInput = await screen.findByDisplayValue('Alice');
    fireEvent.change(nameInput, { target: { value: 'Alice (editing)' } });

    const aliasInput = screen.getByPlaceholderText('Add an alias or find a matching entry…');
    fireEvent.change(aliasInput, { target: { value: 'White Rabbit' } });
    const matchList = await screen.findByRole('listbox', { name: 'Matching Story Bible entries' });
    // The text box is the combobox that drives the list (#156): it names the list and the active option.
    const combobox = screen.getByRole('combobox', { name: 'Add an alias or find a matching entry' });
    expect(combobox.getAttribute('aria-expanded')).toBe('true');
    expect(combobox.getAttribute('aria-controls')).toBe(matchList.id);
    expect(combobox.getAttribute('aria-activedescendant')).toBe(within(matchList).getAllByRole('option')[0].id);
    fireEvent.click(within(matchList).getByRole('option', { name: /White Rabbit/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Review entry' }));

    expect(await screen.findByRole('button', { name: 'Close review panel' })).toBeTruthy();
    expect((screen.getByDisplayValue('Alice (editing)') as HTMLInputElement).value).toBe('Alice (editing)');
  });

  it('shows a repeated message as a fresh toast, so a second click on the same action gives a new signal', async () => {
    window.history.replaceState(null, '', `/proof/${WIRE_CHAPTERS[0].id}`);
    renderApp({ transcriptSuggestHints: async () => ({ terms: [], found: 0 }) });
    await screen.findByRole('heading', { name: /^Proof · / });

    fireEvent.click(await screen.findByRole('button', { name: /Suggest from manuscript/ }));
    await waitFor(() => expect(appToasts('status').firstElementChild).not.toBeNull());
    const first = appToasts('status').firstElementChild;
    const text = appToasts('status').textContent;
    fireEvent.click(screen.getByRole('button', { name: /Suggest from manuscript/ }));

    // The same text replaces the message that is showing, as a new element that starts its time again, and does not stack a copy.
    await waitFor(() => expect(appToasts('status').firstElementChild).not.toBe(first));
    expect(appToasts('status').textContent).toBe(text);
    expect(appToasts('status').children).toHaveLength(1);
  });

  it('tells the narrator a rebuild finished after they left the Story Bible, and keeps a failure until it is dismissed', async () => {
    // The app and the Settings page both subscribe, so an event goes to every listener, as the host's does.
    const listeners = new Set<(event: JobEnded) => void>();
    const announce = (event: JobEnded) => listeners.forEach((each) => each(event));
    renderApp({
      subscribeJobEnded: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    });
    await screen.findByRole('heading', { level: 1, name: 'Production' });
    fireEvent.click(screen.getAllByRole('button', { name: 'Settings' })[0]);
    await screen.findByRole('heading', { name: 'Settings' });

    act(() => announce({ id: 'guide-1', kind: 'story_bible', outcome: 'success', message: 'Story Bible rebuild complete.', durationMs: 4200 }));
    expect(within(appToasts('status')).getByText('Story Bible rebuild complete.')).toBeTruthy();

    act(() =>
      announce({ id: 'run-1', kind: 'transcript_compare', outcome: 'error', message: 'The comparison could not read the REAPER audio.', durationMs: 900 }),
    );
    const alert = within(appToasts('alert'));
    expect(alert.getByText('The comparison could not read the REAPER audio.')).toBeTruthy();
    fireEvent.click(alert.getByRole('button', { name: 'Dismiss message' }));
    expect(screen.queryByText('The comparison could not read the REAPER audio.')).toBeNull();

    // The import has its own modal dialog, so it is not announced a second time.
    act(() => announce({ id: 'import-1', kind: 'manuscript_import', outcome: 'success', message: 'Manuscript imported.', durationMs: 1200 }));
    expect(screen.queryByText('Manuscript imported.')).toBeNull();
  });

  it('queues a job-end toast while the booth is recording, and shows it once recording stops (no sound or notification mid-take)', async () => {
    let announce: ((event: JobEnded) => void) | undefined;
    // Every subscriber hears the transport (the Booth page subscribes too, beside App's toast guard).
    const transportListeners = new Set<(transport: DawTransport) => void>();
    let emitTransport: ((transport: DawTransport) => void) | undefined;
    renderApp({
      subscribeJobEnded: (listener) => {
        announce = listener;
        return () => {};
      },
      subscribeDawTransport: (listener) => {
        transportListeners.add(listener);
        emitTransport = (transport) => transportListeners.forEach((each) => each(transport));
        listener({ playing: false, recording: false });
        return () => transportListeners.delete(listener);
      },
    });
    await screen.findByRole('heading', { level: 1, name: 'Production' });
    await waitFor(() => expect(announce).toBeDefined());
    await waitFor(() => expect(emitTransport).toBeDefined());

    // The Booth is showing (its route, not a dialog flag).
    fireEvent.click(screen.getAllByRole('button', { name: 'Booth' })[0]);
    await screen.findByRole('heading', { name: 'Booth' });
    act(() => emitTransport?.({ playing: true, recording: true }));

    act(() => announce?.({ id: 'guide-1', kind: 'story_bible', outcome: 'success', message: 'Story Bible rebuild complete.', durationMs: 4200 }));
    expect(screen.queryByText('Story Bible rebuild complete.')).toBeNull();

    // An error is never held back, even while recording (Risks table: silence is a comfort rule, not a safety one).
    act(() =>
      announce?.({ id: 'run-1', kind: 'transcript_compare', outcome: 'error', message: 'The comparison could not read the REAPER audio.', durationMs: 900 }),
    );
    expect(within(appToasts('alert')).getByText('The comparison could not read the REAPER audio.')).toBeTruthy();

    // Recording stops: the queued success toast appears.
    act(() => emitTransport?.({ playing: false, recording: false }));
    expect(screen.getByText('Story Bible rebuild complete.')).toBeTruthy();
  });

  it('raises an OS notification for a slow job finishing while the window is unfocused, and not otherwise', async () => {
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
    await screen.findByRole('heading', { level: 1, name: 'Production' });
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
    await screen.findByRole('heading', { level: 1, name: 'Production' });
    fireEvent.click(screen.getAllByRole('button', { name: /^Story Bible/ })[0]);
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
    await screen.findByRole('heading', { level: 1, name: 'Production' });
    fireEvent.click(screen.getAllByRole('button', { name: /^Story Bible/ })[0]);
    const dialog = await screen.findByRole('dialog', { name: 'Rebuild Story Bible' });
    expect(await within(dialog).findAllByText(/the host stopped answering/)).not.toHaveLength(0);
  });

  it('says so when refreshing the project after an attach fails, instead of an unhandled rejection', async () => {
    // App.tsx only wires this listener up from a useEffect, a passive effect React flushes on its own
    // schedule after the commit that renders the Production heading - not necessarily before it. Under load the
    // effect can still be pending once the heading is on screen, so wait for the real listener rather than
    // assuming the render implies the subscription (that race dropped the attach below and the message never
    // rendered, timing the test out instead of the fix ever being exercised).
    let attach: ((state: { attached: boolean }) => void) | undefined;
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
    await screen.findByRole('heading', { level: 1, name: 'Production' });
    await waitFor(() => expect(attach).toBeDefined());
    act(() => attach!({ attached: true }));
    expect(await screen.findByText(/the host is busy/)).toBeTruthy();
    expect(within(appToasts('alert')).getByText(/the host is busy/)).toBeTruthy();
  });

  it('choosing a manuscript file: busy while the host dialog is open, one dialog, and a failure is a toast', async () => {
    // The Studio Next header has no Replace manuscript (Settings keeps it); the empty state's import button is the same hook.
    const source = createMockApi();
    const noManuscript = async () => ({ ...(await source.bootstrap()), manuscript: null });
    const selectManuscript = vi.fn(() => new Promise<never>(() => {}));
    renderApp({ selectManuscript, bootstrap: noManuscript });
    await screen.findByRole('heading', { level: 1, name: 'Production' });
    const choose = screen.getByRole('button', { name: 'Import manuscript' });
    fireEvent.click(choose);
    fireEvent.click(choose);
    await waitFor(() => expect(choose.getAttribute('aria-busy')).toBe('true'));
    expect(selectManuscript).toHaveBeenCalledTimes(1);
    cleanup();

    renderApp({ selectManuscript: () => Promise.reject(new Error('the file dialog could not open')), bootstrap: noManuscript });
    await screen.findByRole('heading', { level: 1, name: 'Production' });
    fireEvent.click(screen.getByRole('button', { name: 'Import manuscript' }));
    // The region that shows it is only known once the message is there, so look again on each try.
    await waitFor(() => expect(within(appToasts('alert')).getByText(/the file dialog could not open/)).toBeTruthy());
  });

  it('Clear derived project data stays open and busy while it runs and cannot be confirmed twice', async () => {
    const clearProjectData = vi.fn(() => new Promise<void>(() => {}));
    renderApp({ clearProjectData });
    await screen.findByRole('heading', { level: 1, name: 'Production' });
    fireEvent.click(screen.getAllByRole('button', { name: 'Settings' })[0]);
    fireEvent.click(await within(await screen.findByRole('region', { name: 'Project data' })).findByRole('button', { name: /Clear derived project data/ }));
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
    await screen.findByRole('heading', { level: 1, name: 'Production' });
    fireEvent.click(screen.getAllByRole('button', { name: /^Story Bible/ })[0]);
    await screen.findByRole('heading', { name: /^Story Bible/ });
    const build = await screen.findByRole('button', { name: 'Build / refresh Story Bible' });
    fireEvent.click(build);
    fireEvent.click(build);
    await waitFor(() => expect(build.getAttribute('aria-busy')).toBe('true'));
    expect(guideBuild).toHaveBeenCalledTimes(1);
  });

  it('shows a rebuild that is still running when the narrator comes back to the Story Bible, and lets them send it to the background', async () => {
    const running = { id: 'guide-9', kind: 'story_bible' as const, phase: 'running' as const, message: 'Extracting names', percent: 40, logs: [], elapsed: 12 };
    renderApp({ guideBuildState: async () => running });
    await screen.findByRole('heading', { level: 1, name: 'Production' });
    fireEvent.click(screen.getAllByRole('button', { name: /^Story Bible/ })[0]);
    const dialog = await screen.findByRole('dialog', { name: 'Rebuild Story Bible' });
    expect(within(dialog).getByText(/keeps running/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Continue in background' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Rebuild Story Bible' })).toBeNull());
  });

  it('wires every primary page through the application router', async () => {
    renderApp();
    await screen.findByRole('heading', { level: 1, name: 'Production' });

    fireEvent.click(screen.getAllByRole('button', { name: 'Script' })[0]);
    await screen.findByRole('heading', { name: 'Script' });
    expect(window.location.pathname).toBe('/script');

    fireEvent.click(screen.getAllByRole('button', { name: /^Proof/ })[0]);
    await screen.findByRole('heading', { name: 'Proof' });

    fireEvent.click(screen.getAllByRole('button', { name: /^Story Bible/ })[0]);
    await screen.findByRole('heading', { name: /^Story Bible/ });

    fireEvent.click(screen.getAllByRole('button', { name: 'Settings' })[0]);
    await screen.findByRole('heading', { name: 'Settings' });

    fireEvent.click(screen.getAllByRole('button', { name: 'Production' })[0]);
    await screen.findByRole('heading', { level: 1, name: 'Production' });
  });

  it('leaves every page open without a manuscript, and the Production home is the import', async () => {
    const source = createMockApi();
    renderApp({ bootstrap: async () => ({ ...(await source.bootstrap()), manuscript: null }) });
    await screen.findByRole('heading', { level: 1, name: 'Production' });

    for (const name of ['Script', 'Story Bible', 'Booth']) {
      expect(screen.getAllByRole('button', { name }).every((button) => !(button as HTMLButtonElement).disabled)).toBe(true);
    }
    expect(screen.getByRole('region', { name: 'Import your manuscript' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Import manuscript' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Import legacy Word file' })).toBeNull();
  });

  it('schedule-route-and-rail-item: /schedule draws the Schedule page, and the rail item opens it', async () => {
    window.history.replaceState(null, '', '/schedule');
    renderApp();
    expect(await screen.findByRole('heading', { level: 1, name: 'Schedule' })).toBeTruthy();
    cleanup();
    window.history.replaceState(null, '', '/');
    renderApp();
    await screen.findByRole('heading', { level: 1, name: 'Production' });
    fireEvent.click(screen.getAllByRole('button', { name: 'Schedule' })[0]);
    expect(await screen.findByRole('heading', { level: 1, name: 'Schedule' })).toBeTruthy();
    expect(window.location.pathname).toBe('/schedule');
    window.history.replaceState(null, '', '/');
  });

  it('opens the Booth with a manuscript, and a direct URL without one asks for it there', async () => {
    window.history.replaceState(null, '', '/');
    renderApp();
    await screen.findByRole('heading', { level: 1, name: 'Production' });

    fireEvent.click(screen.getAllByRole('button', { name: 'Booth' })[0]);

    await screen.findByRole('heading', { name: 'Booth' });
    expect(window.location.pathname).toBe('/booth');
    cleanup();

    window.history.replaceState(null, '', '/booth');
    const source = createMockApi();
    renderApp({ bootstrap: async () => ({ ...(await source.bootstrap()), manuscript: null }) });
    await screen.findByText('This project has no manuscript yet. Import one to begin.');
    expect(window.location.pathname).toBe('/booth');
  });

  it('the Story Bible route asks for a manuscript on its own page instead of sending a project without one home', async () => {
    window.history.replaceState(null, '', '/story-bible');
    const source = createMockApi();
    renderApp({ bootstrap: async () => ({ ...(await source.bootstrap()), manuscript: null }) });
    await screen.findByRole('heading', { level: 1, name: 'Story Bible' });
    expect(window.location.pathname).toBe('/story-bible');
    expect(screen.getByText('This project has no manuscript yet. Import one to begin.')).toBeTruthy();
    // The ask sends the narrator to the Production home, where the import lives.
    fireEvent.click(screen.getByRole('button', { name: 'Import manuscript' }));
    await screen.findByRole('heading', { level: 1, name: 'Production' });
    expect(window.location.pathname).toBe('/');
  });

  // docs/architecture/principles.md: the retired Teleprompter route lands on the Booth with its
  // query and hash, and replaces the entry so Back never returns to the redirect.
  it('redirects /teleprompter to /booth, keeping the query and hash', async () => {
    window.history.replaceState(null, '', '/teleprompter?chapter=chapter-2#x');
    renderApp();
    await screen.findByRole('heading', { name: 'Booth' });
    expect(window.location.pathname).toBe('/booth');
    expect(window.location.search).toBe('?chapter=chapter-2');
    expect(window.location.hash).toBe('#x');
  });

  // docs/architecture/principles.md: the Production page moved to `/`, so its old address lands there
  // with its query and hash.
  it('redirects /production to the Production home at /, keeping the query and hash', async () => {
    window.history.replaceState(null, '', '/production?mockProduction=on-pace#plan');
    renderApp();
    await screen.findByRole('heading', { level: 1, name: 'Production' });
    expect(window.location.pathname).toBe('/');
    expect(window.location.search).toBe('?mockProduction=on-pace');
    expect(window.location.hash).toBe('#plan');
  });

  // The header's timer chip shows a running production timer on every page, read once when the app opens.
  it('shows the running production timer in the header on any page', async () => {
    window.history.replaceState(null, '', '/settings');
    renderApp({}, { production: PRODUCTION_SCENARIOS['on-pace'] });
    expect(await screen.findByRole('timer', { name: /^Timer running on Chapter 6, Recording: 0:4\d:\d\d$/ })).toBeTruthy();
  });

  it('opens Settings on the Booth category from #booth and from the old #teleprompter anchor', async () => {
    for (const anchor of ['#booth', '#teleprompter']) {
      window.history.replaceState(null, '', `/settings${anchor}`);
      renderApp();
      expect(await screen.findByRole('heading', { name: 'Booth' })).toBeTruthy();
      cleanup();
    }
  });

  // docs/architecture/principles.md: the engine panel replaces the Tracks page. It opens from the
  // header's engine chip on any page, with or without a manuscript, and lists the mock project's tracks.
  it('opens the engine panel from the engine chip, without a manuscript, with the project and its tracks', async () => {
    const source = createMockApi();
    renderApp({ bootstrap: async () => ({ ...(await source.bootstrap()), manuscript: null }) });
    await screen.findByRole('heading', { level: 1, name: 'Production' });
    expect(screen.queryAllByRole('button', { name: 'Tracks' })).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: /^REAPER: / }));
    const panel = await screen.findByRole('dialog', { name: 'Audio engine' });
    const tracks = await within(panel).findByRole('table', { name: 'Tracks' });
    expect(within(tracks).getByText('Chapter 1')).toBeTruthy();
    expect(within(tracks).getByText('Click Track')).toBeTruthy();
    expect(within(panel).getByRole('button', { name: 'Link a different REAPER project file' })).toBeTruthy();
    expect(window.location.pathname).toBe('/');
  });

  it('redirects /tracks to Proof, keeping its query and hash, and opens the engine panel over it', async () => {
    window.history.replaceState(null, '', '/tracks?from=bookmark#top');
    renderApp();
    await waitFor(() => expect(window.location.pathname).toBe('/proof'));
    expect(window.location.search).toBe('?from=bookmark');
    expect(window.location.hash).toBe('#top');
    expect(await screen.findByRole('dialog', { name: 'Audio engine' })).toBeTruthy();
  });

  it('opens Proof from the navigation, and a note there opens its chapter in Script', async () => {
    renderApp();
    await screen.findByRole('heading', { level: 1, name: 'Production' });
    fireEvent.click(screen.getAllByRole('button', { name: /^Proof/ })[0]);
    await screen.findByRole('heading', { name: 'Proof' });
    expect(window.location.pathname).toBe('/proof');
    const row = await screen.findByText(/pink eyes/);
    fireEvent.click(row);
    fireEvent.click(await screen.findByRole('button', { name: 'Open this chapter in Script' }));
    await waitFor(() => expect(window.location.pathname).toBe('/script'));
  });

  it('steps into one chapter on Proof from the chapter stepper', async () => {
    renderApp();
    await screen.findByRole('heading', { level: 1, name: 'Production' });
    fireEvent.click(screen.getAllByRole('button', { name: /^Proof/ })[0]);
    await screen.findByRole('heading', { name: 'Proof' });
    fireEvent.click(await screen.findByRole('button', { name: 'Next chapter' }));
    await waitFor(() => expect(window.location.search).toMatch(/^\?chapter=/));
    expect(window.location.pathname).toBe('/proof');
  });

  it('turns Proof off without a manuscript (a press opens its note), and its address still opens the page asking for one', async () => {
    const source = createMockApi();
    renderApp({ bootstrap: async () => ({ ...(await source.bootstrap()), manuscript: null }) });
    await screen.findByRole('heading', { level: 1, name: 'Production' });
    const proof = within(screen.getByRole('complementary', { name: 'Primary navigation' })).getByRole('button', { name: /^Proof/ });
    expect(proof.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(proof);
    expect((await screen.findByRole('dialog', { name: 'Proof is unavailable' })).textContent).toContain('Import a manuscript to unlock this page.');
    expect(window.location.pathname).toBe('/');
  });

  it('opens Proof by its address with no manuscript: the page asks for one, with no redirect', async () => {
    window.history.replaceState(null, '', '/proof');
    const source = createMockApi();
    renderApp({ bootstrap: async () => ({ ...(await source.bootstrap()), manuscript: null }) });
    expect(await screen.findByText('This project has no manuscript yet. Import one to begin.')).toBeTruthy();
    expect(window.location.pathname).toBe('/proof');
  });

  // docs/architecture/principles.md: the retired routes land on Proof, query and hash kept.
  it.each([
    ['/review?from=bookmark#top', '/proof', '?from=bookmark', '#top'],
    ['/proofing', '/proof', '', ''],
  ])('redirects %s to Proof, keeping its query and hash', async (from, pathname, search, hash) => {
    window.history.replaceState(null, '', from);
    renderApp();
    await waitFor(() => expect(window.location.pathname).toBe(pathname));
    expect(window.location.search).toBe(search);
    expect(window.location.hash).toBe(hash);
  });

  // SN-E9 (route-and-rail): a chapter's old Tracks address lands on Editing at that chapter, ?t= and ?finding= kept.
  it('route-and-rail: redirects /tracks/chapter/:chapterId to Editing at that chapter, keeping its query', async () => {
    window.history.replaceState(null, '', '/tracks/chapter/chapter-1?t=12.5&finding=f-1');
    renderApp();
    await waitFor(() => expect(window.location.pathname).toBe('/editing/chapter-1'));
    expect(window.location.search).toBe('?t=12.5&finding=f-1');
    expect(await screen.findByRole('region', { name: 'Script editor' })).toBeTruthy();
  });

  it('route-and-rail: /editing/:chapterId draws the Editing page on that chapter, and the Editing item opens /editing', async () => {
    window.history.replaceState(null, '', `/editing/${WIRE_CHAPTERS[1].id}`);
    renderApp();
    const page = await screen.findByRole('region', { name: 'Script editor' });
    await waitFor(() => expect(within(page).getAllByText(new RegExp(WIRE_CHAPTERS[1].title)).length).toBeGreaterThan(0));
    expect(screen.queryByRole('heading', { name: /^Proof · / })).toBeNull();
    fireEvent.click(screen.getAllByRole('button', { name: 'Production' })[0]);
    await screen.findByRole('heading', { level: 1, name: 'Production' });
    fireEvent.click(screen.getAllByRole('button', { name: 'Editing' })[0]);
    await screen.findByRole('region', { name: 'Script editor' });
    expect(window.location.pathname).toBe('/editing');
  });

  // The editing check's "Clean up in Editing" (?drawer=cleanup) opens the page's drawer on Clean up.
  it('every-workspace-deep-link-lands-on-editing: ?drawer=cleanup opens Editing with the Clean up tab', async () => {
    window.history.replaceState(null, '', `/editing/${WIRE_CHAPTERS[0].id}?drawer=cleanup`);
    renderApp();
    expect(await screen.findByRole('region', { name: 'Clean up findings' }, { timeout: 4000 })).toBeTruthy();
  });

  // Proof's takes at a spot: Manage takes in Editing opens the note's chapter with the note's word selected and the passage's takes open.
  it('every-workspace-deep-link-lands-on-editing: Manage takes in Editing on Proof opens Editing with ?finding= and ?passage=', async () => {
    window.history.replaceState(null, '', '/proof?chapter=chapter-1');
    // Chapter 1 linked to its track (the visual suite's ?mockChapterLink=confirmed), so a note on it has takes at its spot.
    const track = WIRE_TRACKS_PROJECT.tracks.find((candidate) => candidate.name === 'Chapter 1')!;
    renderApp(
      {},
      { chapterTrackMappings: [{ trackGuid: track.guid, chapterId: 'chapter-1', chapterTitle: WIRE_CHAPTERS[0].title, confirmedAt: '2026-09-01T12:00:00Z' }] },
    );
    const note = await screen.findByText(/pink eyes/, {}, { timeout: 4000 });
    fireEvent.click(note.closest('tr')!);
    const spot = await screen.findByRole('region', { name: 'Takes at this spot' }, { timeout: 4000 });
    const manage = within(spot).getByRole('button', { name: 'Manage takes in Editing' });
    fireEvent.click(manage);
    await screen.findByRole('region', { name: 'Script editor' });
    expect(window.location.pathname).toBe('/editing/chapter-1');
    const params = new URLSearchParams(window.location.search);
    expect(params.get('finding')).toBeTruthy();
    expect(params.get('passage')).toBeTruthy();
  });

  // As the mock's page: with no manuscript the route stays and the page asks for one; its button goes to the import on Production.
  it('route-and-rail: without a manuscript Editing asks for one instead of drawing a chapter', async () => {
    window.history.replaceState(null, '', '/editing/chapter-1');
    const source = createMockApi();
    renderApp({ bootstrap: async () => ({ ...(await source.bootstrap()), manuscript: null }) });
    fireEvent.click(await screen.findByRole('button', { name: 'Import manuscript' }));
    await screen.findByRole('heading', { level: 1, name: 'Production' });
    expect(window.location.pathname).toBe('/');
  });

  // SN-E9 (every-workspace-deep-link-lands-on-editing): the engine panel's chapter link opens Editing at the chapter; Proof's chapter view
  // (its compare run and stage panels) keeps its own link.
  it('every-workspace-deep-link-lands-on-editing: the Chapter links table opens a linked chapter in Editing', async () => {
    renderApp();
    await screen.findByRole('heading', { level: 1, name: 'Production' });
    const row = await linkChapterOne();
    expect(within(row).getByRole('link', { name: 'Open in Proof' }).getAttribute('href')).toBe(`/proof/${WIRE_CHAPTERS[0].id}`);
    fireEvent.click(within(row).getByRole('link', { name: 'Open in Editing' }));
    await screen.findByRole('region', { name: 'Script editor' });
    expect(window.location.pathname).toBe(`/editing/${WIRE_CHAPTERS[0].id}`);
  });

  // SN-M5: /settings, /master and /delivery mount the Studio Next pages; /delivery is a page again, not a redirect.
  it('the-three-routes-mount-the-new-pages: Settings, Master & QC and Delivery each mount the mock page', async () => {
    window.history.replaceState(null, '', '/settings');
    renderApp();
    expect(await screen.findByRole('heading', { level: 1, name: 'Settings' })).toBeTruthy();
    expect(screen.getAllByRole('heading', { level: 1, name: 'Settings' })).toHaveLength(1);
    expect(await screen.findByRole('combobox', { name: 'Delivery profile' })).toBeTruthy();
    expect(screen.getByRole('radiogroup', { name: 'Theme' })).toBeTruthy();
    // One page: the kept settings are panels of the same column, with no old page, tabs or second wrapper below.
    expect(screen.queryByRole('region', { name: 'More settings' })).toBeNull();
    expect(screen.queryAllByRole('tab')).toHaveLength(0);
    expect(screen.getByRole('region', { name: 'Silence cleanup' })).toBeTruthy();
    cleanup();

    window.history.replaceState(null, '', '/master');
    renderApp();
    expect(await screen.findByRole('heading', { level: 1, name: 'Master & QC' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Book consistency' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Master all to spec…' })).toBeTruthy();
    expect(screen.queryByRole('group', { name: /platform/i })).toBeNull();
    cleanup();

    window.history.replaceState(null, '', '/delivery?from=report');
    renderApp();
    expect(await screen.findByRole('heading', { level: 1, name: 'Delivery' })).toBeTruthy();
    expect(await screen.findByRole('heading', { name: 'Before you build' })).toBeTruthy();
    expect(`${window.location.pathname}${window.location.search}`).toBe('/delivery?from=report');
  });

  it('the-three-routes-mount-the-new-pages: the Master profile pill opens Delivery and Delivery asks for a manuscript without one', async () => {
    window.history.replaceState(null, '', '/master');
    renderApp();
    await screen.findByRole('heading', { level: 1, name: 'Master & QC' });
    fireEvent.click(await screen.findByTitle('Open Delivery'));
    await waitFor(() => expect(window.location.pathname).toBe('/delivery'));
    expect(await screen.findByRole('heading', { level: 1, name: 'Delivery' })).toBeTruthy();
    cleanup();

    const source = createMockApi();
    window.history.replaceState(null, '', '/delivery');
    renderApp({ bootstrap: async () => ({ ...(await source.bootstrap()), manuscript: null }) });
    expect(await screen.findByText('This project has no manuscript yet. Import one to begin.')).toBeTruthy();
  });

  // An older finding link names a file: /delivery#file=… still lands on Master & QC with the anchor kept (masterLink.ts).
  it('the-three-routes-mount-the-new-pages: a /delivery#file= link lands on Master & QC with its anchor', async () => {
    window.history.replaceState(null, '', '/delivery?from=report#file=C%3A%2Fa.wav&rule=acx.rms');
    renderApp();
    await screen.findByRole('heading', { level: 1, name: 'Master & QC' });
    expect(`${window.location.pathname}${window.location.search}${window.location.hash}`).toBe('/master?from=report#file=C%3A%2Fa.wav&rule=acx.rms');
  });

  it("a chapter link opens Master & QC on that chapter's file", async () => {
    const chapter = WIRE_CHAPTERS[2]!;
    const files = [passing(`${chapter.title}.wav`)];
    const job = { phase: 'success', files, profile: acxProfile, bookRules: [] } as unknown as MeasureJob;
    window.history.replaceState(null, '', '/delivery');
    renderApp({ measureState: async () => job });
    const rowName = `${chapterName(chapter)}: `;
    fireEvent.click(await screen.findByRole('button', { name: (name) => name.startsWith(rowName) && name.endsWith('Open in Master & QC') }));
    await waitFor(() => expect(window.location.pathname).toBe('/master'));
    expect(window.location.hash).toBe(`#file=${chapter.id}`);
    const bar = await screen.findByRole('button', { name: /^Chapter: / });
    await waitFor(() => expect(bar.getAttribute('aria-label')).toContain(chapter.title));
    const selected = (await screen.findAllByRole('row')).filter((row) => row.getAttribute('aria-selected') === 'true');
    expect(selected).toHaveLength(1);
    expect(selected[0]!.textContent).toContain(chapter.title);
  });

  it('opens Settings on Silence cleanup from #cleanup and on the kept Delivery profiles panel from #delivery', async () => {
    for (const [anchor, heading] of [
      ['#cleanup', 'Silence cleanup'],
      ['#delivery', 'Delivery profiles'],
      ['#credits', 'Credits'],
    ]) {
      window.history.replaceState(null, '', `/settings${anchor}`);
      renderApp();
      expect(await screen.findByRole('heading', { name: heading })).toBeTruthy();
      cleanup();
    }
  });

  it('resets a compare run when the narrator leaves the chapter view it lives in, and not when there is none', async () => {
    const transcriptReset = vi.fn(createMockApi().transcriptReset);
    window.history.replaceState(null, '', `/proof/${WIRE_CHAPTERS[0].id}`);
    renderApp({ transcriptReset });
    await startRunOnChapterOne();
    fireEvent.click(screen.getAllByRole('button', { name: 'Production' })[0]);
    await screen.findByRole('heading', { level: 1, name: 'Production' });
    expect(transcriptReset).toHaveBeenCalledOnce();
    cleanup();

    const idleReset = vi.fn(async () => {});
    window.history.replaceState(null, '', `/proof/${WIRE_CHAPTERS[0].id}`);
    renderApp({ transcriptReset: idleReset });
    await screen.findByRole('heading', { name: /^Proof · / });
    fireEvent.click(screen.getAllByRole('button', { name: 'Production' })[0]);
    await screen.findByRole('heading', { level: 1, name: 'Production' });
    expect(idleReset).not.toHaveBeenCalled();
  });

  // docs/architecture/principles.md: Script replaced the Manuscript page, and an old link still lands, hash and query included.
  it.each(['/manuscript', '/manuscript#p5', '/manuscript#credits-closing'])('redirects %s to the Script page, which handles its hash', async (from) => {
    window.history.replaceState(null, '', from);
    renderApp();
    await screen.findByRole('heading', { name: 'Script' });
    expect(window.location.pathname).toBe('/script');
    // The page consumes a deep link's hash and replaces it (Manuscript.tsx did the same), which shows the hash reached it.
    await waitFor(() => expect(window.location.hash).toBe(''));
  });

  it('keeps the query and an unknown hash of a /manuscript link through the redirect', async () => {
    window.history.replaceState(null, '', '/manuscript?from=finding#x-not-a-deep-link');
    renderApp();
    await screen.findByRole('heading', { name: 'Script' });
    expect(`${window.location.pathname}${window.location.search}${window.location.hash}`).toBe('/script?from=finding#x-not-a-deep-link');
  });

  it('keeps a /manuscript link on the Script page, which asks for the manuscript, when there is none', async () => {
    window.history.replaceState(null, '', '/manuscript#p5');
    const source = createMockApi();
    renderApp({ bootstrap: async () => ({ ...(await source.bootstrap()), manuscript: null }), manuscriptChapters: async () => [] });
    await screen.findByText('This project has no manuscript yet. Import one to begin.');
    expect(window.location.pathname).toBe('/script');
  });

  // Issue 1720: the mock gives every page its own "import a manuscript" state and moves nowhere by itself.
  it.each([
    ['/proof/chapter-1', 'Proof'],
    ['/proof', 'Proof'],
    ['/pickups', 'Pickups'],
    ['/master', 'Master & QC'],
    ['/script', 'Script'],
    ['/booth', 'Booth'],
    ['/story-bible', 'Story Bible'],
    ['/delivery', 'Delivery'],
    ['/schedule', 'Schedule'],
    ['/editing', 'Editing'],
  ])('shows the import-a-manuscript state on %s and stays there when there is no manuscript', async (path, title) => {
    window.history.replaceState(null, '', `${path}?mockNoManuscript=1`);
    const source = createMockApi();
    renderApp({ bootstrap: async () => ({ ...(await source.bootstrap()), manuscript: null }), manuscriptChapters: async () => [] });
    expect((await screen.findAllByRole('heading', { name: title })).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/no manuscript yet/i).length).toBeGreaterThan(0);
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(window.location.pathname).toBe(path);
    expect(window.location.search).toBe('?mockNoManuscript=1');
    expect(screen.queryByRole('heading', { level: 1, name: 'Production' })).toBeNull();
  });

  it('draws no Proof or Pickups count on the rail when there is no manuscript, whatever the host still holds', async () => {
    const source = createMockApi();
    renderApp({
      bootstrap: async () => ({ ...(await source.bootstrap()), manuscript: null }),
      findingsSummary: async () => ({ ...(await source.findingsSummary()), total: 3, open: 3, unreviewed: 3 }),
    });
    await screen.findByRole('heading', { level: 1, name: 'Production' });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(screen.getAllByRole('button', { name: /^Proof/ }).every((button) => !/\d/.test(button.textContent ?? ''))).toBe(true);
  });

  it('Story Bible has no stale detection notice, and entry actions render as icon-only buttons on one row', async () => {
    renderApp();
    await waitFor(() => screen.getByRole('heading', { level: 1, name: 'Production' }));
    fireEvent.click(screen.getAllByRole('button', { name: /^Story Bible/ })[0]);
    await waitFor(() => expect(screen.getByRole('heading', { name: /^Story Bible/ })).toBeTruthy());
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
    await waitFor(() => screen.getByRole('heading', { level: 1, name: 'Production' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Settings' })[0]);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Settings' })).toBeTruthy());

    const modelField = await within(screen.getByRole('region', { name: 'General' })).findByDisplayValue('normal');
    fireEvent.change(modelField, { target: { value: 'verbose' } });
    expect(screen.getByText('Unsaved changes')).toBeTruthy();

    fireEvent.click(screen.getAllByRole('button', { name: 'Production' })[0]);
    expect(await screen.findByText('Save or discard changes before leaving Settings?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save & continue' }));

    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'Production' })).toBeTruthy());
    expect(saveSettings).toHaveBeenCalledWith('General', 'global', expect.objectContaining({ log_verbosity: 'verbose' }));
  });

  it('saves only the settings the narrator changed, so a field with no value yet is never sent as an empty string', async () => {
    const saveSettings = vi.fn(createMockApi().saveSettings);
    renderApp({ saveSettings });
    await waitFor(() => screen.getByRole('heading', { level: 1, name: 'Production' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Settings' })[0]);
    await screen.findByRole('heading', { name: 'Settings' });

    // A project has no override for any Proof field until one is saved, so all of them are unset (empty) here. The
    // host rejects an empty choice or colour ("unsupported value for chunk_seconds"), so only the edited field may go.
    const proof = screen.getByRole('region', { name: 'Proof' });
    fireEvent.click(within(proof).getByRole('button', { name: 'This project' }));
    await waitFor(() => expect(within(proof).getByRole('button', { name: 'This project' }).getAttribute('aria-pressed')).toBe('true'));
    fireEvent.change(await within(proof).findByRole('combobox', { name: 'Default Whisper model' }), { target: { value: 'large-v3' } });
    fireEvent.click(within(proof).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(saveSettings).toHaveBeenCalledTimes(1));
    expect(saveSettings).toHaveBeenCalledWith('TranscriptCompare', 'project', { model_size: 'large-v3' });
  });

  it('chooses the Global default profile, duplicates ACX, edits the copy and deletes it in Settings > Delivery', async () => {
    const store = createMockApi();
    const deliverySelectProfile = vi.fn(store.deliverySelectProfile);
    const deliverySaveProfile = vi.fn(store.deliverySaveProfile);
    renderApp({ ...store, deliverySelectProfile, deliverySaveProfile });
    await waitFor(() => screen.getByRole('heading', { level: 1, name: 'Production' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Settings' })[0]);
    await screen.findByRole('heading', { name: 'Settings' });

    const choice = await screen.findByRole('combobox', { name: 'Default delivery profile' });
    expect((choice as HTMLSelectElement).value).toBe('acx@2026-09');
    expect(screen.getByText(/Built in · read-only · 13 rules · from help.acx.com, read 2026-09-20/)).toBeTruthy();

    fireEvent.click(within(screen.getByRole('region', { name: 'Delivery profiles' })).getByRole('button', { name: 'Duplicate' }));
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

    fireEvent.click(within(screen.getByRole('region', { name: 'Delivery profiles' })).getByRole('button', { name: 'Delete' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete profile' }));
    await waitFor(() => expect(screen.queryByText('My ACX, tighter peak')).toBeNull());
    expect((screen.getByRole('combobox', { name: 'Default delivery profile' }) as HTMLSelectElement).value).toBe('acx@2026-09');
  });

  it('offers the recording check settings at their defaults and saves a changed threshold', async () => {
    const store = createMockApi();
    const saveSettings = vi.fn(store.saveSettings);
    renderApp({ saveSettings, settingsForScope: store.settingsForScope });
    await waitFor(() => screen.getByRole('heading', { level: 1, name: 'Production' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Settings' })[0]);
    await screen.findByRole('heading', { name: 'Settings' });

    const check = screen.getByRole('region', { name: 'Recording check' });
    expect(await within(check).findByText('Proposed values, not yet calibrated')).toBeTruthy();
    expect(within(check).getByText(/at least 80% of its words read and no more than 3 words in a row/)).toBeTruthy();
    fireEvent.change(await within(check).findByRole('textbox', { name: 'Longest run of missing words allowed' }), { target: { value: '5' } });
    fireEvent.click(within(check).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(saveSettings).toHaveBeenCalledWith('RecordingCoverage', 'global', { max_missing_run: '5' }));
    expect(await screen.findByText(/no more than 5 words in a row/)).toBeTruthy();
  });

  it('does not call the host when an edit was put back, and leaves nothing marked unsaved', async () => {
    const saveSettings = vi.fn(createMockApi().saveSettings);
    renderApp({ saveSettings });
    await waitFor(() => screen.getByRole('heading', { level: 1, name: 'Production' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Settings' })[0]);
    await screen.findByRole('heading', { name: 'Settings' });

    const general = screen.getByRole('region', { name: 'General' });
    const verbosity = await within(general).findByDisplayValue('normal');
    fireEvent.change(verbosity, { target: { value: 'verbose' } });
    fireEvent.change(verbosity, { target: { value: 'normal' } });
    expect(within(general).getByText('Unsaved changes')).toBeTruthy();
    fireEvent.click(within(general).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(screen.queryByText('Unsaved changes')).toBeNull());
    expect(saveSettings).not.toHaveBeenCalled();
  });

  it('does not write an override when a field with no value of its own is put back to the value it inherits', async () => {
    const saveSettings = vi.fn(createMockApi().saveSettings);
    renderApp({ saveSettings });
    await waitFor(() => screen.getByRole('heading', { level: 1, name: 'Production' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Settings' })[0]);
    await screen.findByRole('heading', { name: 'Settings' });

    // A project shows the Global value ("small") for a field it has no override for. Changing it and changing it back must
    // not pin that value in the project, or a later change to the Global default would no longer reach it.
    const proof = screen.getByRole('region', { name: 'Proof' });
    fireEvent.click(within(proof).getByRole('button', { name: 'This project' }));
    await waitFor(() => expect(within(proof).getByRole('button', { name: 'This project' }).getAttribute('aria-pressed')).toBe('true'));
    const model = await within(proof).findByRole('combobox', { name: 'Default Whisper model' });
    fireEvent.change(model, { target: { value: 'large-v3' } });
    fireEvent.change(model, { target: { value: 'small' } });
    fireEvent.click(within(proof).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(screen.queryByText('Unsaved changes')).toBeNull());
    expect(saveSettings).not.toHaveBeenCalled();
  });

  it("switches a panel's scope in its own header, and an unsaved change asks before the switch", async () => {
    renderApp();
    await waitFor(() => screen.getByRole('heading', { level: 1, name: 'Production' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Settings' })[0]);
    await screen.findByRole('heading', { name: 'Settings' });
    expect(screen.queryAllByRole('tablist')).toHaveLength(0);
    // General is Global only: it offers no switch.
    expect(within(screen.getByRole('region', { name: 'General' })).queryByRole('group', { name: 'General scope' })).toBeNull();

    const check = screen.getByRole('region', { name: 'Recording check' });
    const scope = within(check).getByRole('group', { name: 'Recording check scope' });
    expect(within(scope).getByRole('button', { name: 'Global' }).getAttribute('aria-pressed')).toBe('true');
    // A clean switch happens at once.
    fireEvent.click(within(scope).getByRole('button', { name: 'This project' }));
    await waitFor(() => expect(within(scope).getByRole('button', { name: 'This project' }).getAttribute('aria-pressed')).toBe('true'));
    fireEvent.click(within(scope).getByRole('button', { name: 'Global' }));
    await waitFor(() => expect(within(scope).getByRole('button', { name: 'Global' }).getAttribute('aria-pressed')).toBe('true'));

    // With an unsaved change, a switch asks first and the scope does not move until it is confirmed.
    fireEvent.change(await within(check).findByRole('textbox', { name: 'Longest run of missing words allowed' }), { target: { value: '5' } });
    fireEvent.click(within(scope).getByRole('button', { name: 'This project' }));
    expect(await screen.findByText('Save or discard changes before continuing?')).toBeTruthy();
    expect(within(scope).getByRole('button', { name: 'Global', hidden: true }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Discard & continue' }));
    await waitFor(() => expect(within(scope).getByRole('button', { name: 'This project' }).getAttribute('aria-pressed')).toBe('true'));
  });

  it('keeps fast manuscript-import activity visible and refreshes the Production home without a browser reload', async () => {
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
      // This test is about the import dialog's own activity log and Home's refresh, not the chained build after an import
      // (on by default): turn it off so the import dialog stays open with a manual Close, as asserted below.
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
      <ThemeProvider>
        <ApiProvider api={api}>
          <CommandRouter>
            <App />
          </CommandRouter>
        </ApiProvider>
      </ThemeProvider>,
    );

    await screen.findByRole('heading', { level: 1, name: 'Production' });
    expect(screen.getByRole('region', { name: 'Import your manuscript' })).toBeTruthy();

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
    // The empty state has become the pipeline behind the modal import dialog, which stayed open through it (useManuscriptImport).
    expect(await screen.findByRole('table', { name: 'Chapter pipeline', hidden: true })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog', { name: 'Import manuscript' })).toBeNull();
    fireEvent.click(screen.getAllByRole('button', { name: /^Story Bible/ })[0]);
    await screen.findByRole('heading', { name: /^Story Bible/ });
    fireEvent.click(screen.getAllByRole('button', { name: 'Production' })[0]);
    await screen.findByRole('heading', { level: 1, name: 'Production' });
    expect(await screen.findByRole('table', { name: 'Chapter pipeline' })).toBeTruthy();
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
    expect(screen.queryByRole('heading', { level: 1, name: 'Production' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Script' })).toBeNull();
    expect(screen.queryByRole('navigation')).toBeNull();
  });

  it('transitions from the project picker to the routed app once a project is attached', async () => {
    renderApp({}, { projectFolder: '' });
    await waitFor(() => expect(screen.getByText('Voltage and the Undercroft')).toBeTruthy());

    fireEvent.click(screen.getByText('Voltage and the Undercroft'));

    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'Production' })).toBeTruthy());
    expect(screen.queryByText('Open a project')).toBeNull();
  });

  // The Settings DAW panel's launch action and its two fields (reaper_path override, auto_start_launcher toggle,
  // off by default).
  it('launches REAPER from the global Settings DAW panel', async () => {
    const launchDaw = vi.fn(createMockApi().launchDaw);
    renderApp({ launchDaw });
    await screen.findByRole('heading', { level: 1, name: 'Production' });
    fireEvent.click(screen.getAllByRole('button', { name: 'Settings' })[0]);
    await screen.findByRole('heading', { name: 'Settings' });

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
    await screen.findByRole('heading', { level: 1, name: 'Production' });
    fireEvent.click(screen.getAllByRole('button', { name: 'Settings' })[0]);
    await screen.findByRole('heading', { name: 'Settings' });

    const launchButton = await screen.findByRole('button', { name: 'Launch REAPER' });
    expect((launchButton as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Link a REAPER project \(\.rpp\) file before starting REAPER\./)).toBeTruthy();
  });

  // The DAW catalog and "Get it" flow (docs/architecture/daw-integration.md): a machine-wide
  // detection fact shown in the same global Settings DAW panel, above the project-scoped launcher fields.
  it('shows REAPER detected in the DAW catalog panel when it is already installed', async () => {
    renderApp();
    await screen.findByRole('heading', { level: 1, name: 'Production' });
    fireEvent.click(screen.getAllByRole('button', { name: 'Settings' })[0]);
    await screen.findByRole('heading', { name: 'Settings' });

    expect(await screen.findByText('REAPER detected')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Get REAPER' })).toBeNull();
  });

  it('offers to open REAPER’s download page when it is not detected', async () => {
    const dawCatalogOpenDownloadPage = vi.fn(createMockApi().dawCatalogOpenDownloadPage);
    renderApp({ dawCatalogOpenDownloadPage }, { dawCatalogInstalled: false });
    await screen.findByRole('heading', { level: 1, name: 'Production' });
    fireEvent.click(screen.getAllByRole('button', { name: 'Settings' })[0]);
    await screen.findByRole('heading', { name: 'Settings' });

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
    await screen.findByRole('heading', { level: 1, name: 'Production' });
    fireEvent.click(screen.getAllByRole('button', { name: 'Settings' })[0]);
    await screen.findByRole('heading', { name: 'Settings' });

    await screen.findByText('REAPER detected');
    const calls = dawCatalogList.mock.calls.length;
    fireEvent.click(within(screen.getByRole('region', { name: 'DAW Integration' })).getByRole('button', { name: 'Check again' }));
    await waitFor(() => expect(dawCatalogList.mock.calls.length).toBeGreaterThan(calls));
  });

  // A handoff into the DAW Link flow once a
  // DAW is detected, reusing the same shared linkDawFile() action the audio engine panel and Settings already use.
  it('offers to link a REAPER project from the DAW catalog panel once REAPER is detected and nothing is linked yet', async () => {
    renderApp({}, { dawFileLinked: false });
    await screen.findByRole('heading', { level: 1, name: 'Production' });
    fireEvent.click(screen.getAllByRole('button', { name: 'Settings' })[0]);
    await screen.findByRole('heading', { name: 'Settings' });

    await screen.findByText('REAPER detected');
    fireEvent.click(screen.getByRole('button', { name: 'Link a REAPER project file' }));
    await waitFor(() => expect(screen.getByText('REAPER project linked.')).toBeTruthy());
  });

  it('links a REAPER project kept in another folder and says where it is, with no error', async () => {
    renderApp({}, { dawFileLinked: false, dawLinkOutside: true });
    await screen.findByRole('heading', { level: 1, name: 'Production' });
    fireEvent.click(screen.getAllByRole('button', { name: 'Settings' })[0]);
    await screen.findByRole('heading', { name: 'Settings' });

    await screen.findByText('REAPER detected');
    fireEvent.click(screen.getByRole('button', { name: 'Link a REAPER project file' }));
    await waitFor(() => expect(screen.getByText(/^REAPER project linked\. Elsewhere\.rpp is in D:\/Audio\/Elsewhere/)).toBeTruthy());
    expect(screen.queryByText(/outside this project's folder/)).toBeNull();
  });

  it('does not offer the DAW catalog handoff link once a REAPER project is already linked', async () => {
    renderApp();
    await screen.findByRole('heading', { level: 1, name: 'Production' });
    fireEvent.click(screen.getAllByRole('button', { name: 'Settings' })[0]);
    await screen.findByRole('heading', { name: 'Settings' });

    await screen.findByText('REAPER detected');
    expect(screen.queryByRole('button', { name: 'Link a REAPER project file' })).toBeNull();
  });
});

// Page-level Back and Forward in the header, their
// shortcuts, and the two guards they share with the nav (unsaved Settings, leaving Proofing).
describe('App Back and Forward', () => {
  it('are disabled on the first page and enable after moving, one page at a time', async () => {
    renderApp();
    await screen.findByRole('heading', { level: 1, name: 'Production' });
    expect((screen.getByRole('button', { name: 'Back' }) as HTMLButtonElement).getAttribute('aria-disabled')).toBe('true');
    expect((screen.getByRole('button', { name: 'Forward' }) as HTMLButtonElement).getAttribute('aria-disabled')).toBe('true');

    fireEvent.click(screen.getAllByRole('button', { name: 'Script' })[0]);
    await screen.findByRole('heading', { name: 'Script' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Back' }).getAttribute('aria-disabled')).toBeNull());

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    await screen.findByRole('heading', { level: 1, name: 'Production' });
    // The location updates at once; `useAppHistory`'s own `idx` (and so the disabled state) settles one
    // render later, once its effect has run - real for a person, imperceptible, but needs a wait here.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Back' }).getAttribute('aria-disabled')).toBe('true'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Forward' }).getAttribute('aria-disabled')).toBeNull());

    fireEvent.click(screen.getByRole('button', { name: 'Forward' }));
    await screen.findByRole('heading', { name: 'Script' });
  });

  it('Alt+Left and Alt+Right do what the buttons do', async () => {
    renderApp();
    await screen.findByRole('heading', { level: 1, name: 'Production' });
    fireEvent.click(screen.getAllByRole('button', { name: 'Script' })[0]);
    await screen.findByRole('heading', { name: 'Script' });

    // `code` is what the registry's KeyboardSource matches on (the physical key, not the layout-dependent
    // character); a real Alt+Left keydown carries both, so the fixture does too.
    fireEvent.keyDown(document, { key: 'ArrowLeft', code: 'ArrowLeft', altKey: true });
    await screen.findByRole('heading', { level: 1, name: 'Production' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Forward' }).getAttribute('aria-disabled')).toBeNull());

    fireEvent.keyDown(document, { key: 'ArrowRight', code: 'ArrowRight', altKey: true });
    await screen.findByRole('heading', { name: 'Script' });
  });

  it("the mouse's back and forward buttons do what the header buttons do", async () => {
    renderApp();
    await screen.findByRole('heading', { level: 1, name: 'Production' });
    fireEvent.click(screen.getAllByRole('button', { name: 'Script' })[0]);
    await screen.findByRole('heading', { name: 'Script' });

    fireEvent.mouseUp(document, { button: 3 });
    await screen.findByRole('heading', { level: 1, name: 'Production' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Forward' }).getAttribute('aria-disabled')).toBeNull());

    fireEvent.mouseUp(document, { button: 4 });
    await screen.findByRole('heading', { name: 'Script' });
  });

  it('Back from dirty Settings shows the same "Unsaved settings" confirm as the nav, and completes the move on Save', async () => {
    const saveSettings = vi.fn(createMockApi().saveSettings);
    renderApp({ saveSettings });
    await screen.findByRole('heading', { level: 1, name: 'Production' });
    fireEvent.click(screen.getAllByRole('button', { name: 'Settings' })[0]);
    await screen.findByRole('heading', { name: 'Settings' });

    const modelField = await within(screen.getByRole('region', { name: 'General' })).findByDisplayValue('normal');
    fireEvent.change(modelField, { target: { value: 'verbose' } });
    expect(screen.getByRole('button', { name: 'Back' }).getAttribute('aria-disabled')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(await screen.findByText('Save or discard changes before leaving Settings?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save & continue' }));

    await waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'Production' })).toBeTruthy());
    expect(saveSettings).toHaveBeenCalledWith('General', 'global', expect.objectContaining({ log_verbosity: 'verbose' }));
  });

  it('a browser Back the app did not start, from dirty Settings, restores Settings and asks (#1779)', async () => {
    renderApp();
    await screen.findByRole('heading', { level: 1, name: 'Production' });
    fireEvent.click(screen.getAllByRole('button', { name: 'Settings' })[0]);
    await screen.findByRole('heading', { name: 'Settings' });
    const modelField = await within(screen.getByRole('region', { name: 'General' })).findByDisplayValue('normal');
    fireEvent.change(modelField, { target: { value: 'verbose' } });

    // A popstate the app's own guarded Back did not start (a mouse-button gesture, history.back()).
    act(() => window.history.back());

    expect(await screen.findByText('Save or discard changes before leaving Settings?')).toBeTruthy();
    await waitFor(() => expect(window.location.pathname).toBe('/settings'));
    // Settings never unmounted, so Cancel leaves the edit where it was.
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(within(screen.getByRole('region', { name: 'General' })).getByDisplayValue('verbose')).toBeTruthy();
  });

  it('Back from a Proof chapter view with a run resets the transcript run, like the nav', async () => {
    const transcriptReset = vi.fn(createMockApi().transcriptReset);
    renderApp({ transcriptReset });
    await screen.findByRole('heading', { level: 1, name: 'Production' });
    // The engine panel's chapter link is the way into Proof's chapter view, where the compare run lives.
    fireEvent.click(within(await linkChapterOne()).getByRole('link', { name: 'Open in Proof' }));
    await startRunOnChapterOne();

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    await screen.findByRole('heading', { level: 1, name: 'Production' });
    expect(transcriptReset).toHaveBeenCalled();
  });

  // nav.back/nav.forward are global commands, and only the shortcut sheet wraps its content in
  // <CommandScope kind="dialog"> (ShortcutSheet.tsx), so App.tsx keeps the
  // direct `[role="dialog"]`/`[role="alertdialog"]` check the old listener made by hand instead of relying on scope
  // resolution for it. A plain probe element (rather than a real app dialog, which also marks the page behind it
  // inert and would make every other assertion here fail for an unrelated reason) isolates exactly that check.
  it('Alt+Left does nothing while something on screen has role="dialog", and works again once it is gone', async () => {
    renderApp();
    await screen.findByRole('heading', { level: 1, name: 'Production' });
    fireEvent.click(screen.getAllByRole('button', { name: 'Script' })[0]);
    await screen.findByRole('heading', { name: 'Script' });

    const probe = document.createElement('div');
    probe.setAttribute('role', 'dialog');
    document.body.appendChild(probe);
    try {
      fireEvent.keyDown(document, { key: 'ArrowLeft', code: 'ArrowLeft', altKey: true });
      expect(screen.getByRole('heading', { name: 'Script' })).toBeTruthy();
    } finally {
      probe.remove();
    }

    fireEvent.keyDown(document, { key: 'ArrowLeft', code: 'ArrowLeft', altKey: true });
    await screen.findByRole('heading', { level: 1, name: 'Production' });
  });
});

// The "?" (Shift+Slash) shortcut sheet, mounted from App.tsx alongside the
// other app-level commands.
describe('App shortcut sheet', () => {
  it('"?" opens the shortcut sheet from any page', async () => {
    renderApp();
    await screen.findByRole('heading', { level: 1, name: 'Production' });
    fireEvent.keyDown(document, { key: '?', code: 'Slash', shiftKey: true });
    expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeTruthy();
  });

  it('closing it and pressing "?" again reopens it (the command stays registered)', async () => {
    renderApp();
    await screen.findByRole('heading', { level: 1, name: 'Production' });
    fireEvent.keyDown(document, { key: '?', code: 'Slash', shiftKey: true });
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog', { name: 'Keyboard shortcuts' })).toBeNull();

    fireEvent.keyDown(document, { key: '?', code: 'Slash', shiftKey: true });
    expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeTruthy();
  });

  it('"Show all shortcuts" closes the sheet and navigates to Settings', async () => {
    renderApp();
    await screen.findByRole('heading', { level: 1, name: 'Production' });
    fireEvent.keyDown(document, { key: '?', code: 'Slash', shiftKey: true });
    fireEvent.click(screen.getByRole('button', { name: 'Show all shortcuts' }));
    expect(screen.queryByRole('dialog', { name: 'Keyboard shortcuts' })).toBeNull();
    await screen.findByRole('heading', { name: 'Settings' });
  });

  it('while the sheet is open, Alt+Left no longer goes Back', async () => {
    renderApp();
    await screen.findByRole('heading', { level: 1, name: 'Production' });
    fireEvent.click(screen.getAllByRole('button', { name: 'Script' })[0]);
    await screen.findByRole('heading', { name: 'Script' });

    fireEvent.keyDown(document, { key: '?', code: 'Slash', shiftKey: true });
    fireEvent.keyDown(document, { key: 'ArrowLeft', code: 'ArrowLeft', altKey: true });
    // The page behind an open dialog is `aria-hidden` (`dialogs.spec.ts`'s isolation check), so the route is what shows
    // Script never left, only the sheet covers it, which is what "Alt+Left did nothing" means here.
    expect(window.location.pathname).toBe('/script');
    expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeTruthy();
  });
});

// SN-R8: the shell mounts the overlay host, the jump menu, the context menu host and the journal.
describe('App shell mounts', () => {
  // The overlay service is the app's one module-level store, so a layer a test leaves open would show in the next test's host.
  afterEach(async () => {
    const { overlay } = await import('./overlay/overlayService');
    for (const entry of overlay.getSnapshot().dialogs) {
      if (entry.kind === 'confirm') entry.answer(false);
      else entry.close();
    }
  });

  const openJumpFromHeader = async () => {
    await screen.findByRole('heading', { level: 1, name: 'Production' });
    const button = screen.getByRole('button', { name: /Jump to or run/ });
    // A real press focuses the button, which is where the dialog gives focus back.
    button.focus();
    fireEvent.click(button);
    return button;
  };

  // The chapters slot answers after the shell has mounted, and a late answer can redraw the open menu. So the filter is applied again on
  // every poll rather than once: the wait ends as soon as the chapters are listed.
  const chapterOptions = () =>
    waitFor(() => {
      const field = screen.getByRole('combobox', { name: 'Jump menu' });
      fireEvent.change(field, { target: { value: '' } });
      fireEvent.change(field, { target: { value: 'Go to Chapter' } });
      const options = screen.getAllByRole('option', { name: /^Go to Chapter/ });
      expect(options.length).toBeGreaterThan(0);
      return options;
    });

  it('overlay-host-is-mounted-once: overlay.confirm from outside React shows one confirm over the page', async () => {
    const { overlay } = await import('./overlay/overlayService');
    renderApp();
    await screen.findByRole('heading', { level: 1, name: 'Production' });
    let answer: boolean | undefined;
    act(() => {
      void overlay.confirm({ title: 'Discard the take?', body: 'It cannot be brought back.', confirmLabel: 'Discard' }).then((value) => (answer = value));
    });
    const dialog = await screen.findByRole('alertdialog', { name: /Discard the take/ });
    expect(screen.getAllByRole('alertdialog')).toHaveLength(1);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Discard' }));
    await waitFor(() => expect(answer).toBe(true));
  });

  it('jump-menu-opens-from-key-and-header-button: the button opens it, "Go to Proof" navigates, Escape returns focus', async () => {
    renderApp();
    const button = await openJumpFromHeader();
    const field = await screen.findByRole('combobox', { name: 'Jump menu' });
    fireEvent.change(field, { target: { value: 'Go to Proof' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    await screen.findByRole('heading', { name: 'Proof' });

    button.focus();
    fireEvent.click(button);
    await screen.findByRole('combobox', { name: 'Jump menu' });
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('combobox', { name: 'Jump menu' })).toBeNull());
    expect(document.activeElement).toBe(button);
  });

  it('jump-menu-chapters-come-from-the-slot: lists "Go to <chapter>" for every chapter of the manuscript', async () => {
    renderApp();
    await openJumpFromHeader();
    expect((await chapterOptions()).length).toBeGreaterThan(0);
  });

  it('jump-menu-chapters-come-from-the-slot: with no manuscript the list is empty and nothing is loaded', async () => {
    const manuscriptChapters = vi.fn().mockResolvedValue([]);
    renderApp({ manuscriptChapters, bootstrap: bootstrapWithCandidate({ path: 'a.docx', name: 'a.docx' }) });
    await screen.findByRole('button', { name: /Jump to or run/ });
    expect(manuscriptChapters).not.toHaveBeenCalled();
  });

  it('refreshes-after-an-import: a job:ended event makes the jump menu list the new chapters', async () => {
    const listeners = new Set<(event: never) => void>();
    const ended = (event: never) => listeners.forEach((l) => l(event));
    const chapters = await createMockApi().manuscriptChapters();
    let list = chapters.slice(0, 1);
    const extra = { ...chapters[0]!, id: 'chapter-new', index: 99, title: 'Zzyzx Afterword' };
    renderApp({ manuscriptChapters: async () => list, subscribeJobEnded: (cb) => (listeners.add(cb as never), () => void listeners.delete(cb as never)) });
    const button = await openJumpFromHeader();
    let field = await screen.findByRole('combobox', { name: 'Jump menu' });
    fireEvent.change(field, { target: { value: 'Zzyzx' } });
    expect(screen.queryByRole('option', { name: /Zzyzx/ })).toBeNull();
    fireEvent.keyDown(field, { key: 'Escape' });
    list = [...chapters, extra];
    await act(async () => ended({ id: 'j', kind: 'manuscript_import', outcome: 'success', message: '', durationMs: 1 } as never));
    await waitFor(() => expect(screen.queryByRole('combobox', { name: 'Jump menu' })).toBeNull());
    fireEvent.click(button);
    field = await screen.findByRole('combobox', { name: 'Jump menu' });
    fireEvent.change(field, { target: { value: 'Zzyzx' } });
    expect(await screen.findByRole('option', { name: /Zzyzx/ })).toBeTruthy();
  });

  it('failed-load-keeps-the-last-list: a failing read leaves the chapters in the menu', async () => {
    let fail = false;
    const listeners = new Set<(event: never) => void>();
    const ended = (event: never) => listeners.forEach((l) => l(event));
    const base = createMockApi();
    const chapters = await base.manuscriptChapters();
    renderApp({
      manuscriptChapters: async () => {
        if (fail) throw new Error('boom');
        return chapters;
      },
      subscribeJobEnded: (cb) => (listeners.add(cb as never), () => void listeners.delete(cb as never)),
    });
    // The menu asks for its commands once per open, and the chapters slot answers after the shell has mounted (later still on a
    // loaded runner), so a menu opened first never lists them: it is reopened until it does.
    const button = await openJumpFromHeader();
    let before = 0;
    await waitFor(
      async () => {
        const field = await screen.findByRole('combobox', { name: 'Jump menu' });
        fireEvent.change(field, { target: { value: 'Go to Chapter' } });
        before = screen.queryAllByRole('option', { name: /^Go to Chapter/ }).length;
        if (before === 0) {
          fireEvent.keyDown(field, { key: 'Escape' });
          await waitFor(() => expect(screen.queryByRole('combobox', { name: 'Jump menu' })).toBeNull());
          fireEvent.click(button);
        }
        expect(before).toBeGreaterThan(0);
      },
      { timeout: 5000 },
    );
    fail = true;
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await act(async () => ended({ id: 'j', kind: 'manuscript_import', outcome: 'success', message: '', durationMs: 1 } as never));
    expect(screen.getAllByRole('option', { name: /^Go to Chapter/ })).toHaveLength(before);
  });

  it('jump-menu-opens-from-key-and-header-button: Ctrl+K opens it too', async () => {
    renderApp();
    await screen.findByRole('heading', { level: 1, name: 'Production' });
    fireEvent.keyDown(document.body, { key: 'k', code: 'KeyK', ctrlKey: true });
    await screen.findByRole('combobox', { name: 'Jump menu' });
  });

  it('context-menu-host-covers-main-only: empty space in main shows the fallback menu, the rail keeps the browser menu', async () => {
    renderApp();
    await screen.findByRole('heading', { level: 1, name: 'Production' });
    const main = screen.getByRole('main');
    const page = main.querySelector('.scroll-chrome-hidden') as HTMLElement;
    fireEvent.contextMenu(page);
    const menu = await screen.findByRole('menu');
    for (const name of ['Go to…', 'Zoom in', 'Zoom out', 'Reset zoom', 'Jump menu…']) {
      expect(within(menu).getByRole('menuitem', { name: new RegExp(`^${name}`) })).toBeTruthy();
    }
    cleanup();
    renderApp();
    await screen.findByRole('heading', { level: 1, name: 'Production' });
    const rail = screen.getByRole('complementary', { name: 'Primary navigation' });
    // The Wails runtime decides the browser menu itself; the host's part is to open none outside <main>'s page area.
    fireEvent.contextMenu(within(rail).getByRole('button', { name: 'Script' }));
    // The shell's header, the first in the document; the Production title block is a <header> of its own further down.
    fireEvent.contextMenu(screen.getAllByRole('banner')[0]);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('history-button-and-key-open-the-panel: the button and Mod+Shift+H open it over a live journal', async () => {
    renderApp();
    await screen.findByRole('heading', { level: 1, name: 'Production' });
    fireEvent.click(screen.getByRole('button', { name: 'History' }));
    const panel = await screen.findByRole('dialog', { name: 'Undo history' });
    expect(within(panel).getByText('Nothing to undo yet.')).toBeTruthy();
    await waitFor(() => expect(panel.contains(document.activeElement)).toBe(true));
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    // The slide-over stays in the document while it animates out, and an open dialog holds the shortcut back.
    await waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull(), { timeout: 4000 });
    fireEvent.keyDown(document.body, { key: 'h', code: 'KeyH', ctrlKey: true, shiftKey: true });
    await screen.findByRole('dialog', { name: 'Undo history' });
  });

  it('header-undo-follows-the-journal: Undo is off with the reason while the journal is empty', async () => {
    renderApp();
    await screen.findByRole('heading', { level: 1, name: 'Production' });
    const undo = screen.getByRole('button', { name: 'Undo' });
    expect(undo.getAttribute('aria-disabled')).toBe('true');
  });

  const renderWithJournal = (journal: ReturnType<typeof createJournal>) =>
    render(
      <ThemeProvider>
        <ApiProvider api={createMockApi()}>
          <CommandRouter>
            <App journal={journal} />
          </CommandRouter>
        </ApiProvider>
      </ThemeProvider>,
    );
  const newJournal = () => createJournal({ dawName: () => 'REAPER', dawLastAction: async () => 'unknown' });

  it('header-undo-follows-the-journal: Undo undoes the newest entry and says what it undid', async () => {
    const journal = newJournal();
    const undo = vi.fn(async () => ({ ok: true as const, value: 1 }));
    await journal.act({ label: 'Added a bookmark', touches: ['bookmarks'], run: async () => ({ ok: true, value: 1 }), undo });
    renderWithJournal(journal);
    await screen.findByRole('heading', { level: 1, name: 'Production' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Undo' }).getAttribute('aria-disabled')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(undo).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Undid Added a bookmark')).toBeTruthy();
  });

  it('header-undo-follows-the-journal: a refusal shows the journal sentence as a toast', async () => {
    const journal = newJournal();
    await journal.act({
      label: 'Renamed a chapter',
      touches: ['chapters'],
      run: async () => ({ ok: true, value: 1 }),
      notUndoableReason: 'Renaming cannot be undone here.',
    });
    renderWithJournal(journal);
    await screen.findByRole('heading', { level: 1, name: 'Production' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Undo' }).getAttribute('aria-disabled')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(await screen.findByText('Renaming cannot be undone here.')).toBeTruthy();
  });

  it('ctrl-z-undoes-the-last-change: Ctrl+Z with focus on the page body undoes the newest entry', async () => {
    const journal = newJournal();
    const undo = vi.fn(async () => ({ ok: true as const, value: 1 }));
    await journal.act({ label: 'Added a bookmark', touches: ['bookmarks'], run: async () => ({ ok: true, value: 1 }), undo });
    renderWithJournal(journal);
    await screen.findByRole('heading', { level: 1, name: 'Production' });
    fireEvent.keyDown(document.body, { code: 'KeyZ', key: 'z', ctrlKey: true });
    await waitFor(() => expect(undo).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Undid Added a bookmark')).toBeTruthy();
  });

  it('ctrl-z-undoes-the-last-change: in a text field Ctrl+Z is the field’s own undo and the journal is left alone', async () => {
    const journal = newJournal();
    const undo = vi.fn(async () => ({ ok: true as const, value: 1 }));
    await journal.act({ label: 'Added a bookmark', touches: ['bookmarks'], run: async () => ({ ok: true, value: 1 }), undo });
    renderWithJournal(journal);
    await screen.findByRole('heading', { level: 1, name: 'Production' });
    const field = document.createElement('input');
    document.body.appendChild(field);
    field.focus();
    const notPrevented = fireEvent.keyDown(field, { code: 'KeyZ', key: 'z', ctrlKey: true });
    expect(notPrevented).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(undo).not.toHaveBeenCalled();
    field.remove();
  });

  it('leave-guard-is-asked-before-navigating: a guard that asks shows the confirm; Cancel stays, Yes goes', async () => {
    const journal = createJournal({ dawName: () => 'REAPER', dawLastAction: async () => 'unknown' });
    render(
      <ThemeProvider>
        <ApiProvider api={createMockApi()}>
          <CommandRouter>
            <App journal={journal} />
          </CommandRouter>
        </ApiProvider>
      </ThemeProvider>,
    );
    await screen.findByRole('heading', { level: 1, name: 'Production' });
    journal.setLeaveGuard(() => ({ ask: { title: 'Stop recording?', body: 'A take is recording.', confirmLabel: 'Leave' } }));
    fireEvent.click(screen.getAllByRole('button', { name: /^Proof/ })[0]);
    const dialog = await screen.findByRole('alertdialog', { name: /Stop recording/ });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(screen.queryByRole('heading', { name: 'Proof' })).toBeNull();
    fireEvent.click(screen.getAllByRole('button', { name: /^Proof/ })[0]);
    fireEvent.click(within(await screen.findByRole('alertdialog', { name: /Stop recording/ })).getByRole('button', { name: 'Leave' }));
    await screen.findByRole('heading', { name: 'Proof' });
  });

  // SN-O10, no-silent-stops: Back, Forward and Alt+Arrow ask the page's leave guard as the nav does (the Booth registers one while a
  // take records; its own exits, the address and the unmount stop are covered in components/booth/page). Cancel stays, Yes goes.
  it('no-silent-stops: Back, Forward and Alt+Arrow ask the leave guard first', async () => {
    const journal = createJournal({ dawName: () => 'REAPER', dawLastAction: async () => 'unknown' });
    renderWithJournal(journal);
    await screen.findByRole('heading', { level: 1, name: 'Production' });
    fireEvent.click(screen.getAllByRole('button', { name: 'Script' })[0]);
    await screen.findByRole('heading', { name: 'Script' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Back' }).getAttribute('aria-disabled')).toBeNull());
    journal.setLeaveGuard(() => ({
      ask: { title: 'Stop recording?', body: 'A take is recording.', confirmLabel: 'Stop and leave', cancelLabel: 'Keep recording' },
    }));

    // The guard's own name for staying reaches the question.
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    fireEvent.click(within(await screen.findByRole('alertdialog', { name: /Stop recording/ })).getByRole('button', { name: 'Keep recording' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(screen.getByRole('heading', { name: 'Script' })).toBeTruthy();

    fireEvent.keyDown(document, { key: 'ArrowLeft', code: 'ArrowLeft', altKey: true });
    fireEvent.click(within(await screen.findByRole('alertdialog', { name: /Stop recording/ })).getByRole('button', { name: 'Stop and leave' }));
    await screen.findByRole('heading', { level: 1, name: 'Production' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Forward' }).getAttribute('aria-disabled')).toBeNull());

    fireEvent.click(screen.getByRole('button', { name: 'Forward' }));
    expect(await screen.findByRole('alertdialog', { name: /Stop recording/ })).toBeTruthy();
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Keep recording' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(screen.getByRole('heading', { level: 1, name: 'Production' })).toBeTruthy();
    journal.setLeaveGuard(null);
  });

  it('leave-guard-is-asked-before-navigating: with no guard navigation is unchanged', async () => {
    renderApp();
    await screen.findByRole('heading', { level: 1, name: 'Production' });
    fireEvent.click(screen.getAllByRole('button', { name: /^Proof/ })[0]);
    await screen.findByRole('heading', { name: 'Proof' });
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
});
