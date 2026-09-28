// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiProvider } from '../../api/ApiContext';
import { createMockApi } from '../../api/mockApi';
import type { NarrationApi } from '../../types';
import type { DawTransport } from '../../api/contracts/daw';
import { CommandRouter, CommandScope } from '../../input/router';
import { CompanionShell } from './CompanionShell';
import { initialSession } from './readerModel';
import type { FollowCursor } from './useFollowCursor';
import type { RecordInReaperState } from './useRecordInReaper';
import type { TeleprompterSession } from './useTeleprompterSession';
import { WIRE_PICKUPS_NEXT_SUCCESS } from '../../api/mockFixtures';

afterEach(cleanup);

function baseSession(overrides: Partial<TeleprompterSession> = {}): TeleprompterSession {
  return {
    host: { phase: 'idle', message: '', engine: null, chapter: null, script: null, position: null },
    paused: false,
    pause: vi.fn(),
    session: initialSession,
    device: 'USB mic',
    devices: [],
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
    modelInstall: {} as TeleprompterSession['modelInstall'],
    start: vi.fn(),
    stop: vi.fn(),
    seek: vi.fn(),
    changeDevice: vi.fn(),
    closeModelPrompt: vi.fn(),
    startWord: null,
    setStartWord: vi.fn(),
    reset: vi.fn(),
    canStart: true,
    startReason: '',
    ...overrides,
  };
}

function followCursor(): FollowCursor {
  return { following: true, resume: vi.fn(), readerRef: { current: null } };
}

function fakeRecording(overrides: Partial<RecordInReaperState> = {}): RecordInReaperState {
  return {
    loaded: true,
    enabled: false,
    recording: false,
    armPending: false,
    confirmPending: false,
    toggle: vi.fn(),
    confirm: vi.fn(),
    cancelConfirm: vi.fn(),
    armOnly: vi.fn(async () => {}),
    beforeStart: vi.fn(async () => true),
    afterStop: vi.fn(),
    ...overrides,
  };
}

function renderCompanion(overrides: Partial<Parameters<typeof CompanionShell>[0]> = {}, api: Partial<NarrationApi> = {}) {
  let pushTransport: (state: DawTransport) => void = () => {};
  const mock = createMockApi({
    companionModeEnter: vi.fn(async () => {}),
    companionModeExit: vi.fn(async () => {}),
    subscribeDawTransport: (onUpdate) => {
      pushTransport = onUpdate;
      return () => {};
    },
    ...api,
  });
  const onFullApp = vi.fn();
  const view = render(
    <MemoryRouter>
      <ApiProvider api={mock}>
        <CommandRouter>
          <CommandScope kind="booth">
            <CompanionShell
              session={baseSession()}
              follow={followCursor()}
              recording={fakeRecording()}
              chapterTitle="Chapter 5 — Advice from a Caterpillar"
              onFullApp={onFullApp}
              {...overrides}
            />
          </CommandScope>
        </CommandRouter>
      </ApiProvider>
    </MemoryRouter>,
  );
  return { ...view, api: mock, onFullApp, pushTransport: (state: DawTransport) => act(() => pushTransport(state)) };
}

describe('CompanionShell (booth-mode-and-companion-panel.prd.md Phase 7)', () => {
  it('lays out CompactShell: the Companion heading, Full app, and the script, note, pickups, hotkeys and this-chapter sections in order', () => {
    renderCompanion();
    expect(screen.getByRole('heading', { level: 1, name: 'Companion' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Full app' })).toBeTruthy();
    const main = screen.getByRole('main');
    const sections = within(main)
      .getAllByRole('region')
      .map((region) => document.getElementById(region.getAttribute('aria-labelledby') ?? '')?.textContent);
    expect(sections).toEqual(['Script', 'Note at playhead', 'Pickups', 'Hotkeys', 'This chapter']);
    expect(within(main).getByText('Chapter 5 — Advice from a Caterpillar')).toBeTruthy();
  });

  it("narrows and pins the one window on mount and puts it back on unmount (ADR 0401's bindings)", async () => {
    const { api, unmount } = renderCompanion();
    await waitFor(() => expect(api.companionModeEnter).toHaveBeenCalledTimes(1));
    expect(api.companionModeExit).not.toHaveBeenCalled();
    unmount();
    expect(api.companionModeExit).toHaveBeenCalledTimes(1);
  });

  it('says so, and stays usable, when the window could not be narrowed and pinned', async () => {
    renderCompanion({}, { companionModeEnter: vi.fn(async () => Promise.reject(new Error('The app is still starting.'))) });
    expect((await screen.findByRole('alert')).textContent).toContain("Couldn't pin the window beside your DAW: The app is still starting.");
    expect(screen.getByRole('button', { name: 'Full app' })).toBeTruthy();
  });

  it('Full app hands back to the full app', async () => {
    const user = userEvent.setup();
    const { onFullApp } = renderCompanion();
    await user.click(screen.getByRole('button', { name: 'Full app' }));
    expect(onFullApp).toHaveBeenCalledTimes(1);
  });

  it('Escape once asks, Escape again returns to the full app (Open Question 5)', async () => {
    const user = userEvent.setup();
    const { onFullApp } = renderCompanion();
    await user.keyboard('{Escape}');
    expect(onFullApp).not.toHaveBeenCalled();
    expect(screen.getByText('Press Esc again to return to the full app.').closest('[role="status"]')).toBeTruthy();
    await user.keyboard('{Escape}');
    expect(onFullApp).toHaveBeenCalledTimes(1);
  });

  it("reports REAPER's playhead from the live transport: stopped, playing with its time, and recording", () => {
    const { pushTransport } = renderCompanion();
    const header = screen.getByRole('banner');
    expect(within(header).getByText('Playhead stopped')).toBeTruthy();
    pushTransport({ playing: true, recording: false, position: 134.6 });
    expect(within(header).getByText('Playhead 2:14.6')).toBeTruthy();
    pushTransport({ playing: true, recording: true, position: 200.04 });
    expect(within(header).getByText('Recording · 3:20.0')).toBeTruthy();
    pushTransport({ playing: false, recording: false });
    expect(within(header).getByText('Playhead stopped')).toBeTruthy();
  });

  it('reserves the note-at-playhead section with an honest "Coming soon", not an empty gap or a made-up note', () => {
    renderCompanion();
    const section = screen.getByRole('region', { name: 'Note at playhead' });
    expect(within(section).getByText('Coming soon')).toBeTruthy();
    expect(within(section).queryByRole('button')).toBeNull();
  });

  // stage-navigation-and-page-replacement.prd.md Phase 7: the section reads the Pickups page's list, read-only.
  it("reads the Pickups page's list: what is left and the pickup last jumped to, with no actions of its own", async () => {
    renderCompanion({}, { pickupsState: async () => WIRE_PICKUPS_NEXT_SUCCESS, pickupsCount: async () => ({ status: 'started' }) });
    const section = screen.getByRole('region', { name: 'Pickups' });
    expect(await within(section).findByText('2 pickups remaining of 2')).toBeTruthy();
    expect(within(section).getByText(/Mispronounced "labyrinthine"/)).toBeTruthy();
    expect(within(section).queryByText('Coming soon')).toBeNull();
    expect(within(section).queryByRole('button')).toBeNull();
  });

  it('reserves the this-chapter section with an honest "Coming soon", not an empty gap or made-up numbers', () => {
    renderCompanion();
    const section = screen.getByRole('region', { name: 'This chapter' });
    expect(within(section).getByText('Coming soon')).toBeTruthy();
    expect(within(section).queryByRole('button')).toBeNull();
  });

  it('lists the gestures that work here, and says they need this window focused', () => {
    renderCompanion();
    const hotkeys = screen.getByRole('region', { name: 'Hotkeys' });
    expect(within(hotkeys).getByText('Play or pause reading')).toBeTruthy();
    expect(within(hotkeys).getByText('Back to the full app')).toBeTruthy();
    expect(within(hotkeys).getByText(/only while this window has focus/i)).toBeTruthy();
  });

  it('Play starts the same session the dialog would (reading.toggle), and Space does too', async () => {
    const user = userEvent.setup();
    const start = vi.fn();
    const recording = fakeRecording();
    renderCompanion({ session: baseSession({ start }), recording });
    await user.click(screen.getByRole('button', { name: 'Play' }));
    await waitFor(() => expect(start).toHaveBeenCalledTimes(1));
    expect(recording.beforeStart).toHaveBeenCalled();
    await user.keyboard(' ');
    await waitFor(() => expect(start).toHaveBeenCalledTimes(2));
  });

  it('pauses and stops a running session', async () => {
    const user = userEvent.setup();
    const pause = vi.fn();
    const stop = vi.fn();
    const recording = fakeRecording();
    renderCompanion({ session: baseSession({ active: true, pause, stop }), recording });
    await user.click(screen.getByRole('button', { name: 'Pause' }));
    expect(pause).toHaveBeenCalledWith(true);
    await user.click(screen.getByRole('button', { name: 'Stop reading' }));
    expect(stop).toHaveBeenCalled();
    expect(recording.afterStop).toHaveBeenCalled();
  });

  it('is the whole window: the page behind it is hidden and inert while it shows, and given back after', () => {
    const behind = document.createElement('div');
    behind.textContent = 'The full app';
    document.body.append(behind);
    const { unmount } = renderCompanion();
    expect(behind.getAttribute('aria-hidden')).toBe('true');
    expect(behind.hasAttribute('inert')).toBe(true);
    expect(screen.getByRole('main')).toBeTruthy();
    unmount();
    expect(behind.hasAttribute('aria-hidden')).toBe(false);
    expect(behind.hasAttribute('inert')).toBe(false);
    behind.remove();
  });
});
