import { Window } from '@wailsio/runtime';

/**
 * Whether the page runs in the desktop host: the Wails runtime fills `_wails.environment` when it starts. The browser build
 * used by the visual suite and the demo has none, so it goes through the browser's own Fullscreen API instead.
 */
function inDesktopHost(): boolean {
  const wails: unknown = Reflect.get(window, '_wails');
  return typeof wails === 'object' && wails !== null && 'environment' in wails && Boolean(wails.environment);
}

/** Whether the window is fullscreen now; a host that cannot say reads as windowed. */
async function isFullscreen(): Promise<boolean> {
  try {
    return inDesktopHost() ? await Window.IsFullscreen() : document.fullscreenElement !== null;
  } catch {
    return false;
  }
}

/**
 * Switches the whole window between fullscreen and windowed (the Booth's F11, owner call BO2). The desktop host's window is
 * the runtime's own `Window.ToggleFullscreen`, a call of the runtime and not a binding of ours, so nothing crosses the wire
 * contract; the browser build uses the Fullscreen API. Never rejects: a window that refuses stays as it was, and the answer
 * is whether it is fullscreen afterwards.
 */
export async function toggleFullscreen(): Promise<boolean> {
  try {
    if (inDesktopHost()) await Window.ToggleFullscreen();
    else if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch {
    // The window stays as it was; the answer says so.
    return isFullscreen();
  }
  return isFullscreen();
}

/** Leaves fullscreen if the window is in it; a window that is not fullscreen, or that refuses, is left alone. Never rejects. */
export async function exitFullscreen(): Promise<void> {
  if (!(await isFullscreen())) return;
  try {
    if (inDesktopHost()) await Window.UnFullscreen();
    else await document.exitFullscreen();
  } catch {
    // Left as it is.
    return;
  }
}
