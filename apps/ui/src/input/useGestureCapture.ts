import { useEffect } from 'react';
import { gestureFromKeyboardEvent, type Gesture } from './gestures';

// A modifier held alone never forms a gesture (Solution Detail's "no modifier held" cases aside): waiting for a real
// key lets a narrator hold Ctrl while reaching for a chord without an early, meaningless "Control" capture.
const MODIFIER_CODES: ReadonlySet<string> = new Set([
  'ShiftLeft',
  'ShiftRight',
  'ControlLeft',
  'ControlRight',
  'AltLeft',
  'AltRight',
  'MetaLeft',
  'MetaRight',
  'OSLeft',
  'OSRight',
]);

const isBareEscape = (event: KeyboardEvent) => event.code === 'Escape' && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;

/**
 * The Phase 6 recorder's "press a key or a pedal" step (PRD user flow step 2; Q1: a keyboard-type pedal presents as a
 * keyboard, so this alone covers it - MidiSource and HidSource add their own capture in Phases 9 and 11). Lives in
 * `src/input/` and listens on the capture phase, so `listenerGuard.test.ts`'s scan stays clean (ADR 0361: a command
 * listener stays out of `src/components/`) and so the press never also reaches a bound command underneath the
 * recorder (Escape cancels the recorder instead of running `help.shortcuts`, say).
 */
export function useGestureCapture(
  active: boolean,
  onCapture: (gesture: Gesture) => void,
  onCancel: () => void,
  target: Pick<Document, 'addEventListener' | 'removeEventListener'> = document,
): void {
  useEffect(() => {
    if (!active) return undefined;
    const onKeyDown = (event: Event) => {
      const keyboardEvent = event as KeyboardEvent;
      if (keyboardEvent.repeat || MODIFIER_CODES.has(keyboardEvent.code)) return;
      keyboardEvent.preventDefault();
      keyboardEvent.stopPropagation();
      if (isBareEscape(keyboardEvent)) {
        onCancel();
        return;
      }
      onCapture(gestureFromKeyboardEvent(keyboardEvent));
    };
    target.addEventListener('keydown', onKeyDown, true);
    return () => target.removeEventListener('keydown', onKeyDown, true);
  }, [active, onCapture, onCancel, target]);
}
