// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReadingControlBar } from './ReadingControlBar';
import { initialSession } from './readerModel';
import type { FollowCursor } from './useFollowCursor';
import type { TeleprompterSession } from './useTeleprompterSession';

afterEach(cleanup);

const DEVICES = [{ name: 'Shure MV7' }, { name: 'Headset Microphone' }];

function baseSession(overrides: Partial<TeleprompterSession> = {}): TeleprompterSession {
  return {
    host: { phase: 'idle', message: '', engine: null, chapter: null, script: null, position: null },
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

function renderBar(session: TeleprompterSession, follow: FollowCursor, startPoint?: { label: string; onClear: () => void }) {
  return render(
    <MemoryRouter>
      <ReadingControlBar session={session} follow={follow} startPoint={startPoint} />
    </MemoryRouter>,
  );
}

describe('ReadingControlBar', () => {
  it('is a named toolbar with Play enabled once a microphone is chosen and Stop reading disabled while idle', () => {
    const session = baseSession({ device: 'Shure MV7', canStart: true, startReason: 'Play' });
    renderBar(session, followCursor());

    const toolbar = screen.getByRole('toolbar', { name: 'Reading controls' });
    expect(within(toolbar).getByRole('button', { name: 'Play' }).hasAttribute('disabled')).toBe(false);
    expect(within(toolbar).getByRole('button', { name: 'Stop reading' }).hasAttribute('disabled')).toBe(true);
    expect(within(toolbar).getByRole('status').textContent).toBe('Ready');
  });

  it('disables Play and enables Stop reading while a session is active', () => {
    const session = baseSession({ active: true, status: 'Listening', canStart: true });
    renderBar(session, followCursor());

    expect(screen.getByRole('button', { name: 'Play' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: 'Stop reading' }).hasAttribute('disabled')).toBe(false);
  });

  it('clicking Play starts the session, and clicking Stop reading stops it', async () => {
    const user = userEvent.setup();
    const start = vi.fn();
    const stop = vi.fn();
    const session = baseSession({ device: 'Shure MV7', canStart: true, active: false, start, stop });
    const { rerender } = renderBar(session, followCursor());
    await user.click(screen.getByRole('button', { name: 'Play' }));
    expect(start).toHaveBeenCalled();

    rerender(
      <MemoryRouter>
        <ReadingControlBar session={baseSession({ device: 'Shure MV7', active: true, start, stop })} follow={followCursor()} />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole('button', { name: 'Stop reading' }));
    expect(stop).toHaveBeenCalled();
  });

  it('shows Follow, disabled while following and enabled once it is paused, only during a session', () => {
    const { rerender } = renderBar(baseSession({ active: false }), followCursor());
    expect(screen.queryByRole('button', { name: 'Follow' })).toBeNull();

    rerender(
      <MemoryRouter>
        <ReadingControlBar session={baseSession({ active: true })} follow={followCursor({ following: true })} />
      </MemoryRouter>,
    );
    expect(screen.getByRole('button', { name: 'Follow' }).hasAttribute('disabled')).toBe(true);

    rerender(
      <MemoryRouter>
        <ReadingControlBar session={baseSession({ active: true })} follow={followCursor({ following: false })} />
      </MemoryRouter>,
    );
    expect(screen.getByRole('button', { name: 'Follow' }).hasAttribute('disabled')).toBe(false);
  });

  it('shows the start-point chip while idle, and clearing it calls onClear', async () => {
    const user = userEvent.setup();
    const onClear = vi.fn();
    renderBar(baseSession({ startWord: 12 }), followCursor(), { label: '…could not even get her head', onClear });

    expect(screen.getByText(/could not even get her head/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Clear start point' }));
    expect(onClear).toHaveBeenCalled();
  });

  it('hides the start-point chip once a session is active', () => {
    renderBar(baseSession({ active: true, startWord: 12 }), followCursor(), { label: '…could not even get her head', onClear: vi.fn() });
    expect(screen.queryByText(/could not even get her head/)).toBeNull();
  });

  it('opens the microphone popover with the device list and Refresh, no level meter', async () => {
    const user = userEvent.setup();
    renderBar(baseSession({ device: 'Shure MV7' }), followCursor());

    await user.click(screen.getByRole('button', { name: 'Microphone: Shure MV7' }));

    const popup = await screen.findByRole('dialog', { name: 'Microphone' });
    expect(within(popup).getByRole('combobox', { name: 'Microphone' })).toBeTruthy();
    expect(within(popup).getByRole('button', { name: 'Refresh' })).toBeTruthy();
    expect(within(popup).queryByRole('meter')).toBeNull();
  });

  it('names the microphone trigger "not chosen" until a device is picked', () => {
    renderBar(baseSession({ device: '' }), followCursor());
    expect(screen.getByRole('button', { name: 'Microphone: not chosen' })).toBeTruthy();
  });

  it('opens the settings popover with Engine (when offered) and Model, and a link to Settings', async () => {
    const user = userEvent.setup();
    const engines = [
      { value: 'whisper', label: 'Whisper', title: 'OpenAI Whisper' },
      { value: 'moonshine', label: 'Moonshine', title: 'Moonshine' },
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
      { value: 'whisper', label: 'Whisper', title: 'OpenAI Whisper' },
      { value: 'moonshine', label: 'Moonshine', title: 'Moonshine' },
    ];
    renderBar(baseSession({ engines, active: true }), followCursor());

    await user.click(screen.getByRole('button', { name: 'Settings' }));

    const popup = await screen.findByRole('dialog', { name: 'Settings' });
    expect(within(popup).getByRole('button', { name: 'Moonshine' }).hasAttribute('disabled')).toBe(true);
    expect(within(popup).getByRole('button', { name: 'Small' }).hasAttribute('disabled')).toBe(true);
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

    it('stops an active session on Space', async () => {
      const user = userEvent.setup();
      const stop = vi.fn();
      renderBar(baseSession({ active: true, stop }), followCursor());
      document.body.focus();

      await user.keyboard(' ');

      expect(stop).toHaveBeenCalled();
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
