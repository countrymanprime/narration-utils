// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BoothSession } from './BoothSession';
import { ApiProvider } from '../../api/ApiContext';
import { createMockApi } from '../../api/mockApi';
import { CommandRouter } from '../../input/router';
import { WIRE_TELEPROMPTER_DEVICES } from '../../api/mockFixtures';
import type { DawTransport, NarrationApi, TeleprompterLocateResult, TeleprompterResumeFollowEvent, TeleprompterState } from '../../types';

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
        <CommandRouter>
          <BoothSession source={{ kind: 'chapter', chapter: CHAPTER }} onExit={vi.fn()} />
        </CommandRouter>
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

async function openMicPopover(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: /^Microphone:/ }));
}

async function startReading(user: ReturnType<typeof userEvent.setup>) {
  await openMicPopover(user);
  await user.selectOptions(await screen.findByRole('combobox', { name: 'Microphone' }), DEVICE_NAME);
  await user.click(screen.getByRole('button', { name: 'Play' }));
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
      return { ...result, located: { ...result.located, word: result.located.tokens }, verdict: { ...result.verdict, kind: 'complete' as const, start: null } };
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

  describe('reconciliation (Phase 3)', () => {
    it('agree: presets Start to the DAW word without settling, and Start reading uses it with no click needed', async () => {
      const { api, teleprompterStart } = renderDialog({}, { resume: 'agree' });
      const located = await api.teleprompterLocate('chapter-1');
      if (located.status === 'asset_required' || located.verdict.kind !== 'agree' || located.verdict.start === null) throw new Error('the mock must agree');

      const region = await prompt();
      expect(await within(region).findByText(/REAPER and your last reading agree/)).toBeTruthy();
      expect(within(region).getByRole('button', { name: 'Change' })).toBeTruthy();
      expect(within(region).getByRole('button', { name: 'Start from the top' })).toBeTruthy();

      await startReading(userEvent.setup());
      expect(teleprompterStart).toHaveBeenCalledWith(expect.objectContaining({ startWord: located.verdict.start }));
      // The preset alone is not a choice, so the notice stays up until the session actually starts.
      expect(await screen.findByRole('region', { name: 'Where you stopped' })).toBeTruthy();
    });

    it('agree: Start from the top clears the preset and settles the notice', async () => {
      const user = userEvent.setup();
      const { teleprompterStart } = renderDialog({}, { resume: 'agree' });

      const region = await prompt();
      await user.click(await within(region).findByRole('button', { name: 'Start from the top' }));
      expect(screen.queryByRole('region', { name: 'Where you stopped' })).toBeNull();

      await startReading(user);
      expect(teleprompterStart).toHaveBeenCalledWith(expect.not.objectContaining({ startWord: expect.anything() }));
    });

    it('agree: Change reveals the same two-way choice as disagree', async () => {
      const user = userEvent.setup();
      renderDialog({}, { resume: 'agree' });

      const region = await prompt();
      await user.click(await within(region).findByRole('button', { name: 'Change' }));
      expect(within(region).getByRole('button', { name: /REAPER/ })).toBeTruthy();
      expect(within(region).getByRole('button', { name: /Last reading/ })).toBeTruthy();
      expect(within(region).queryByRole('button', { name: 'Change' })).toBeNull();
    });

    it('disagree: offers both places, and picking one resumes there', async () => {
      const { api, teleprompterStart } = renderDialog({}, { resume: 'disagree' });
      const located = await api.teleprompterLocate('chapter-1');
      if (located.status === 'asset_required' || located.verdict.kind !== 'disagree' || !located.verdict.prompter) throw new Error('the mock must disagree');

      const region = await prompt();
      expect(await within(region).findByText(/different places/)).toBeTruthy();
      expect(within(region).getByRole('button', { name: 'Start from the top' })).toBeTruthy();
      expect(within(region).getByRole('button', { name: 'Pick a word' })).toBeTruthy();

      await userEvent.setup().click(within(region).getByRole('button', { name: /Last reading/ }));
      expect(screen.queryByRole('region', { name: 'Where you stopped' })).toBeNull();
      await startReading(userEvent.setup());
      expect(teleprompterStart).toHaveBeenCalledWith(expect.objectContaining({ startWord: located.verdict.prompter.word }));
    });

    it('prompter_only: offers the last reading alone, in the compact one-line form', async () => {
      const { api, teleprompterStart } = renderDialog({}, { resume: 'prompter_only' });
      const located = await api.teleprompterLocate('chapter-1');
      if (located.status === 'asset_required' || located.verdict.kind !== 'prompter_only' || !located.verdict.prompter)
        throw new Error('the mock must offer the prompter alone');

      const region = await prompt();
      expect(await within(region).findByText(/Your last reading stopped at/)).toBeTruthy();
      expect(within(region).getByRole('button', { name: 'Continue there' })).toBeTruthy();
      expect(within(region).getByRole('button', { name: 'Start from the top' })).toBeTruthy();

      await userEvent.setup().click(within(region).getByRole('button', { name: 'Continue there' }));
      await startReading(userEvent.setup());
      expect(teleprompterStart).toHaveBeenCalledWith(expect.objectContaining({ startWord: located.verdict.prompter.word }));
    });
  });

  describe('live DAW state (Phase 4)', () => {
    // A found answer read from REAPER's live state rather than the saved project (ADR 0349).
    const readLive = (at: 'cursor' | 'end'): Partial<NarrationApi> => {
      const base = createMockApi();
      return {
        teleprompterLocate: async (chapterId, options) => {
          const result = await base.teleprompterLocate(chapterId, options);
          if (result.status === 'asset_required') return result;
          return {
            ...result,
            dawSource: 'live',
            dawAt: at,
            verdict: { ...result.verdict, daw: result.verdict.daw && { ...result.verdict.daw, source: 'live' } },
          };
        },
      };
    };

    it('labels a place read from REAPER "in REAPER now", never "as of the last save"', async () => {
      renderDialog({}, { resume: 'disagree_live' });

      const region = await prompt();
      const reaper = await within(region).findByRole('button', { name: /REAPER/ });
      expect(within(reaper).getByText(/in REAPER now/)).toBeTruthy();
      expect(within(region).queryByText(/last save/)).toBeNull();
    });

    it("says the resume point is REAPER's edit cursor when the cursor sits on the recording", async () => {
      renderDialog(readLive('cursor'));

      const region = await prompt();
      expect(await within(region).findByText(/Chapter 1 track · in REAPER now/)).toBeTruthy();
      expect(within(region).getByText(/Continuing at REAPER's edit cursor/)).toBeTruthy();
      expect(within(region).queryByText(/last save/)).toBeNull();
    });

    it('says the resume point is where the recording ends in REAPER when the cursor is parked elsewhere', async () => {
      renderDialog(readLive('end'));

      const region = await prompt();
      expect(await within(region).findByText(/Chapter 1 track · in REAPER now/)).toBeTruthy();
      expect(within(region).getByText(/Continuing where your recording ends/)).toBeTruthy();
    });

    it('offers nothing while REAPER records the chapter, and says reading starts from the top', async () => {
      const { teleprompterStart } = renderDialog({}, { resume: 'recording' });

      const region = await prompt();
      expect(await within(region).findByText(/REAPER is recording on this track now/)).toBeTruthy();
      expect(within(region).queryByRole('button', { name: /Resume|Continue/ })).toBeNull();
      expect(teleprompterStart).not.toHaveBeenCalled();
    });
  });

  describe('following REAPER while shown (Phase 5)', () => {
    // A host that follows: records follow and unfollow calls, and lets a test push the transport and follow events.
    function followingHost() {
      const transport = new Set<(state: DawTransport) => void>();
      const follow = new Set<(event: TeleprompterResumeFollowEvent) => void>();
      const overrides: Partial<NarrationApi> = {
        subscribeDawTransport: (listener) => {
          transport.add(listener);
          return () => transport.delete(listener);
        },
        subscribeTeleprompterResumeFollow: (listener) => {
          follow.add(listener);
          return () => follow.delete(listener);
        },
        teleprompterResumeFollow: vi.fn(async () => ({ following: true })),
        teleprompterResumeUnfollow: vi.fn(async () => ({ following: false })),
      };
      return {
        overrides,
        pushTransport: (state: DawTransport) => act(() => transport.forEach((listener) => listener(state))),
        pushFollow: (event: TeleprompterResumeFollowEvent) => act(() => follow.forEach((listener) => listener(event))),
        listening: () => follow.size,
      };
    }

    it.each([
      ['plays', { playing: true, recording: false, position: 12 }],
      ['records', { playing: true, recording: true, position: 12 }],
    ])('goes away when REAPER %s, and presets nothing', async (_, transport) => {
      const host = followingHost();
      const { teleprompterStart } = renderDialog(host.overrides);
      await within(await prompt()).findByRole('button', { name: 'Resume from here' });

      host.pushTransport(transport);

      expect(screen.queryByRole('region', { name: 'Where you stopped' })).toBeNull();
      await startReading(userEvent.setup());
      expect(teleprompterStart).toHaveBeenCalledWith(expect.not.objectContaining({ startWord: expect.anything() }));
    });

    it('stays while REAPER reports it stopped', async () => {
      const host = followingHost();
      renderDialog(host.overrides);
      await within(await prompt()).findByRole('button', { name: 'Resume from here' });
      host.pushTransport({ playing: false, recording: false });
      expect(screen.getByRole('region', { name: 'Where you stopped' })).toBeTruthy();
    });

    it.each(['playing', 'recording'] as const)('goes away when the host follow says REAPER is %s', async (reason) => {
      const host = followingHost();
      renderDialog(host.overrides);
      await within(await prompt()).findByRole('button', { name: 'Resume from here' });
      await waitFor(() => expect(host.listening()).toBe(1));

      host.pushFollow({ chapterId: 'chapter-1', reason });

      expect(screen.queryByRole('region', { name: 'Where you stopped' })).toBeNull();
    });

    it('ignores a follow event for another chapter', async () => {
      const host = followingHost();
      renderDialog(host.overrides);
      await within(await prompt()).findByRole('button', { name: 'Resume from here' });
      await waitFor(() => expect(host.listening()).toBe(1));
      host.pushFollow({ chapterId: 'chapter-2', reason: 'playing' });
      expect(screen.getByRole('region', { name: 'Where you stopped' })).toBeTruthy();
    });

    it('follows the track the lookup read once it answers, and stops following on a choice', async () => {
      const user = userEvent.setup();
      const host = followingHost();
      const { api } = renderDialog(host.overrides);
      const located = await api.teleprompterLocate('chapter-1');
      if (located.status === 'asset_required' || !located.track) throw new Error('the mock chapter must have a track');

      const region = await prompt();
      await within(region).findByRole('button', { name: 'Resume from here' });
      await waitFor(() => expect(api.teleprompterResumeFollow).toHaveBeenCalledWith('chapter-1', located.track?.guid));

      await user.click(within(region).getByRole('button', { name: 'Start from the top' }));
      await waitFor(() => expect(api.teleprompterResumeUnfollow).toHaveBeenCalled());
      expect(host.listening()).toBe(0);
    });

    it('stops following when a session starts, and does not follow again after it ends', async () => {
      const host = followingHost();
      const { api, setState } = renderDialog(host.overrides);
      await within(await prompt()).findByRole('button', { name: 'Resume from here' });
      await waitFor(() => expect(api.teleprompterResumeFollow).toHaveBeenCalledTimes(1));

      setState({ phase: 'running' });
      await waitFor(() => expect(api.teleprompterResumeUnfollow).toHaveBeenCalled());
      setState({ phase: 'idle' });
      expect(api.teleprompterResumeFollow).toHaveBeenCalledTimes(1);
    });

    it('does not follow a chapter with no track', async () => {
      const host = followingHost();
      const { api } = renderDialog(host.overrides, { resume: 'none' });
      await within(await prompt()).findByText(/No track in/);
      expect(api.teleprompterResumeFollow).not.toHaveBeenCalled();
    });

    it("looks again when REAPER's edit cursor settles on the recording", async () => {
      const host = followingHost();
      const { teleprompterLocate } = renderDialog(host.overrides);
      await within(await prompt()).findByRole('button', { name: 'Resume from here' });
      await waitFor(() => expect(host.listening()).toBe(1));
      expect(teleprompterLocate).toHaveBeenCalledTimes(1);

      host.pushFollow({ chapterId: 'chapter-1', reason: 'cursor_moved', editCursor: 4.5 });

      await waitFor(() => expect(teleprompterLocate).toHaveBeenCalledTimes(2));
      expect(await within(await prompt()).findByRole('button', { name: 'Resume from here' })).toBeTruthy();
    });

    it('unfollows when the dialog closes', async () => {
      const host = followingHost();
      const { api } = renderDialog(host.overrides);
      await within(await prompt()).findByRole('button', { name: 'Resume from here' });
      await waitFor(() => expect(api.teleprompterResumeFollow).toHaveBeenCalled());
      cleanup();
      expect(api.teleprompterResumeUnfollow).toHaveBeenCalled();
    });
  });
});
