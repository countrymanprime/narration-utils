import { useEffect } from 'react';
import { gestureFromKeyboardEvent, type Gesture } from './gestures';
import { hidSource } from './HidSource';
import type { InputSource } from './InputSource';
import { midiSource } from './MidiSource';

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
 *
 * Phase 9: also learns MIDI, subscribing to the same `midiSource` singleton the router does. There is no DOM
 * propagation to swallow a MIDI press the way `stopPropagation` does for a key, so `midiSource` itself resolves the
 * race: this subscription starts only while the recorder is open, later than the router's, so it is offered a press
 * first and its `preventDefault()` below stops the router from also running whatever command that gesture already
 * happens to be bound to.
 *
 * Phase 11: the same for `hidSource`. A device must already be paired (`requestHidDevice`, from a future "Connect a
 * pedal" button) before the recorder can learn a press from it - opening the recorder itself grants no new device
 * access, since WebHID's `requestDevice()` needs its own user gesture, not this one.
 */
export function useGestureCapture(
  active: boolean,
  onCapture: (gesture: Gesture) => void,
  onCancel: () => void,
  target: Pick<Document, 'addEventListener' | 'removeEventListener'> = document,
  midi: InputSource = midiSource,
  hid: InputSource = hidSource,
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
    const learn = (event: { gesture: Gesture; preventDefault: () => void }) => {
      event.preventDefault();
      onCapture(event.gesture);
    };
    const unsubscribeMidi = midi.subscribe(learn);
    const unsubscribeHid = hid.subscribe(learn);
    return () => {
      target.removeEventListener('keydown', onKeyDown, true);
      unsubscribeMidi();
      unsubscribeHid();
    };
  }, [active, onCapture, onCancel, target, midi, hid]);
}
