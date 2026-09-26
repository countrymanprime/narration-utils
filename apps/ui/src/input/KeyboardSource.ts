import { gestureFromKeyboardEvent } from './gestures';
import type { GestureEvent, InputSource } from './InputSource';

/**
 * The Must input source (Solution Detail): a `keydown` listener on `document`, normalising modifiers through
 * `gestureFromKeyboardEvent`. Many USB footswitches present as keyboards, so this alone covers them. `event.repeat`
 * is ignored - every command here is press-only (Solution Detail's `InputSource` note), so a held key fires once,
 * the same as every listener it replaces.
 *
 * A plain factory rather than a class, like the rest of `src/input/` (a target is injectable for tests, defaulting
 * to the real `document`).
 */
export function createKeyboardSource(target: Pick<Document, 'addEventListener' | 'removeEventListener'> = document): InputSource {
  return {
    subscribe(onGesture: (event: GestureEvent) => void): () => void {
      const onKeyDown = (event: Event) => {
        const keyboardEvent = event as KeyboardEvent;
        if (keyboardEvent.repeat) return;
        onGesture({
          gesture: gestureFromKeyboardEvent(keyboardEvent),
          target: keyboardEvent.target,
          preventDefault: () => keyboardEvent.preventDefault(),
        });
      };
      target.addEventListener('keydown', onKeyDown);
      return () => target.removeEventListener('keydown', onKeyDown);
    },
  };
}
