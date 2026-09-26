// @vitest-environment jsdom
import type { ComponentProps } from 'react';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TeleprompterPage } from './TeleprompterPage';
import { ApiProvider } from '../../api/ApiContext';
import { createMockApi } from '../../api/mockApi';
import { CommandRouter } from '../../input/router';
import { WIRE_CHAPTERS, WIRE_TELEPROMPTER_DEVICES, WIRE_TRACKS_PROJECT } from '../../api/mockFixtures';
import type { ChapterSuggestion, NarrationApi, TeleprompterEvent, TeleprompterPosition, TeleprompterScript, TeleprompterState } from '../../types';

const DEVICE_NAME = WIRE_TELEPROMPTER_DEVICES[0].name;
const OTHER_DEVICE_NAME = WIRE_TELEPROMPTER_DEVICES[1].name;

beforeEach(() => {
  window.localStorage.clear();
});
afterEach(() => {
  cleanup();
});

async function chapterScript(): Promise<TeleprompterScript> {
  const script = (await createMockApi({}, { teleprompter: 'listening' }).teleprompterState()).script;
  if (!script) throw new Error('the mock has no script');
  return script;
}

const position = (read: number, extra: Partial<TeleprompterPosition> = {}): TeleprompterPosition => ({
  type: 'position',
  read,
  committed: read,
  status: 'listening',
  jump: null,
  skipped: null,
  ...extra,
});

function renderPage(
  overrides: Partial<NarrationApi> = {},
  initial: Parameters<typeof createMockApi>[1] = {},
  existingApi?: NarrationApi,
  props: ComponentProps<typeof TeleprompterPage> = {},
) {
  const eventListeners = new Set<(event: TeleprompterEvent) => void>();
  const stateListeners = new Set<(state: TeleprompterState) => void>();
  const api =
    existingApi ??
    createMockApi(
      {
        subscribeTeleprompterEvent: (listener) => {
          eventListeners.add(listener);
          return () => eventListeners.delete(listener);
        },
        subscribeTeleprompterState: (listener) => {
          stateListeners.add(listener);
          return () => stateListeners.delete(listener);
        },
        ...overrides,
      },
      initial,
    );
  render(
    <MemoryRouter>
      <ApiProvider api={api}>
        <CommandRouter>
          <TeleprompterPage {...props} />
        </CommandRouter>
      </ApiProvider>
    </MemoryRouter>,
  );
  return {
    api,
    emit: (event: TeleprompterEvent) => act(() => eventListeners.forEach((listener) => listener(event))),
    setState: (state: Partial<TeleprompterState>) =>
      act(() =>
        stateListeners.forEach((listener) => listener({ phase: 'idle', message: '', engine: null, chapter: null, script: null, position: null, ...state })),
      ),
  };
}

async function openMicPopover(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: /^Microphone:/ }));
}

async function openSettingsPopover(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Settings' }));
}

async function startReading(user: ReturnType<typeof userEvent.setup>) {
  await openMicPopover(user);
  // { selector: 'select' } disambiguates from the popover popup itself, which shares the same accessible name "Microphone".
  await user.selectOptions(await screen.findByLabelText('Microphone', { selector: 'select' }), DEVICE_NAME);
  await user.click(screen.getByRole('button', { name: 'Play' }));
}

const currentWord = () => document.querySelector('[data-highlight="Cursor"]')?.textContent;

describe('TeleprompterPage', () => {
  it('needs a chapter and a microphone before it can start', async () => {
    const user = userEvent.setup();
    renderPage();

    const start = (await screen.findByRole('button', { name: 'Play' })) as HTMLButtonElement;
    expect(start.disabled).toBe(true);
    expect((screen.getByLabelText('Chapter') as HTMLSelectElement).value).toBe('chapter-1');

    await openMicPopover(user);
    await user.selectOptions(screen.getByLabelText('Microphone', { selector: 'select' }), DEVICE_NAME);
    expect(start.disabled).toBe(false);
  });

  it('lists the enumerated devices in the picker, not a typed field', async () => {
    const user = userEvent.setup();
    renderPage();

    await openMicPopover(user);
    const field = (await screen.findByLabelText('Microphone', { selector: 'select' })) as HTMLSelectElement;
    expect(field.tagName).toBe('SELECT');
    expect(Array.from(field.options).map((option) => option.textContent)).toContain(DEVICE_NAME);
  });

  it('blocks Start with a clear message when device enumeration returns nothing, and offers no typed fallback', async () => {
    const user = userEvent.setup();
    renderPage({}, { teleprompterDevices: [] });

    await openMicPopover(user);
    expect(await screen.findByText(/No microphone found/)).toBeTruthy();
    expect(screen.queryByRole('combobox', { name: 'Microphone' })).toBeNull();
    const start = screen.getByRole('button', { name: 'Play' }) as HTMLButtonElement;
    expect(start.disabled).toBe(true);
  });

  it('blocks Start with a distinct message when device enumeration fails outright', async () => {
    const user = userEvent.setup();
    renderPage({ teleprompterDevices: async () => ({ devices: [], error: 'Could not list input devices' }) });

    await openMicPopover(user);
    expect(await screen.findByText(/Couldn't list microphones/)).toBeTruthy();
    const start = screen.getByRole('button', { name: 'Play' }) as HTMLButtonElement;
    expect(start.disabled).toBe(true);
  });

  it('remembers the microphone between visits, persisted through the global settings, not browser storage', async () => {
    const user = userEvent.setup();
    const { api } = renderPage();
    await openMicPopover(user);
    await user.selectOptions(await screen.findByLabelText('Microphone', { selector: 'select' }), OTHER_DEVICE_NAME);
    await waitFor(async () => {
      const settings = await api.settingsForScope('global');
      expect(settings.Teleprompter?.find((field) => field.key === 'input_device')?.value).toBe(OTHER_DEVICE_NAME);
    });
    cleanup();

    renderPage({}, {}, api);
    await openMicPopover(user);

    expect(((await screen.findByLabelText('Microphone', { selector: 'select' })) as HTMLSelectElement).value).toBe(OTHER_DEVICE_NAME);
  });

  it('migrates a browser-storage device from before Phase 2, once, into the global settings', async () => {
    window.localStorage.setItem('narration.teleprompter.device', 'Legacy USB Mic');

    const { api } = renderPage();

    await waitFor(async () => {
      const settings = await api.settingsForScope('global');
      expect(settings.Teleprompter?.find((field) => field.key === 'input_device')).toMatchObject({ value: 'Legacy USB Mic', isSet: true });
    });
    expect(window.localStorage.getItem('narration.teleprompter.device')).toBeNull();
  });

  it('does not migrate the legacy browser value once a device has already been chosen through settings', async () => {
    window.localStorage.setItem('narration.teleprompter.device', 'Legacy USB Mic');
    const api = createMockApi();
    await api.saveSettings('Teleprompter', 'global', { input_device: OTHER_DEVICE_NAME });

    const user = userEvent.setup();
    renderPage({}, {}, api);
    await openMicPopover(user);

    await waitFor(async () =>
      expect((await screen.findByLabelText('Microphone', { selector: 'select' })) as HTMLSelectElement).toHaveProperty('value', OTHER_DEVICE_NAME),
    );
    const settings = await api.settingsForScope('global');
    expect(settings.Teleprompter?.find((field) => field.key === 'input_device')?.value).toBe(OTHER_DEVICE_NAME);
  });

  it('starts a session for the chosen chapter and microphone', async () => {
    const user = userEvent.setup();
    const teleprompterStart = vi.fn().mockResolvedValue({ status: 'started' });
    renderPage({ teleprompterStart });

    await startReading(user);

    expect(teleprompterStart).toHaveBeenCalledWith({ chapter: 'chapter-1', device: DEVICE_NAME, engine: 'whisper', model: 'tiny' });
  });

  // Phase 7 ("Engine choice end to end"): the engines are the ones the host can launch here (its Teleprompter.engine
  // setting's choices), and the choice is a machine setting, remembered like the microphone.
  it('starts with the engine the narrator chose and remembers it in the global settings', async () => {
    const user = userEvent.setup();
    const teleprompterStart = vi.fn().mockResolvedValue({ status: 'started' });
    const { api } = renderPage({ teleprompterStart });

    await openSettingsPopover(user);
    const engines = await screen.findByRole('group', { name: 'Engine' });
    await user.click(within(engines).getByRole('button', { name: 'Moonshine' }));
    await startReading(user);

    expect(teleprompterStart).toHaveBeenCalledWith({ chapter: 'chapter-1', device: DEVICE_NAME, engine: 'moonshine', model: 'tiny' });
    const settings = await api.settingsForScope('global');
    expect(settings.Teleprompter?.find((field) => field.key === 'engine')?.value).toBe('moonshine');
  });

  it('reads the engine from the Teleprompter settings section', async () => {
    const user = userEvent.setup();
    const teleprompterStart = vi.fn().mockResolvedValue({ status: 'started' });
    const api = createMockApi({ teleprompterStart });
    await api.saveSettings('Teleprompter', 'global', { engine: 'moonshine' });

    renderPage({}, {}, api);

    await openSettingsPopover(user);
    const moonshine = await screen.findByRole('button', { name: 'Moonshine' });
    await waitFor(() => expect(moonshine.getAttribute('aria-pressed')).toBe('true'));
    await startReading(user);
    expect(teleprompterStart).toHaveBeenCalledWith(expect.objectContaining({ engine: 'moonshine' }));
  });

  it('offers no engine choice where the host can launch only Whisper', async () => {
    const user = userEvent.setup();
    const base = createMockApi();
    const settingsForScope: NarrationApi['settingsForScope'] = async (scope) => {
      const settings = await base.settingsForScope(scope);
      return {
        ...settings,
        Teleprompter: (settings.Teleprompter ?? []).map((field) => (field.key === 'engine' ? { ...field, choices: ['whisper'] } : field)),
      };
    };
    renderPage({ settingsForScope });

    await openSettingsPopover(user);
    await screen.findByRole('group', { name: 'Model' });
    expect(screen.queryByRole('group', { name: 'Engine' })).toBeNull();
  });

  it('remembers the model choice in the global settings', async () => {
    const user = userEvent.setup();
    const { api } = renderPage();

    await openSettingsPopover(user);
    await user.click(await screen.findByRole('button', { name: 'Small' }));

    await waitFor(async () => {
      const settings = await api.settingsForScope('global');
      expect(settings.Teleprompter?.find((field) => field.key === 'model')?.value).toBe('small');
    });
  });

  // Phase 3 ("Teleprompter settings section"): the page reads the Settings section's default model on load, so a
  // session starts with whichever model the narrator set in Settings rather than always Tiny.
  it('reads the default model from the Teleprompter settings section', async () => {
    const user = userEvent.setup();
    const teleprompterStart = vi.fn().mockResolvedValue({ status: 'started' });
    const api = createMockApi({ teleprompterStart });
    await api.saveSettings('Teleprompter', 'global', { model: 'small' });

    renderPage({}, {}, api);

    await openSettingsPopover(user);
    const small = await screen.findByRole('button', { name: 'Small' });
    await waitFor(() => expect(small.getAttribute('aria-pressed')).toBe('true'));

    await startReading(user);
    expect(teleprompterStart).toHaveBeenCalledWith({ chapter: 'chapter-1', device: DEVICE_NAME, engine: 'whisper', model: 'small' });
  });

  it('follows the reading word by word', async () => {
    const user = userEvent.setup();
    const { emit, setState } = renderPage({ teleprompterStart: async () => ({ status: 'started' }) });
    const script = await chapterScript();
    await startReading(user);
    setState({ phase: 'running', message: 'Listening…', chapter: 'chapter-1' });

    emit(script);
    emit(position(7));

    await waitFor(() => expect(currentWord()).toBe('beginning'));
    expect(screen.getByRole('status').textContent).toMatch(/Listening/);
    expect(screen.getByRole('button', { name: 'Stop reading' })).toBeTruthy();
  });

  it('shows what was heard while it follows', async () => {
    const user = userEvent.setup();
    const { emit, setState } = renderPage({ teleprompterStart: async () => ({ status: 'started' }) });
    const script = await chapterScript();
    await startReading(user);
    setState({ phase: 'running', message: 'Listening…', chapter: 'chapter-1' });

    emit(script);
    emit({ type: 'partial', segment: 0, words: [{ word: 'alice', start: 0, end: 0.3 }] });

    expect(await screen.findByText(/Heard: alice/)).toBeTruthy();
  });

  it('says so when the narrator stops and when the chapter is finished', async () => {
    const user = userEvent.setup();
    const { emit, setState } = renderPage({ teleprompterStart: async () => ({ status: 'started' }) });
    const script = await chapterScript();
    await startReading(user);
    setState({ phase: 'running', message: 'Listening…', chapter: 'chapter-1' });
    emit(script);

    emit(position(7, { status: 'waiting' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/Waiting for you to return to the script/));

    emit(position(script.tokens, { status: 'done' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/Done/));
    // The highlight walks the whole way from word 7 to the end, which takes a couple of seconds.
    await waitFor(() => expect(currentWord()).toBeUndefined(), { timeout: 5000 });
  }, 15_000);

  it('does not animate a one-word backward correction', async () => {
    const user = userEvent.setup();
    const { emit, setState } = renderPage({ teleprompterStart: async () => ({ status: 'started' }) });
    const script = await chapterScript();
    await startReading(user);
    setState({ phase: 'running', message: 'Listening…', chapter: 'chapter-1' });
    emit(script);
    emit(position(10));
    await waitFor(() => expect(document.querySelector('[data-word="10"] [data-highlight="Cursor"]')).toBeTruthy());

    emit(position(9));

    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(document.querySelector('[data-word="10"] [data-highlight="Cursor"]')).toBeTruthy();
  });

  it('marks words the narrator skipped past', async () => {
    const user = userEvent.setup();
    const { emit, setState } = renderPage({ teleprompterStart: async () => ({ status: 'started' }) });
    const script = await chapterScript();
    await startReading(user);
    setState({ phase: 'running', message: 'Listening…', chapter: 'chapter-1' });
    emit(script);

    emit(position(10, { jump: 'skip', skipped: [8, 10] }));

    await waitFor(() => expect(document.querySelectorAll('[data-skipped]')).toHaveLength(2));
    expect(document.querySelector('[data-word="8"]')?.hasAttribute('data-skipped')).toBe(true);
  });

  it('picks up a session the host kept running', async () => {
    renderPage({}, { teleprompter: 'waiting' });

    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/Waiting for you to return to the script/));
    await waitFor(() => expect(currentWord()).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Stop reading' })).toBeTruthy();
  });

  it('shows a finished chapter from the host', async () => {
    renderPage({}, { teleprompter: 'done' });

    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/Done/));
  });

  it('says the session will stop itself once the chapter is done', async () => {
    renderPage({}, { teleprompter: 'done' });

    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/Done - stopping in a few seconds unless you read on/));
  });

  it('says when a session stopped itself at the end of the chapter', async () => {
    renderPage({}, { teleprompter: 'ended' });

    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Stopped at the end of the chapter.'));
    expect(screen.getByRole('button', { name: 'Play' })).toBeTruthy();
  });

  it('stops the session and offers to start again', async () => {
    const user = userEvent.setup();
    const teleprompterStop = vi.fn().mockResolvedValue(undefined);
    const { setState } = renderPage({ teleprompterStop }, { teleprompter: 'listening' });
    await user.click(await screen.findByRole('button', { name: 'Stop reading' }));

    setState({ phase: 'stopped', message: 'Stopped.', chapter: 'chapter-1' });

    expect(teleprompterStop).toHaveBeenCalled();
    expect(await screen.findByRole('button', { name: 'Play' })).toBeTruthy();
  });

  it('reports why a session could not start', async () => {
    const user = userEvent.setup();
    renderPage({ teleprompterStart: async () => Promise.reject(new Error('Choose a microphone.')) });

    await startReading(user);

    expect((await screen.findByRole('alert')).textContent).toMatch(/Choose a microphone/);
  });

  it('shows the host error message when a session fails', async () => {
    const { setState } = renderPage();
    await screen.findByRole('button', { name: 'Play' });

    setState({ phase: 'error', message: 'No such microphone.' });

    expect((await screen.findByRole('alert')).textContent).toMatch(/No such microphone/);
  });

  it('downloads the model first when it is missing, then starts', async () => {
    const user = userEvent.setup();
    const teleprompterStart = vi
      .fn()
      .mockResolvedValueOnce({
        status: 'asset_required',
        engine: 'whisper',
        model: { id: 'tiny', displayName: 'Tiny', publisher: 'Systran', license: 'MIT', licenseUrl: 'https://example.test/license' },
        installState: 'not_installed',
        downloadSize: 75_000_000,
      })
      .mockResolvedValue({ status: 'started' });
    const assetsInstall = vi.fn().mockResolvedValue({
      id: 'w-1',
      kind: 'whisper',
      assetId: 'tiny',
      phase: 'success',
      message: 'Installed.',
      percent: 100,
      bytesDone: 10,
      bytesTotal: 10,
      error: '',
    });
    renderPage({ teleprompterStart, assetsInstall });
    await startReading(user);

    const dialog = await screen.findByRole('alertdialog', { name: 'Download local Whisper model?' });
    await user.click(within(dialog).getByRole('button', { name: 'Download model' }));

    await waitFor(() => expect(teleprompterStart).toHaveBeenCalledTimes(2));
    expect(assetsInstall).toHaveBeenCalledWith('whisper', 'tiny');
  });

  // Choosing Moonshine never downloads anything: Start asks first, naming the engine, and only a confirm installs it
  // (the first-use gate, as for Whisper), after which the session starts.
  it('asks before downloading the Moonshine model, installs it as a Moonshine asset, then starts', async () => {
    const user = userEvent.setup();
    const { api } = renderPage({}, { assets: 'missing' });
    const assetsInstall = vi.spyOn(api, 'assetsInstall');
    const teleprompterStart = vi.spyOn(api, 'teleprompterStart');

    await openSettingsPopover(user);
    await user.click(await screen.findByRole('button', { name: 'Moonshine' }));
    expect(assetsInstall).not.toHaveBeenCalled();
    await startReading(user);

    const dialog = await screen.findByRole('alertdialog', { name: 'Download local Moonshine model?' });
    expect(dialog.textContent).toMatch(/Moonshine AI/);
    await user.click(within(dialog).getByRole('button', { name: 'Download model' }));

    await waitFor(() => expect(teleprompterStart).toHaveBeenCalledTimes(2), { timeout: 5000 });
    expect(assetsInstall).toHaveBeenCalledWith('moonshine', 'tiny');
    expect(teleprompterStart).toHaveBeenLastCalledWith(expect.objectContaining({ engine: 'moonshine' }));
  });

  it('says so when the manuscript has no chapter to read', async () => {
    renderPage({ manuscriptChapters: async () => [] });

    const region = await screen.findByRole('region', { name: /no chapters to read/i });
    expect(within(region).getByRole('heading', { level: 2 })).toBeTruthy();
  });
});

// Chapter from REAPER track name (teleprompter-engines-and-input-devices PRD Phase 11, ADR 0113).
describe('TeleprompterPage chapter suggestion from REAPER', () => {
  const [chapter1Track, chapter2Track] = WIRE_TRACKS_PROJECT.tracks;
  const chapterPicker = () => screen.getByLabelText('Chapter') as HTMLSelectElement;
  const suggestion = (overrides: Partial<ChapterSuggestion>): ChapterSuggestion => ({
    projectFile: WIRE_TRACKS_PROJECT.path,
    savedAt: '2026-09-21T10:00:00Z',
    basis: 'armed',
    track: { guid: 'guid-x', name: 'Chaptr 2', index: 3 },
    status: 'none',
    chapter: null,
    candidates: [],
    warnings: [],
    ...overrides,
  });
  const candidate = (index: number) => ({
    chapterId: WIRE_CHAPTERS[index].id,
    chapterTitle: WIRE_CHAPTERS[index].title,
    score: 0.8,
    source: 'track-name' as const,
    region: null,
  });

  it('preselects the chapter the armed track is named for, over the last chapter read, and says why', async () => {
    renderPage({ readerState: async () => ({ activeChapter: WIRE_CHAPTERS[2].id }) as never }, { armedTracks: [chapter2Track.guid] });

    await waitFor(() => expect(chapterPicker().value).toBe(WIRE_CHAPTERS[1].id));
    expect(screen.getByText(/Chosen from REAPER's armed track, “Chapter 2” in Alice\.rpp, which is named for this chapter/)).toBeTruthy();
  });

  it('offers the suggestion back once the narrator picks another chapter', async () => {
    const user = userEvent.setup();
    renderPage({}, { armedTracks: [chapter2Track.guid] });
    await waitFor(() => expect(chapterPicker().value).toBe(WIRE_CHAPTERS[1].id));

    await user.selectOptions(chapterPicker(), WIRE_CHAPTERS[3].id);
    await user.click(await screen.findByRole('button', { name: 'Use Chapter 2' }));

    expect(chapterPicker().value).toBe(WIRE_CHAPTERS[1].id);
  });

  it('never picks for the narrator when two armed tracks name different chapters, and offers both', async () => {
    const user = userEvent.setup();
    renderPage({}, { armedTracks: [chapter1Track.guid, chapter2Track.guid] });

    const choices = await screen.findByRole('group', { name: 'Chapters suggested by REAPER' });
    expect(chapterPicker().value).toBe(WIRE_CHAPTERS[0].id);
    expect(screen.getByText(/could be for more than one chapter/)).toBeTruthy();
    // The chapter already chosen is not offered again.
    expect(
      within(choices)
        .getAllByRole('button')
        .map((button) => button.textContent),
    ).toEqual(['Chapter 2']);

    await user.click(within(choices).getByRole('button', { name: 'Chapter 2' }));
    expect(chapterPicker().value).toBe(WIRE_CHAPTERS[1].id);
  });

  it('only offers an uncertain match, never preselecting it', async () => {
    renderPage({ chapterSuggestion: async () => suggestion({ status: 'uncertain', candidates: [candidate(1)] }) });

    const choices = await screen.findByRole('group', { name: 'Chapters suggested by REAPER' });
    expect(within(choices).getByRole('button', { name: 'Chapter 2' })).toBeTruthy();
    expect(screen.getByText(/“Chaptr 2” in Alice\.rpp, as of its last save, may be for:/)).toBeTruthy();
    expect(chapterPicker().value).toBe(WIRE_CHAPTERS[0].id);
  });

  it('matches the Chapter 1 track to Chapter 1, never Chapter 10, 11 or 12', async () => {
    renderPage({}, { armedTracks: [chapter1Track.guid] });

    await screen.findByText(/Chosen from REAPER's armed track, “Chapter 1”/);
    expect(chapterPicker().value).toBe(WIRE_CHAPTERS[0].id);
  });

  it('keeps the usual default and shows no hint when nothing is armed, or the project has no .rpp', async () => {
    renderPage({ chapterSuggestion: async () => Promise.reject(new Error('no REAPER project (.rpp) file was found in this project folder')) });

    await waitFor(() => expect(chapterPicker().value).toBe(WIRE_CHAPTERS[0].id));
    expect(screen.queryByText(/REAPER/)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    cleanup();

    renderPage();
    await waitFor(() => expect(chapterPicker().value).toBe(WIRE_CHAPTERS[0].id));
    expect(screen.queryByText(/REAPER/)).toBeNull();
  });

  it('does not move a session the host kept running to the suggested chapter', async () => {
    const manuscriptParagraphs = vi.fn(createMockApi().manuscriptParagraphs);
    renderPage({ manuscriptParagraphs }, { teleprompter: 'listening', armedTracks: [chapter2Track.guid] });

    await waitFor(() => expect(currentWord()).toBeTruthy());
    expect(manuscriptParagraphs.mock.calls.map(([id]) => id)).not.toContain(WIRE_CHAPTERS[1].id);
  });
});

// The credits on the teleprompter (audiobook-credits-templates.prd.md Phase 4, ADR 0150; C6: warn, never block).
describe('TeleprompterPage credits', () => {
  const FILLED = { title: 'Alice’s Adventures in Wonderland', author: 'Lewis Carroll', narrator: 'Ada Finch' };
  const optionLabels = async () => Array.from(((await screen.findByLabelText('Chapter')) as HTMLSelectElement).options, (option) => option.textContent);

  it('offers the opening credits before the first chapter and the closing credits after the last', async () => {
    renderPage();

    await waitFor(async () => expect((await optionLabels()).length).toBeGreaterThan(2));
    const labels = await optionLabels();
    expect(labels[0]).toBe('Opening credits');
    expect(labels.at(-1)).toBe('Closing credits');
  });

  it('leaves out credits of a kind the library has no template for', async () => {
    renderPage({ creditsTemplates: async () => [] });

    await screen.findByText('Alice was beginning', { exact: false });
    expect(await optionLabels()).not.toContain('Opening credits');
    expect(await optionLabels()).not.toContain('Closing credits');
  });

  it('shows the credits as the host rendered them and starts the credits, not a chapter', async () => {
    const user = userEvent.setup();
    const teleprompterStart = vi.fn().mockResolvedValue({ status: 'started' });
    renderPage({ teleprompterStart }, { creditValues: FILLED });

    await waitFor(async () => expect(await optionLabels()).toContain('Opening credits'));
    await user.selectOptions(screen.getByLabelText('Chapter'), 'Opening credits');

    expect(await screen.findByText('Alice’s Adventures in Wonderland, written by Lewis Carroll, narrated by Ada Finch.')).toBeTruthy();
    expect(screen.queryByText(/have no value/)).toBeNull();
    await startReading(user);
    expect(teleprompterStart).toHaveBeenCalledWith({ credits: 'opening', device: DEVICE_NAME, engine: 'whisper', model: 'tiny' });
  });

  it('warns which tokens have no value, links to Settings, and still allows Start', async () => {
    const user = userEvent.setup();
    const onFixCredits = vi.fn();
    const teleprompterStart = vi.fn().mockResolvedValue({ status: 'started' });
    renderPage({ teleprompterStart }, {}, undefined, { onFixCredits });

    await waitFor(async () => expect(await optionLabels()).toContain('Closing credits'));
    await user.selectOptions(screen.getByLabelText('Chapter'), 'Closing credits');

    const warning = await screen.findByRole('status', { name: /have no value/ });
    expect(warning.textContent).toContain('Title, Author, Narrator');
    await user.click(within(warning).getByRole('button', { name: 'Fill them in Settings' }));
    expect(onFixCredits).toHaveBeenCalled();
    await startReading(user);
    expect(teleprompterStart).toHaveBeenCalledWith({ credits: 'closing', device: DEVICE_NAME, engine: 'whisper', model: 'tiny' });
  });

  it("follows the reading through the credits with the sidecar's spans", async () => {
    const user = userEvent.setup();
    const { emit, setState } = renderPage({ teleprompterStart: async () => ({ status: 'started' }) }, { creditValues: FILLED });
    await waitFor(async () => expect(await optionLabels()).toContain('Opening credits'));
    await user.selectOptions(screen.getByLabelText('Chapter'), 'Opening credits');
    await startReading(user);
    setState({ phase: 'running', chapter: 'credits-opening' });

    emit({
      type: 'script',
      chapter: { id: 'credits-opening', title: 'Opening credits' },
      tokens: 12,
      spans: [{ kind: 'paragraph', id: 'credits-opening-1', index: null, start: 0, count: 12 }],
    });
    emit(position(6));

    await waitFor(() => expect(currentWord()).toBe('Lewis'));
  });
});
