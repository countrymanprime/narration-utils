// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TransportBar, type TransportBarPlayer } from './TransportBar';
import type { WorkspaceReaperControls } from './useWorkspaceReaper';

afterEach(cleanup);

function player(overrides: Partial<TransportBarPlayer> = {}): TransportBarPlayer {
  return {
    isPlaying: false,
    elapsed: 0,
    duration: 0,
    canPlay: true,
    loadError: false,
    speed: 1,
    togglePlay: vi.fn(),
    skipBack: vi.fn(),
    skipForward: vi.fn(),
    setSpeed: vi.fn(),
    ...overrides,
  };
}

function reaper(overrides: Partial<WorkspaceReaperControls> = {}): WorkspaceReaperControls {
  return {
    goToBlocked: undefined,
    loopBlocked: undefined,
    looping: false,
    pending: undefined,
    message: undefined,
    goTo: vi.fn(async () => {}),
    loop: vi.fn(async () => {}),
    stopLoop: vi.fn(async () => {}),
    goToTokenBlocked: () => undefined,
    loopTokenBlocked: () => undefined,
    ...overrides,
  } as WorkspaceReaperControls;
}

describe('TransportBar', () => {
  it('is a named toolbar, its transport controls reachable by roving focus (mock-fidelity Phase 10)', () => {
    render(<TransportBar player={player()} reaper={reaper()} />);
    expect(screen.getByRole('toolbar', { name: 'Chapter playback controls' })).toBeTruthy();
    const [skipBack] = screen.getAllByRole('button');
    expect(skipBack.tabIndex).toBe(0);
  });

  it('still triggers play/pause, skip back and skip forward', async () => {
    const user = userEvent.setup();
    const p = player();
    render(<TransportBar player={p} reaper={reaper()} />);
    await user.click(screen.getByRole('button', { name: 'Play' }));
    expect(p.togglePlay).toHaveBeenCalledOnce();
    await user.click(screen.getByRole('button', { name: 'Skip back 5 seconds' }));
    expect(p.skipBack).toHaveBeenCalledOnce();
    await user.click(screen.getByRole('button', { name: 'Skip forward 5 seconds' }));
    expect(p.skipForward).toHaveBeenCalledOnce();
  });

  it('never fires a disabled control while the chapter has nothing playable', async () => {
    const user = userEvent.setup();
    const p = player({ canPlay: false });
    render(<TransportBar player={p} reaper={reaper()} />);
    await user.click(screen.getByRole('button', { name: 'Play' }));
    expect(p.togglePlay).not.toHaveBeenCalled();
  });

  it('still offers the playback-speed select and the elapsed/duration readout alongside the toolbar buttons', () => {
    render(<TransportBar player={player({ elapsed: 5, duration: 60 })} reaper={reaper()} />);
    expect(screen.getByRole('combobox', { name: 'Playback speed' })).toBeTruthy();
    expect(screen.getByText('0:05.0 / 1:00')).toBeTruthy();
  });

  it('still sends Go to and Loop in REAPER for the current word', async () => {
    const user = userEvent.setup();
    const r = reaper();
    render(<TransportBar player={player()} reaper={r} />);
    await user.click(screen.getByRole('button', { name: 'Go to in REAPER' }));
    expect(r.goTo).toHaveBeenCalledOnce();
    await user.click(screen.getByRole('button', { name: 'Loop in REAPER' }));
    expect(r.loop).toHaveBeenCalledOnce();
  });

  it('swaps Loop for Stop loop while this transport is the one looping in REAPER', async () => {
    const user = userEvent.setup();
    const r = reaper({ looping: true });
    render(<TransportBar player={player()} reaper={r} />);
    expect(screen.queryByRole('button', { name: 'Loop in REAPER' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Stop loop' }));
    expect(r.stopLoop).toHaveBeenCalledOnce();
  });
});
