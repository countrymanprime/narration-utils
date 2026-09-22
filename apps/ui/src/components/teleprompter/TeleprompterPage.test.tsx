// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TeleprompterPage } from './TeleprompterPage';
import { ApiProvider } from '../../api/ApiContext';
import { createMockApi } from '../../api/mockApi';
import { WIRE_TELEPROMPTER_DEVICES } from '../../api/mockFixtures';
import type { NarrationApi, TeleprompterEvent, TeleprompterPosition, TeleprompterScript, TeleprompterState } from '../../types';

const DEVICE_NAME = WIRE_TELEPROMPTER_DEVICES[0].name;
const OTHER_DEVICE_NAME = WIRE_TELEPROMPTER_DEVICES[1].name;

beforeEach(() => {
  // The mock would otherwise try to download the full Alice text; offline it uses the small fixture.
  vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')));
  window.localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
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

function renderPage(overrides: Partial<NarrationApi> = {}, initial: Parameters<typeof createMockApi>[1] = {}, existingApi?: NarrationApi) {
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
    <ApiProvider api={api}>
      <TeleprompterPage />
    </ApiProvider>,
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

async function startReading(user: ReturnType<typeof userEvent.setup>) {
  await user.selectOptions(await screen.findByLabelText('Microphone'), DEVICE_NAME);
  await user.click(screen.getByRole('button', { name: 'Start reading' }));
}

const currentWord = () => document.querySelector('[data-highlight="Cursor"]')?.textContent;

describe('TeleprompterPage', () => {
  it('needs a chapter and a microphone before it can start', async () => {
    const user = userEvent.setup();
    renderPage();

    const start = (await screen.findByRole('button', { name: 'Start reading' })) as HTMLButtonElement;
    expect(start.disabled).toBe(true);
    expect((screen.getByLabelText('Chapter') as HTMLSelectElement).value).toBe('chapter-1');

    await user.selectOptions(screen.getByLabelText('Microphone'), DEVICE_NAME);
    expect(start.disabled).toBe(false);
  });

  it('lists the enumerated devices in the picker, not a typed field', async () => {
    renderPage();

    const field = (await screen.findByLabelText('Microphone')) as HTMLSelectElement;
    expect(field.tagName).toBe('SELECT');
    expect(Array.from(field.options).map((option) => option.textContent)).toContain(DEVICE_NAME);
  });

  it('remembers the microphone between visits, persisted through the global settings, not browser storage', async () => {
    const user = userEvent.setup();
    const { api } = renderPage();
    await user.selectOptions(await screen.findByLabelText('Microphone'), OTHER_DEVICE_NAME);
    await waitFor(async () => {
      const settings = await api.settingsForScope('global');
      expect(settings.Teleprompter?.find((field) => field.key === 'input_device')?.value).toBe(OTHER_DEVICE_NAME);
    });
    cleanup();

    renderPage({}, {}, api);

    expect(((await screen.findByLabelText('Microphone')) as HTMLSelectElement).value).toBe(OTHER_DEVICE_NAME);
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

    renderPage({}, {}, api);

    await waitFor(async () => expect((await screen.findByLabelText('Microphone')) as HTMLSelectElement).toHaveProperty('value', OTHER_DEVICE_NAME));
    const settings = await api.settingsForScope('global');
    expect(settings.Teleprompter?.find((field) => field.key === 'input_device')?.value).toBe(OTHER_DEVICE_NAME);
  });

  it('starts a session for the chosen chapter and microphone', async () => {
    const user = userEvent.setup();
    const teleprompterStart = vi.fn().mockResolvedValue({ status: 'started' });
    renderPage({ teleprompterStart });

    await startReading(user);

    expect(teleprompterStart).toHaveBeenCalledWith({ chapter: 'chapter-1', device: DEVICE_NAME, model: 'tiny' });
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
    expect(screen.getByRole('button', { name: 'Stop' })).toBeTruthy();
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
    expect(screen.getByRole('button', { name: 'Stop' })).toBeTruthy();
  });

  it('shows a finished chapter from the host', async () => {
    renderPage({}, { teleprompter: 'done' });

    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/Done/));
  });

  it('stops the session and offers to start again', async () => {
    const user = userEvent.setup();
    const teleprompterStop = vi.fn().mockResolvedValue(undefined);
    const { setState } = renderPage({ teleprompterStop }, { teleprompter: 'listening' });
    await user.click(await screen.findByRole('button', { name: 'Stop' }));

    setState({ phase: 'stopped', message: 'Stopped.', chapter: 'chapter-1' });

    expect(teleprompterStop).toHaveBeenCalled();
    expect(await screen.findByRole('button', { name: 'Start reading' })).toBeTruthy();
  });

  it('reports why a session could not start', async () => {
    const user = userEvent.setup();
    renderPage({ teleprompterStart: async () => Promise.reject(new Error('Choose a microphone.')) });

    await startReading(user);

    expect((await screen.findByRole('alert')).textContent).toMatch(/Choose a microphone/);
  });

  it('shows the host error message when a session fails', async () => {
    const { setState } = renderPage();
    await screen.findByRole('button', { name: 'Start reading' });

    setState({ phase: 'error', message: 'No such microphone.' });

    expect((await screen.findByRole('alert')).textContent).toMatch(/No such microphone/);
  });

  it('downloads the model first when it is missing, then starts', async () => {
    const user = userEvent.setup();
    const teleprompterStart = vi
      .fn()
      .mockResolvedValueOnce({
        status: 'asset_required',
        model: { id: 'tiny', displayName: 'Tiny', publisher: 'Systran', license: 'MIT', licenseUrl: 'https://example.test/license' },
        installState: 'not_installed',
        downloadSize: 75_000_000,
      })
      .mockResolvedValue({ status: 'started' });
    const whisperInstall = vi
      .fn()
      .mockResolvedValue({ id: 'w-1', modelId: 'tiny', phase: 'success', message: 'Installed.', percent: 100, bytesDone: 10, bytesTotal: 10, error: '' });
    renderPage({ teleprompterStart, whisperInstall });
    await startReading(user);

    const dialog = await screen.findByRole('alertdialog', { name: 'Download local Whisper model?' });
    await user.click(within(dialog).getByRole('button', { name: 'Download model' }));

    await waitFor(() => expect(teleprompterStart).toHaveBeenCalledTimes(2));
    expect(whisperInstall).toHaveBeenCalledWith('tiny');
  });

  it('says so when the manuscript has no chapter to read', async () => {
    renderPage({ manuscriptChapters: async () => [] });

    const region = await screen.findByRole('region', { name: /no chapters to read/i });
    expect(within(region).getByRole('heading', { level: 2 })).toBeTruthy();
  });
});
