// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiProvider } from '../../api/ApiContext';
import { createMockApi } from '../../api/mockApi';
import { CommandRouter, CommandScope } from '../../input/router';
import { ReadingControlBar } from './ReadingControlBar';
import { initialSession } from './readerModel';
import type { FollowCursor } from './useFollowCursor';
import type { TeleprompterSession } from './useTeleprompterSession';
import type { NarrationApi, ReadAloudReaperState } from '../../types';

afterEach(cleanup);

const DEVICES = [{ name: 'Shure MV7' }, { name: 'Headset Microphone' }];

function baseSession(overrides: Partial<TeleprompterSession> = {}): TeleprompterSession {
  return {
    host: { phase: 'idle', message: '', engine: null, chapter: null, script: null, position: null },
    paused: false,
    pause: vi.fn(),
    session: initialSession,
    device: '',
    devices: DEVICES,
    devicesError: null,
    devicesLoading: false,
    loadDevices: vi.fn(),
    model: 'tiny',
    changeModel: vi.fn(),
    engine: 'whisper',
    engines: [{ value: 'whisper', label: 'Whisper', title: 'OpenAI Whisper, run on this computer - the default' }],
    changeEngine: vi.fn(),
    paragraphs: undefined,
    rows: [],
    cursor: 0,
    active: false,
    status: '',
    error: '',
    prompt: undefined,
    // Only the fields the bar reads matter here; the install hook itself is never exercised.
    modelInstall: {} as TeleprompterSession['modelInstall'],
    start: vi.fn(),
    stop: vi.fn(),
    seek: vi.fn(),
    changeDevice: vi.fn(),
    closeModelPrompt: vi.fn(),
    startWord: null,
    setStartWord: vi.fn(),
    reset: vi.fn(),
    canStart: false,
    startReason: 'Choose a microphone first.',
    ...overrides,
  };
}

function followCursor(overrides: Partial<FollowCursor> = {}): FollowCursor {
  return { following: true, resume: vi.fn(), readerRef: { current: null }, ...overrides };
}

function renderBar(
  session: TeleprompterSession,
  follow: FollowCursor,
  options: { startPoint?: { label: string; onClear: () => void }; chapterId?: string; apiOverrides?: Partial<NarrationApi> } = {},
) {
  const api = createMockApi(options.apiOverrides ?? {});
  return render(
    <MemoryRouter>
      <ApiProvider api={api}>
        {/* The booth scope Phase 4 wraps the read-aloud dialog and the Teleprompter page in, so `reading.toggle` (Space)
            resolves here the same as it does mounted there. */}
        <CommandRouter>
          <CommandScope kind="booth">
            <ReadingControlBar session={session} follow={follow} startPoint={options.startPoint} chapterId={options.chapterId} />
          </CommandScope>
        </CommandRouter>
      </ApiProvider>
    </MemoryRouter>,
  );
}

function rerenderBar(
  rerender: (ui: ReactElement) => void,
  session: TeleprompterSession,
  follow: FollowCursor,
  options: { startPoint?: { label: string; onClear: () => void }; chapterId?: string; apiOverrides?: Partial<NarrationApi> } = {},
) {
  const api = createMockApi(options.apiOverrides ?? {});
  rerender(
    <MemoryRouter>
      <ApiProvider api={api}>
        <CommandRouter>
          <CommandScope kind="booth">
            <ReadingControlBar session={session} follow={follow} startPoint={options.startPoint} chapterId={options.chapterId} />
          </CommandScope>
        </CommandRouter>
      </ApiProvider>
    </MemoryRouter>,
  );
}

const reaperState = (overrides: Partial<ReadAloudReaperState> = {}): ReadAloudReaperState => ({
  status: 'ready',
  message: 'The track for "Chapter 3" is armed and ready.',
  trackGuid: '{1}',
  armedCount: 1,
  playing: false,
  recording: false,
  ...overrides,
});

describe('ReadingControlBar', () => {
  it('is a named toolbar with Play enabled once a microphone is chosen and Stop reading disabled while idle', () => {
    const session = baseSession({ device: 'Shure MV7', canStart: true, startReason: 'Play' });
    renderBar(session, followCursor());

    const toolbar = screen.getByRole('toolbar', { name: 'Reading controls' });
    expect(within(toolbar).getByRole('button', { name: 'Play' }).hasAttribute('disabled')).toBe(false);
    expect(within(toolbar).getByRole('button', { name: 'Stop reading' }).hasAttribute('disabled')).toBe(true);
    expect(within(toolbar).getByRole('status').textContent).toBe('Ready');
  });

  it('shows Pause (pressed) once a session is listening, and Play (not pressed) once it is paused', () => {
    const { rerender } = renderBar(baseSession({ active: true, paused: false, status: 'Listening', canStart: true }), followCursor());
    let toggle = screen.getByRole('button', { name: 'Pause' });
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(toggle.hasAttribute('disabled')).toBe(false);
    expect(screen.getByRole('button', { name: 'Stop reading' }).hasAttribute('disabled')).toBe(false);

    rerenderBar(rerender, baseSession({ active: true, paused: true, status: 'Paused', canStart: true }), followCursor());
    toggle = screen.getByRole('button', { name: 'Play' });
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(toggle.hasAttribute('disabled')).toBe(false);
    // Stopping a paused session is still possible - a pause is a take boundary, not a reason to lose Stop.
    expect(screen.getByRole('button', { name: 'Stop reading' }).hasAttribute('disabled')).toBe(false);
  });

  it('disables the Play/Pause toggle while starting or stopping', () => {
    const { rerender } = renderBar(
      baseSession({ host: { phase: 'starting', message: '', engine: null, chapter: null, script: null, position: null } }),
      followCursor(),
    );
    expect(screen.getByRole('button', { name: 'Play' }).hasAttribute('disabled')).toBe(true);

    rerenderBar(
      rerender,
      baseSession({ active: true, host: { phase: 'stopping', message: '', engine: null, chapter: null, script: null, position: null } }),
      followCursor(),
    );
    expect(screen.getByRole('button', { name: 'Pause' }).hasAttribute('disabled')).toBe(true);
  });

  it('clicking Play starts the session, and clicking Stop reading stops it', async () => {
    const user = userEvent.setup();
    const start = vi.fn();
    const stop = vi.fn();
    const session = baseSession({ device: 'Shure MV7', canStart: true, active: false, start, stop });
    const { rerender } = renderBar(session, followCursor());
    await user.click(screen.getByRole('button', { name: 'Play' }));
    expect(start).toHaveBeenCalled();

    rerenderBar(rerender, baseSession({ device: 'Shure MV7', active: true, start, stop }), followCursor());
    await user.click(screen.getByRole('button', { name: 'Stop reading' }));
    expect(stop).toHaveBeenCalled();
  });

  it('clicking Pause pauses a listening session, and clicking it again (now Play) resumes it', async () => {
    const user = userEvent.setup();
    const pause = vi.fn();
    const { rerender } = renderBar(baseSession({ active: true, paused: false, pause }), followCursor());
    await user.click(screen.getByRole('button', { name: 'Pause' }));
    expect(pause).toHaveBeenCalledWith(true);

    rerenderBar(rerender, baseSession({ active: true, paused: true, pause }), followCursor());
    await user.click(screen.getByRole('button', { name: 'Play' }));
    expect(pause).toHaveBeenCalledWith(false);
  });

  it('shows Follow, disabled while following and enabled once it is paused, only during a session', () => {
    const { rerender } = renderBar(baseSession({ active: false }), followCursor());
    expect(screen.queryByRole('button', { name: 'Follow' })).toBeNull();

    rerenderBar(rerender, baseSession({ active: true }), followCursor({ following: true }));
    expect(screen.getByRole('button', { name: 'Follow' }).hasAttribute('disabled')).toBe(true);

    rerenderBar(rerender, baseSession({ active: true }), followCursor({ following: false }));
    expect(screen.getByRole('button', { name: 'Follow' }).hasAttribute('disabled')).toBe(false);
  });

  it('shows the start-point chip while idle, and clearing it calls onClear', async () => {
    const user = userEvent.setup();
    const onClear = vi.fn();
    renderBar(baseSession({ startWord: 12 }), followCursor(), { startPoint: { label: '…could not even get her head', onClear } });

    expect(screen.getByText(/could not even get her head/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Clear start point' }));
    expect(onClear).toHaveBeenCalled();
  });

  it('hides the start-point chip once a session is active', () => {
    renderBar(baseSession({ active: true, startWord: 12 }), followCursor(), { startPoint: { label: '…could not even get her head', onClear: vi.fn() } });
    expect(screen.queryByText(/could not even get her head/)).toBeNull();
  });

  it('opens the microphone popover with the device list, Refresh and a level meter running the meter-only mode', async () => {
    const user = userEvent.setup();
    renderBar(baseSession({ device: 'Shure MV7' }), followCursor());

    await user.click(screen.getByRole('button', { name: 'Microphone: Shure MV7' }));

    const popup = await screen.findByRole('dialog', { name: 'Microphone' });
    expect(within(popup).getByRole('combobox', { name: 'Microphone' })).toBeTruthy();
    expect(within(popup).getByRole('button', { name: 'Refresh' })).toBeTruthy();
    // The mock's meter-only mode sends one level as soon as it starts (teleprompterMock.ts), so the popover's meter
    // never sits silent while it is open and a device is chosen.
    const meter = within(popup).getByRole('meter', { name: 'Input level' });
    await waitFor(() => expect(meter.getAttribute('aria-valuetext')).toBe('-24 dBFS'));
  });

  it("draws the level meter decoratively (aria-hidden) inside the bar's own microphone button", async () => {
    renderBar(baseSession({ device: 'Shure MV7' }), followCursor());
    const trigger = screen.getByRole('button', { name: 'Microphone: Shure MV7' });
    expect(within(trigger).queryByRole('meter')).toBeNull();
  });

  it('names the microphone trigger "not chosen" until a device is picked', () => {
    renderBar(baseSession({ device: '' }), followCursor());
    expect(screen.getByRole('button', { name: 'Microphone: not chosen' })).toBeTruthy();
  });

  it('opens the settings popover with Engine (when offered) and Model, and a link to Settings', async () => {
    const user = userEvent.setup();
    const engines = [
      { value: 'whisper' as const, label: 'Whisper', title: 'OpenAI Whisper' },
      { value: 'moonshine' as const, label: 'Moonshine', title: 'Moonshine' },
    ];
    renderBar(baseSession({ engines }), followCursor());

    await user.click(screen.getByRole('button', { name: 'Settings' }));

    const popup = await screen.findByRole('dialog', { name: 'Settings' });
    expect(within(popup).getByRole('group', { name: 'Engine' })).toBeTruthy();
    expect(within(popup).getByRole('group', { name: 'Model' })).toBeTruthy();
    expect(within(popup).getByRole('link', { name: 'More in Settings' }).getAttribute('href')).toBe('/settings#teleprompter');
  });

  it('omits the Engine group where the host offers only one engine', async () => {
    const user = userEvent.setup();
    renderBar(baseSession(), followCursor());

    await user.click(screen.getByRole('button', { name: 'Settings' }));

    const popup = await screen.findByRole('dialog', { name: 'Settings' });
    expect(within(popup).queryByRole('group', { name: 'Engine' })).toBeNull();
    expect(within(popup).getByRole('group', { name: 'Model' })).toBeTruthy();
  });

  it('locks Engine and Model while a session is active', async () => {
    const user = userEvent.setup();
    const engines = [
      { value: 'whisper' as const, label: 'Whisper', title: 'OpenAI Whisper' },
      { value: 'moonshine' as const, label: 'Moonshine', title: 'Moonshine' },
    ];
    renderBar(baseSession({ engines, active: true }), followCursor());

    await user.click(screen.getByRole('button', { name: 'Settings' }));

    const popup = await screen.findByRole('dialog', { name: 'Settings' });
    expect(within(popup).getByRole('button', { name: 'Moonshine' }).hasAttribute('disabled')).toBe(true);
    expect(within(popup).getByRole('button', { name: 'Small' }).hasAttribute('disabled')).toBe(true);
  });

  describe('REAPER state (Phase 6, read-only)', () => {
    it('omits the REAPER indicator without a chapter id (credits mode, the standalone page)', () => {
      renderBar(baseSession(), followCursor());
      expect(screen.queryByRole('button', { name: /Record in REAPER/ })).toBeNull();
    });

    it("shows the chapter's armed state once asked, always disabled - Phase 7's toggle is not built", async () => {
      const readAloudReaperState = vi.fn(async () => reaperState({ status: 'ready' }));
      renderBar(baseSession(), followCursor(), { chapterId: 'chapter-3', apiOverrides: { readAloudReaperState } });

      const button = await screen.findByRole('button', { name: 'Record in REAPER: Chapter armed' });
      expect(button.hasAttribute('disabled')).toBe(true);
      expect(readAloudReaperState).toHaveBeenCalledWith('chapter-3');
    });

    it('marks a recording elsewhere in a distinct colour and Refresh asks again', async () => {
      const user = userEvent.setup();
      const readAloudReaperState = vi.fn(async () => reaperState({ status: 'recording_elsewhere', recording: true, playing: true }));
      renderBar(baseSession(), followCursor(), { chapterId: 'chapter-3', apiOverrides: { readAloudReaperState } });

      await screen.findByRole('button', { name: 'Record in REAPER: Recording' });
      expect(readAloudReaperState).toHaveBeenCalledTimes(1);

      await user.click(screen.getByRole('button', { name: 'Refresh REAPER state' }));
      await waitFor(() => expect(readAloudReaperState).toHaveBeenCalledTimes(2));
    });
  });

  describe('Space shortcut (Q10)', () => {
    it('toggles Play when focus is not in a field, button or other widget', async () => {
      const user = userEvent.setup();
      const start = vi.fn();
      renderBar(baseSession({ device: 'Shure MV7', canStart: true, start }), followCursor());
      document.body.focus();

      await user.keyboard(' ');

      expect(start).toHaveBeenCalled();
    });

    it('pauses a listening session on Space (not Stop, Q3/Q10)', async () => {
      const user = userEvent.setup();
      const pause = vi.fn();
      renderBar(baseSession({ active: true, paused: false, pause }), followCursor());
      document.body.focus();

      await user.keyboard(' ');

      expect(pause).toHaveBeenCalledWith(true);
    });

    it('leaves Space alone on a button, so it activates the button instead of the reading toggle', async () => {
      const user = userEvent.setup();
      const start = vi.fn();
      renderBar(baseSession({ device: 'Shure MV7', canStart: true, start }), followCursor());

      screen.getByRole('button', { name: 'Settings' }).focus();
      await user.keyboard(' ');

      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Settings' })).toBeTruthy());
      expect(start).not.toHaveBeenCalled();
    });
  });
});
