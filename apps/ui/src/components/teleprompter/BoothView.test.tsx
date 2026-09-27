// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiProvider } from '../../api/ApiContext';
import { createMockApi } from '../../api/mockApi';
import { CommandRouter, CommandScope } from '../../input/router';
import { BoothView } from './BoothView';
import { initialSession } from './readerModel';
import type { FollowCursor } from './useFollowCursor';
import type { RecordInReaperState } from './useRecordInReaper';
import type { TeleprompterSession } from './useTeleprompterSession';

afterEach(cleanup);

function baseSession(overrides: Partial<TeleprompterSession> = {}): TeleprompterSession {
  return {
    host: { phase: 'idle', message: '', engine: null, chapter: null, script: null, position: null },
    paused: false,
    pause: vi.fn(),
    session: initialSession,
    device: '',
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
    canStart: false,
    startReason: 'Choose a microphone first.',
    ...overrides,
  };
}

function followCursor(overrides: Partial<FollowCursor> = {}): FollowCursor {
  return { following: true, resume: vi.fn(), readerRef: { current: null }, ...overrides };
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

function renderBooth(overrides: Partial<Parameters<typeof BoothView>[0]> = {}) {
  const api = createMockApi();
  return render(
    <MemoryRouter>
      <ApiProvider api={api}>
        <CommandRouter>
          <CommandScope kind="booth">
            <BoothView session={baseSession()} follow={followCursor()} recording={fakeRecording()} rail={<div>Reading panel</div>} {...overrides} />
          </CommandScope>
        </CommandRouter>
      </ApiProvider>
    </MemoryRouter>,
  );
}

describe('BoothView (booth-mode-and-companion-panel.prd.md Phase 1, Phase 2)', () => {
  it('lays out a named status region, the given rail as a complementary landmark, the script with no main landmark of its own, and a named Booth commands toolbar', () => {
    renderBooth({ chapterTitle: 'Chapter 3' });
    expect(screen.getByRole('region', { name: 'Status' })).toBeTruthy();
    const rail = screen.getByRole('complementary', { name: 'Rail' });
    expect(within(rail).getByText('Reading panel')).toBeTruthy();
    // Always mounted inside ReadAloudDialog's Dialog, whose page behind it keeps its own <main> in the accessibility
    // tree (a live region there stays announced): FocusShell's `asMain={false}` here avoids a second one.
    expect(screen.queryByRole('main')).toBeNull();
    expect(screen.getByRole('toolbar', { name: 'Booth commands' })).toBeTruthy();
  });

  it('shows Ready while idle, Reading while listening, and REC · P&R while this app is recording', () => {
    const { rerender } = renderBooth({ session: baseSession({ active: false }) });
    expect(screen.getByText('Ready')).toBeTruthy();

    rerender(
      <MemoryRouter>
        <ApiProvider api={createMockApi()}>
          <CommandRouter>
            <CommandScope kind="booth">
              <BoothView session={baseSession({ active: true, paused: false })} follow={followCursor()} recording={fakeRecording()} rail={<div />} />
            </CommandScope>
          </CommandRouter>
        </ApiProvider>
      </MemoryRouter>,
    );
    expect(screen.getByText('Reading')).toBeTruthy();

    rerender(
      <MemoryRouter>
        <ApiProvider api={createMockApi()}>
          <CommandRouter>
            <CommandScope kind="booth">
              <BoothView
                session={baseSession({ active: true, paused: false })}
                follow={followCursor()}
                recording={fakeRecording({ recording: true })}
                rail={<div />}
              />
            </CommandScope>
          </CommandRouter>
        </ApiProvider>
      </MemoryRouter>,
    );
    expect(screen.getByText('REC · P&R')).toBeTruthy();
  });

  it('shows the chapter title and word progress in the status region', () => {
    renderBooth({
      chapterTitle: 'Chapter 3',
      session: baseSession({
        session: { ...initialSession, script: { type: 'script', chapter: { id: 'c1', title: 'Chapter 3' }, tokens: 120, spans: [] }, cursor: 40 },
      }),
    });
    expect(screen.getByText('Chapter 3')).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Status' }).textContent).toContain('40 of 120 words');
  });

  it('the Toolbar Play/Pause button is Kbd-labelled Space and calls the same handler reading.toggle would', async () => {
    const user = userEvent.setup();
    const start = vi.fn();
    const beforeStart = vi.fn(async () => true);
    renderBooth({ session: baseSession({ canStart: true, start }), recording: fakeRecording({ beforeStart }) });
    const toolbar = screen.getByRole('toolbar', { name: 'Booth commands' });
    const play = within(toolbar).getByRole('button', { name: 'Play' });
    expect(within(play).getByRole('img', { name: 'Space' })).toBeTruthy();
    await user.click(play);
    expect(beforeStart).toHaveBeenCalled();
    expect(start).toHaveBeenCalled();
  });

  it('Stop reading is disabled while idle and calls stop and afterStop once active', async () => {
    const user = userEvent.setup();
    const stop = vi.fn();
    const afterStop = vi.fn();
    const { rerender } = renderBooth({ session: baseSession({ active: false }) });
    expect(screen.getByRole('button', { name: 'Stop reading' }).hasAttribute('disabled')).toBe(true);

    rerender(
      <MemoryRouter>
        <ApiProvider api={createMockApi()}>
          <CommandRouter>
            <CommandScope kind="booth">
              <BoothView session={baseSession({ active: true, stop })} follow={followCursor()} recording={fakeRecording({ afterStop })} rail={<div />} />
            </CommandScope>
          </CommandRouter>
        </ApiProvider>
      </MemoryRouter>,
    );
    await user.click(screen.getByRole('button', { name: 'Stop reading' }));
    expect(stop).toHaveBeenCalled();
    expect(afterStop).toHaveBeenCalled();
  });

  it('shows Follow only during a session, disabled while following', () => {
    const { rerender } = renderBooth({ session: baseSession({ active: false }) });
    expect(screen.queryByRole('button', { name: 'Follow' })).toBeNull();

    rerender(
      <MemoryRouter>
        <ApiProvider api={createMockApi()}>
          <CommandRouter>
            <CommandScope kind="booth">
              <BoothView session={baseSession({ active: true })} follow={followCursor({ following: true })} recording={fakeRecording()} rail={<div />} />
            </CommandScope>
          </CommandRouter>
        </ApiProvider>
      </MemoryRouter>,
    );
    expect(screen.getByRole('button', { name: 'Follow' }).hasAttribute('disabled')).toBe(true);
  });
});
