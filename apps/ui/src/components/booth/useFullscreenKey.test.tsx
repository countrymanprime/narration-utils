// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react';

import { afterEach, describe, expect, it, vi } from 'vitest';

const host = vi.hoisted(() => ({ toggleFullscreen: vi.fn(async () => true), exitFullscreen: vi.fn(async () => {}) }));
vi.mock('../../api/hostWindow', () => host);

import { CommandRouter, CommandScope } from '../../input/router';
import { useFullscreenKey } from './useFullscreenKey';

function Probe({ enabled }: { enabled?: boolean }) {
  useFullscreenKey(enabled);
  return null;
}

const renderProbe = (enabled?: boolean) =>
  render(
    <CommandRouter>
      <CommandScope kind="booth">
        <Probe enabled={enabled} />
      </CommandScope>
    </CommandRouter>,
  );

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('useFullscreenKey', () => {
  it('toggles fullscreen on F11', async () => {
    renderProbe();
    fireEvent.keyDown(document.body, { key: 'F11', code: 'F11' });
    expect(host.toggleFullscreen).toHaveBeenCalledOnce();
  });

  it('ignores other keys and does nothing while disabled', async () => {
    renderProbe();
    fireEvent.keyDown(document.body, { key: 'F10', code: 'F10' });
    expect(host.toggleFullscreen).not.toHaveBeenCalled();
    cleanup();
    renderProbe(false);
    fireEvent.keyDown(document.body, { key: 'F11', code: 'F11' });
    expect(host.toggleFullscreen).not.toHaveBeenCalled();
  });

  it('puts the window back when the Booth is left after it entered fullscreen, and only then', async () => {
    renderProbe().unmount();
    expect(host.exitFullscreen).not.toHaveBeenCalled();
    const second = renderProbe();
    fireEvent.keyDown(document.body, { key: 'F11', code: 'F11' });
    await vi.waitFor(() => expect(host.toggleFullscreen).toHaveBeenCalled());
    second.unmount();
    expect(host.exitFullscreen).toHaveBeenCalledOnce();
  });
});
