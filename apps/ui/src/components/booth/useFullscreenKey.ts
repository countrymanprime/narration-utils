import { useEffect, useRef } from 'react';
import { exitFullscreen, toggleFullscreen } from '../../api/hostWindow';
import { useCommand } from '../../input/useCommand';

/**
 * `booth.fullscreen` (F11) toggles the whole window between fullscreen and windowed while the Booth is up (mock 03 fills the
 * window, owner call BO2). The Booth covers the window either way; fullscreen also takes the operating system's title bar and
 * task bar away. A window the Booth put into fullscreen goes back when the Booth is left, so the other pages never inherit it.
 */
export function useFullscreenKey(enabled = true): void {
  const entered = useRef(false);
  useCommand(
    'booth.fullscreen',
    () => {
      void toggleFullscreen().then((fullscreen) => {
        entered.current = fullscreen;
      });
    },
    enabled,
  );
  useEffect(
    () => () => {
      if (entered.current) {
        entered.current = false;
        void exitFullscreen();
      }
    },
    [],
  );
}
