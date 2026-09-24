// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReadAloudDialog } from './ReadAloudDialog';
import { ApiProvider } from '../../api/ApiContext';
import { createMockApi } from '../../api/mockApi';
import { WIRE_TELEPROMPTER_DEVICES } from '../../api/mockFixtures';
import type { NarrationApi, TeleprompterLocateResult, TeleprompterState } from '../../types';

// The read-aloud dialog's resume prompt (read-aloud-resume-from-daw.prd.md Phase 1): a compact notice or choice for where
// the chapter's recording ends (TeleprompterLocate, ADR 0111). It never starts anything by itself, and it settles - and
// stays gone - the moment the narrator makes a choice or a session starts, for the rest of this dialog's open.

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
    <MemoryRouter>
      <ApiProvider api={api}>
        <ReadAloudDialog chapter={CHAPTER} onClose={vi.fn()} />
      </ApiProvider>
    </MemoryRouter>,
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

const prompt = () => screen.findByRole('region', { name: 'Where you stopped' });

async function startReading(user: ReturnType<typeof userEvent.setup>) {
  await user.selectOptions(await screen.findByRole('combobox', { name: 'Microphone' }), DEVICE_NAME);
  await user.click(screen.getByRole('button', { name: 'Start reading' }));
}

describe('ResumePrompt', () => {
  it('offers the resume point with its sentence and track, labelled as of the last save, and starts nothing', async () => {
    const { api, teleprompterLocate, teleprompterStart } = renderDialog();
    const located = await api.teleprompterLocate('chapter-1');
    if (located.status !== 'found' || !located.located?.sentence || located.located.word === null) throw new Error('the mock chapter must resume part-way');
    const sentence = located.located.sentence;

    const region = await prompt();
    expect(await within(region).findByText(/Chapter 1 track/)).toBeTruthy();
    expect(within(region).getByText(/as of the project's last save/)).toBeTruthy();
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

  it('"Resume from here" makes Start reading begin at the located word, and the prompt is gone at once', async () => {
    const user = userEvent.setup();
    const { api, teleprompterStart } = renderDialog();
    const located = await api.teleprompterLocate('chapter-1');
    if (located.status !== 'found' || located.located?.word == null) throw new Error('the mock chapter must resume part-way');

    const region = await prompt();
    await user.click(await within(region).findByRole('button', { name: 'Resume from here' }));
    expect(screen.queryByRole('region', { name: 'Where you stopped' })).toBeNull();
    await startReading(user);

    expect(teleprompterStart).toHaveBeenCalledWith({
      chapter: 'chapter-1',
      device: DEVICE_NAME,
      engine: 'whisper',
      model: 'tiny',
      startWord: located.located.word,
    });
  });

  it('"Start from the top" starts at the first word, and the prompt does not come back', async () => {
    const user = userEvent.setup();
    const { teleprompterStart } = renderDialog();

    const region = await prompt();
    await user.click(await within(region).findByRole('button', { name: 'Start from the top' }));
    expect(screen.queryByRole('region', { name: 'Where you stopped' })).toBeNull();
    await startReading(user);

    expect(teleprompterStart).toHaveBeenCalledWith({ chapter: 'chapter-1', device: DEVICE_NAME, engine: 'whisper', model: 'tiny' });
  });

  it('"Pick a word" also settles the prompt, starting from the top until a word is clicked', async () => {
    const user = userEvent.setup();
    renderDialog();

    const region = await prompt();
    await user.click(await within(region).findByRole('button', { name: 'Pick a word' }));

    expect(screen.queryByRole('region', { name: 'Where you stopped' })).toBeNull();
  });

  it('offers a low-confidence resume point as a guess to check', async () => {
    renderDialog({}, { resume: 'low_confidence' });

    const region = await prompt();
    expect(await within(region).findByText(/could also fit elsewhere/)).toBeTruthy();
    expect(within(region).getByRole('button', { name: 'Resume from here' })).toBeTruthy();
  });

  it('says a chapter recorded to the end offers no resume point (fixes offering past the last word)', async () => {
    const base = createMockApi();
    const teleprompterLocate = vi.fn(async (chapterId: string, options?: object) => {
      const result = await base.teleprompterLocate(chapterId, options);
      if (result.status !== 'found' || !result.located) return result;
      return { ...result, located: { ...result.located, word: result.located.tokens } };
    });
    renderDialog({ teleprompterLocate });

    const region = await prompt();
    expect(await within(region).findByText('This chapter is recorded to the end. Play reads from the top.')).toBeTruthy();
    expect(within(region).queryByRole('button', { name: 'Resume from here' })).toBeNull();
    expect(within(region).queryByRole('button', { name: 'Start from the top' })).toBeNull();
    expect(within(region).getByRole('button', { name: 'Pick a word' })).toBeTruthy();
  });

  it('says so when the end of the recording does not match the chapter, and offers no resume word', async () => {
    renderDialog({}, { resume: 'not_found' });

    const region = await prompt();
    expect(await within(region).findByText(/did not match this chapter/)).toBeTruthy();
    expect(within(region).queryByRole('button', { name: 'Resume from here' })).toBeNull();
    expect(within(region).getByRole('button', { name: 'Pick a word' })).toBeTruthy();
  });

  it('links to the Tracks page instead of picking a track in place when the match is uncertain', async () => {
    renderDialog({}, { resume: 'ambiguous' });

    const region = await prompt();
    expect(await within(region).findByText(/More than one track/)).toBeTruthy();
    expect(within(region).queryByRole('button', { name: 'Resume from here' })).toBeNull();
    expect(within(region).queryByRole('combobox', { name: 'Track' })).toBeNull();
    expect(within(region).getByRole('link', { name: 'Link a track' }).getAttribute('href')).toBe('/tracks');
  });

  it('says reading starts from the top when no track matches the chapter, with a link to link one', async () => {
    renderDialog({}, { resume: 'none' });

    const region = await prompt();
    expect(await within(region).findByText(/No track in Alice.rpp matches this chapter/)).toBeTruthy();
    expect(within(region).getByRole('link', { name: 'Link a track' }).getAttribute('href')).toBe('/tracks');
  });

  it("shows a confirmed track's problem as one link instead of an inline warning", async () => {
    const base = createMockApi();
    const teleprompterLocate = vi.fn(async (chapterId: string, options?: object): Promise<TeleprompterLocateResult> => {
      const result = await base.teleprompterLocate(chapterId, options);
      if (result.status === 'asset_required') return result;
      return { ...result, match: { ...result.match, warnings: ['confirmed-track-renamed'] } };
    });
    renderDialog({ teleprompterLocate });

    const region = await prompt();
    expect(await within(region).findByText(/renamed since it was linked/)).toBeTruthy();
    expect(within(region).getByRole('link', { name: 'check the link' }).getAttribute('href')).toBe('/tracks');
  });

  it.each([
    ['no_recording', /has no recorded audio yet/],
    ['source_missing', /audio file is missing/],
    ['source_unsupported', /cannot be read/],
  ] as const)('explains a %s track and starts from the top', async (resume, text) => {
    renderDialog({}, { resume });

    const region = await prompt();
    expect(await within(region).findByText(text)).toBeTruthy();
    expect(within(region).getByText(/starts from the top/)).toBeTruthy();
    expect(within(region).queryByRole('button', { name: 'Resume from here' })).toBeNull();
  });

  it('asks before downloading the model it needs, and never downloads silently', async () => {
    const user = userEvent.setup();
    const whisperInstall = vi.fn();
    renderDialog({ whisperInstall }, { assets: 'missing' });

    const region = await prompt();
    expect(await within(region).findByText(/not downloaded yet/)).toBeTruthy();
    expect(screen.queryByRole('alertdialog')).toBeNull();

    await user.click(within(region).getByRole('button', { name: 'Download model…' }));

    expect(await screen.findByRole('alertdialog', { name: 'Download local Whisper model?' })).toBeTruthy();
    expect(whisperInstall).not.toHaveBeenCalled();
  });

  it('shows why the lookup failed, and tries again on request', async () => {
    const user = userEvent.setup();
    const { teleprompterLocate } = renderDialog({}, { resume: 'error' });

    const region = await prompt();
    expect(await within(region).findByText(/could not read/)).toBeTruthy();
    await user.click(within(region).getByRole('button', { name: 'Try again' }));

    await waitFor(() => expect(teleprompterLocate).toHaveBeenCalledTimes(2));
  });

  it('is gone the moment a session starts, and does not come back after it ends', async () => {
    const { setState } = renderDialog();
    await prompt();

    setState({ phase: 'running', message: 'Listening…', chapter: 'chapter-1' });
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Where you stopped' })).toBeNull());

    setState({ phase: 'idle', message: '', chapter: null });
    expect(screen.queryByRole('region', { name: 'Where you stopped' })).toBeNull();
  });
});
