// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => ({
  ToggleFullscreen: vi.fn(async () => {}),
  IsFullscreen: vi.fn(async () => true),
  UnFullscreen: vi.fn(async () => {}),
}));
vi.mock('@wailsio/runtime', () => ({ Window: runtime }));

import { exitFullscreen, toggleFullscreen } from './hostWindow';

afterEach(() => {
  delete (window as { _wails?: unknown })._wails;
  Object.defineProperty(document, 'fullscreenElement', { value: null, configurable: true });
  vi.clearAllMocks();
});

describe('toggleFullscreen', () => {
  it('uses the desktop host window when the Wails runtime is there', async () => {
    (window as { _wails?: unknown })._wails = { environment: { OS: 'windows' } };
    expect(await toggleFullscreen()).toBe(true);
    expect(runtime.ToggleFullscreen).toHaveBeenCalledOnce();
  });

  it('uses the browser Fullscreen API without it, in and out', async () => {
    const request = vi.fn(async () => {});
    const exit = vi.fn(async () => {});
    document.documentElement.requestFullscreen = request;
    document.exitFullscreen = exit;
    expect(await toggleFullscreen()).toBe(false);
    expect(request).toHaveBeenCalledOnce();
    Object.defineProperty(document, 'fullscreenElement', { value: document.documentElement, configurable: true });
    expect(await toggleFullscreen()).toBe(true);
    Object.defineProperty(document, 'fullscreenElement', { value: null, configurable: true });
    expect(await toggleFullscreen()).toBe(false);
    expect(exit).toHaveBeenCalledOnce();
    expect(runtime.ToggleFullscreen).not.toHaveBeenCalled();
  });
});

describe('exitFullscreen', () => {
  it('leaves the desktop window only when it is fullscreen', async () => {
    (window as { _wails?: unknown })._wails = { environment: {} };
    await exitFullscreen();
    expect(runtime.UnFullscreen).toHaveBeenCalledOnce();
    runtime.IsFullscreen.mockResolvedValueOnce(false);
    await exitFullscreen();
    expect(runtime.UnFullscreen).toHaveBeenCalledOnce();
  });
});

describe('a window that refuses', () => {
  it('stays as it was and never rejects', async () => {
    (window as { _wails?: unknown })._wails = { environment: {} };
    runtime.ToggleFullscreen.mockRejectedValueOnce(new Error('refused'));
    runtime.IsFullscreen.mockResolvedValueOnce(false);
    expect(await toggleFullscreen()).toBe(false);
  });
});
