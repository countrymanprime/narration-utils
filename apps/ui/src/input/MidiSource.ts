import { gesture } from './gestures';
import type { GestureEvent, InputSource } from './InputSource';

const DEBOUNCE_MS = 30;
const NOTE_ON = 0x9;
const CONTROL_CHANGE = 0xb;
const PRESS_THRESHOLD = 64;

/**
 * A press from a note-on (velocity > 0) or a CC crossing the switch threshold (value >= 64, PRD Phase 9 and Q7's
 * `midi:cc/1/64` example: the controller number becomes part of the gesture, not the filter - any CC a narrator's
 * pedal happens to send can be learned). Every other message type (note-off, aftertouch, program change, pitch
 * bend, system messages) is not a press and returns `undefined`.
 *
 * Also where a malicious or malfunctioning device's bytes are validated (feature-cleanup trust-boundary check,
 * threat-model row 10): a status-only or truncated message, a byte outside the 7-bit MIDI range, or a first byte
 * that is not a real status byte (bit 7 unset) is dropped rather than guessed at. `MIDIMessageEvent` already
 * delivers one complete message per event (the browser expands running status), so no message here is ever a
 * partial fragment of another.
 */
function pressCodeFromMessage(data: Uint8Array): string | undefined {
  if (data.length < 3) return undefined;
  const [status, data1, data2] = data;
  if ((status & 0x80) === 0) return undefined;
  if (data1 > 0x7f || data2 > 0x7f) return undefined;
  const type = (status >> 4) & 0x0f;
  const channel = (status & 0x0f) + 1;
  if (type === NOTE_ON && data2 > 0) return `note/${channel}/${data1}`;
  if (type === CONTROL_CHANGE && data2 >= PRESS_THRESHOLD) return `cc/${channel}/${data1}`;
  return undefined;
}

/** The subset of `MIDIInput` this source needs. A real `MIDIInput` satisfies this structurally, so no fake used in
 * a test has to implement the rest of `EventTarget`. */
export type MidiInputLike = {
  addEventListener(type: 'midimessage', listener: (event: { data: Uint8Array | null }) => void): void;
  removeEventListener(type: 'midimessage', listener: (event: { data: Uint8Array | null }) => void): void;
};

/** The subset of `MIDIAccess` this source needs. */
export type MidiAccessLike = {
  inputs: { forEach(callback: (input: MidiInputLike) => void): void };
  onstatechange: (() => void) | null;
};

type NavigatorLike = { requestMIDIAccess?: () => Promise<MidiAccessLike> };

const realNavigator: NavigatorLike = typeof navigator === 'undefined' ? {} : (navigator as unknown as NavigatorLike);

/**
 * The Should input source (Solution Detail, Phase 9): Web MIDI note-on and CC presses. Feature-detected
 * (`navigatorLike.requestMIDIAccess` absent, or its promise rejecting) so a platform without it - Phase 8's spike
 * found neither WKWebView (macOS) nor WebKitGTK 6.0 (Linux) ship it - simply contributes nothing, and
 * `KeyboardSource` keeps covering a keyboard-type pedal everywhere. No `{ sysex: true }` is requested: this source
 * only ever reads note-on and CC, so it asks for the narrower permission (threat-model row 10).
 *
 * Follows port hot-plug through `MIDIAccess.onstatechange`, and debounces a repeated press of the same gesture
 * within 30 ms, since a pedal's own contact bounce, or a continuous controller re-crossing the press threshold on a
 * shaky press, should read as one press.
 *
 * A gesture reaches every current subscriber, most recently subscribed first, and a subscriber that calls
 * `preventDefault()` stops it going to the rest (the same "consume so nothing else reacts" contract
 * `InputSource.ts`'s `GestureEvent` already documents, generalised here to more than one subscriber of one source).
 * This is how the Phase 6 recorder (`useGestureCapture.ts`) can learn a press without the router also running
 * whatever command that gesture already happens to be bound to: both subscribe to the same `midiSource` instance
 * below, the recorder's subscription starts later (only while it is open), so it is offered the press first.
 */
export function createMidiSource(navigatorLike: NavigatorLike = realNavigator): InputSource {
  const subscribers: Array<(event: GestureEvent) => void> = [];
  const lastFired = new Map<string, number>();
  let access: MidiAccessLike | undefined;
  let requested = false;

  const dispatch = (code: string) => {
    if (subscribers.length === 0) return;
    const now = Date.now();
    const last = lastFired.get(code);
    if (last !== undefined && now - last < DEBOUNCE_MS) return;
    lastFired.set(code, now);

    let consumed = false;
    const event: GestureEvent = {
      gesture: gesture('midi', code),
      target: null,
      preventDefault: () => {
        consumed = true;
      },
    };
    for (let i = subscribers.length - 1; i >= 0 && !consumed; i--) subscribers[i](event);
  };

  const handleMessage = (event: { data: Uint8Array | null }) => {
    if (!event.data) return;
    const code = pressCodeFromMessage(event.data);
    if (code) dispatch(code);
  };

  const attachToInputs = () => {
    access?.inputs.forEach((input) => input.addEventListener('midimessage', handleMessage));
  };

  const ensureAccess = () => {
    if (requested) return;
    requested = true;
    if (typeof navigatorLike.requestMIDIAccess !== 'function') return;
    navigatorLike
      .requestMIDIAccess()
      .then((granted) => {
        access = granted;
        attachToInputs();
        access.onstatechange = attachToInputs;
      })
      .catch(() => {
        // Denied, unsupported, or blocked by the webview host (Phase 8's research note: WebView2's permission
        // plumbing for MIDI is unconfirmed). KeyboardSource still covers a keyboard-type pedal, so this source
        // simply contributes nothing rather than surfacing an error nobody in the booth can act on.
      });
  };

  return {
    subscribe(onGesture) {
      subscribers.push(onGesture);
      if (access) attachToInputs();
      else ensureAccess();
      return () => {
        const index = subscribers.indexOf(onGesture);
        if (index !== -1) subscribers.splice(index, 1);
        if (subscribers.length === 0) access?.inputs.forEach((input) => input.removeEventListener('midimessage', handleMessage));
      };
    },
  };
}

/**
 * Combines any number of sources into one `InputSource` (Solution Detail: "a new device is one new class"). Used to
 * give the router's single `source` slot both keyboard and MIDI (`main.tsx`) without `router.tsx` - Phase 10's
 * file - changing at all: it stays generic over `InputSource`, not MIDI-specific.
 */
export function combineSources(...sources: InputSource[]): InputSource {
  return {
    subscribe(onGesture) {
      const unsubscribers = sources.map((source) => source.subscribe(onGesture));
      return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
    },
  };
}

/**
 * The one instance `main.tsx` and `useGestureCapture.ts` both subscribe to, so the priority rule documented above is
 * real: two independent `createMidiSource()` calls would each open their own `requestMIDIAccess()` and never see
 * each other's subscribers.
 */
export const midiSource: InputSource = createMidiSource();
