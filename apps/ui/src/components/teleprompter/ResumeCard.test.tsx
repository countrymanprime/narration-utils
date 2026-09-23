// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReadAloudDialog } from './ReadAloudDialog';
import { ApiProvider } from '../../api/ApiContext';
import { createMockApi } from '../../api/mockApi';
import { WIRE_TELEPROMPTER_DEVICES } from '../../api/mockFixtures';
import type { NarrationApi, TeleprompterState } from '../../types';

// The resume card in the read-aloud dialog (teleprompter-manuscript-integration.prd.md Phase 10): it asks the host where
// the chapter's recording ends (TeleprompterLocate, ADR 0111) and offers that word, the top, or a word of the narrator's
// choosing; it never starts anything by itself.

const DEVICE_NAME = WIRE_TELEPROMPTER_DEVICES[0].name;
const CHAPTER = { id: 'chapter-1', title: 'Chapter 1', subtitle: 'Down the Rabbit-Hole' };

afterEach(() => {
  cleanup();
});

type Initial = Parameters<typeof createMockApi>[1];

function renderDialog(overrides: Partial<NarrationApi> = {}, initial: Initial = {}) {
  const stateListeners = new Set<(state: TeleprompterState) => void>();
  const base = createMockApi({}, initial);
  const teleprompterLocate = vi.fn(overrides.teleprompterLocate ?? base.teleprompterLocate);
  const teleprompterStart = vi.fn(overrides.teleprompterStart ?? (async () => ({ status: 'started' as const })));
  const api = createMockApi(
    {
      subscribeTeleprompterState: (listener) => {
        stateListeners.add(listener);
        return () => stateListeners.delete(listener);
      },
      ...overrides,
      teleprompterLocate,
      teleprompterStart,
    },
    initial,
  );
  render(
    <ApiProvider api={api}>
      <ReadAloudDialog chapter={CHAPTER} onClose={vi.fn()} />
    </ApiProvider>,
  );
  return {
    api,
    teleprompterLocate,
    teleprompterStart,
    setState: (state: Partial<TeleprompterState>) =>
      act(() =>
        stateListeners.forEach((listener) => listener({ phase: 'idle', message: '', engine: null, chapter: null, script: null, position: null, ...state })),
      ),
  };
}

const card = () => screen.findByRole('region', { name: 'Where you stopped' });

async function startReading(user: ReturnType<typeof userEvent.setup>) {
  await user.selectOptions(await screen.findByRole('combobox', { name: 'Microphone' }), DEVICE_NAME);
  await user.click(screen.getByRole('button', { name: 'Start reading' }));
}

describe('ResumeCard', () => {
  it('offers the resume word with its sentence, track and confidence, labelled as of the last save, and starts nothing', async () => {
    const { api, teleprompterLocate, teleprompterStart } = renderDialog();
    const located = await api.teleprompterLocate('chapter-1');
    if (located.status !== 'found' || !located.located?.sentence || located.located.word === null) throw new Error('the mock chapter must resume part-way');
    const sentence = located.located.sentence;

    const region = await card();
    expect(await within(region).findByText(/Chapter 1 track/)).toBeTruthy();
    expect(within(region).getByText(/as of the project's last save/)).toBeTruthy();
    expect(within(region).getByText(/84% sure/)).toBeTruthy();
    expect(within(region).getByRole('button', { name: 'Resume from here' })).toBeTruthy();
    expect(within(region).getByRole('button', { name: 'Start from the top' })).toBeTruthy();
    expect(within(region).getByRole('button', { name: 'Pick a word' })).toBeTruthy();
    // The sentence is quoted with the resume word in bold, so the narrator sees exactly where reading picks up.
    const quote = within(region).getByRole('blockquote');
    expect(quote.textContent).toBe(`“${sentence.text}”`);
    expect(within(quote).getByText(sentence.text.split(' ')[located.located.word - sentence.start]).tagName).toBe('STRONG');
    expect(teleprompterLocate).toHaveBeenCalledWith('chapter-1', { model: 'tiny' });
    expect(teleprompterStart).not.toHaveBeenCalled();
  });

  it('"Resume from here" makes Start reading begin at the located word', async () => {
    const user = userEvent.setup();
    const { api, teleprompterStart } = renderDialog();
    const located = await api.teleprompterLocate('chapter-1');
    if (located.status !== 'found' || located.located?.word == null) throw new Error('the mock chapter must resume part-way');

    const region = await card();
    await user.click(await within(region).findByRole('button', { name: 'Resume from here' }));
    expect(within(region).getByText(new RegExp(`word ${located.located.word.toLocaleString()}`))).toBeTruthy();
    await startReading(user);

    expect(teleprompterStart).toHaveBeenCalledWith({
      chapter: 'chapter-1',
      device: DEVICE_NAME,
      engine: 'whisper',
      model: 'tiny',
      startWord: located.located.word,
    });
  });

  it('"Start from the top" starts at the first word, and Change offers the resume point again', async () => {
    const user = userEvent.setup();
    const { teleprompterStart } = renderDialog();

    const region = await card();
    await user.click(await within(region).findByRole('button', { name: 'Resume from here' }));
    await user.click(within(region).getByRole('button', { name: 'Change' }));
    await user.click(within(region).getByRole('button', { name: 'Start from the top' }));
    expect(within(region).getByText(/Reading starts from the top/)).toBeTruthy();
    await startReading(user);

    expect(teleprompterStart).toHaveBeenCalledWith({ chapter: 'chapter-1', device: DEVICE_NAME, engine: 'whisper', model: 'tiny' });
  });

  it('"Pick a word" says how: start reading, then click the word', async () => {
    const user = userEvent.setup();
    renderDialog();

    const region = await card();
    await user.click(await within(region).findByRole('button', { name: 'Pick a word' }));

    expect(within(region).getByText(/click the word you want/)).toBeTruthy();
  });

  it('offers a low-confidence resume point as a guess to check', async () => {
    renderDialog({}, { resume: 'low_confidence' });

    const region = await card();
    expect(await within(region).findByText(/could also fit elsewhere/)).toBeTruthy();
    expect(within(region).getByRole('button', { name: 'Resume from here' })).toBeTruthy();
  });

  it('says so when the end of the recording does not match the chapter, and offers no resume word', async () => {
    renderDialog({}, { resume: 'not_found' });

    const region = await card();
    expect(await within(region).findByText(/did not match this chapter/)).toBeTruthy();
    expect(within(region).queryByRole('button', { name: 'Resume from here' })).toBeNull();
    expect(within(region).getByRole('button', { name: 'Pick a word' })).toBeTruthy();
  });

  it('asks the narrator to pick the track when the match is uncertain, and never guesses', async () => {
    const user = userEvent.setup();
    const { teleprompterLocate } = renderDialog({}, { resume: 'ambiguous' });

    const region = await card();
    const picker = await within(region).findByRole('combobox', { name: 'Track' });
    expect(within(region).getByText(/More than one track/)).toBeTruthy();
    expect(within(region).queryByRole('button', { name: 'Resume from here' })).toBeNull();

    await user.selectOptions(picker, '{0E4D1D7F-D039-674D-87E6-719376DE95EC}');
    await user.click(within(region).getByRole('button', { name: 'Read this track' }));

    expect(teleprompterLocate).toHaveBeenLastCalledWith('chapter-1', { model: 'tiny', trackGuid: '{0E4D1D7F-D039-674D-87E6-719376DE95EC}' });
    expect(await within(region).findByRole('button', { name: 'Resume from here' })).toBeTruthy();
  });

  it('"Another track" reads a track the narrator picks instead of the matched one', async () => {
    const user = userEvent.setup();
    const { teleprompterLocate } = renderDialog();

    const region = await card();
    await user.click(await within(region).findByRole('button', { name: 'Another track' }));
    const picker = within(region).getByRole('combobox', { name: 'Track' });
    expect(within(picker).queryByRole('option', { name: /^Chapter 1/ })).toBeNull();
    await user.selectOptions(picker, '{DA2D209F-D10F-5E46-93E7-098D96499ED0}');
    await user.click(within(region).getByRole('button', { name: 'Read this track' }));

    expect(teleprompterLocate).toHaveBeenLastCalledWith('chapter-1', { model: 'tiny', trackGuid: '{DA2D209F-D10F-5E46-93E7-098D96499ED0}' });
    expect(await within(region).findByText(/Chapter 2 track, your pick/)).toBeTruthy();
  });

  it('says reading starts from the top when no track matches the chapter', async () => {
    renderDialog({}, { resume: 'none' });

    const region = await card();
    expect(await within(region).findByText(/No track in Alice.rpp matches this chapter/)).toBeTruthy();
    expect(within(region).getByRole('combobox', { name: 'Track' })).toBeTruthy();
  });

  it.each([
    ['no_recording', /has no recorded audio yet/],
    ['source_missing', /audio file is missing/],
    ['source_unsupported', /cannot be read/],
  ] as const)('explains a %s track and starts from the top', async (resume, text) => {
    renderDialog({}, { resume });

    const region = await card();
    expect(await within(region).findByText(text)).toBeTruthy();
    expect(within(region).getByText(/starts from the top/)).toBeTruthy();
    expect(within(region).queryByRole('button', { name: 'Resume from here' })).toBeNull();
  });

  it('asks before downloading the model it needs, and never downloads silently', async () => {
    const user = userEvent.setup();
    const whisperInstall = vi.fn();
    renderDialog({ whisperInstall }, { assets: 'missing' });

    const region = await card();
    expect(await within(region).findByText(/not downloaded yet/)).toBeTruthy();
    expect(screen.queryByRole('alertdialog')).toBeNull();

    await user.click(within(region).getByRole('button', { name: 'Download model…' }));

    expect(await screen.findByRole('alertdialog', { name: 'Download local Whisper model?' })).toBeTruthy();
    expect(whisperInstall).not.toHaveBeenCalled();
  });

  it('shows why the lookup failed, and tries again on request', async () => {
    const user = userEvent.setup();
    const { teleprompterLocate } = renderDialog({}, { resume: 'error' });

    const region = await card();
    expect(await within(region).findByText(/could not read/)).toBeTruthy();
    await user.click(within(region).getByRole('button', { name: 'Try again' }));

    await waitFor(() => expect(teleprompterLocate).toHaveBeenCalledTimes(2));
  });

  it('is not shown while a session is running', async () => {
    const { setState } = renderDialog();
    await card();

    setState({ phase: 'running', message: 'Listening…', chapter: 'chapter-1' });

    await waitFor(() => expect(screen.queryByRole('region', { name: 'Where you stopped' })).toBeNull());
  });
});
