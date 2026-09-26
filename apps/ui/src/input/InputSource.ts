import type { Gesture } from './gestures';

/** One gesture as it reaches the router: the normalised gesture, the DOM target it happened on (for the target
 * guard, `targets.ts`) and how to consume it so nothing else also reacts (`isScrollKey`, ADR 0119). */
export type GestureEvent = {
  gesture: Gesture;
  target: EventTarget | null;
  preventDefault: () => void;
};

/**
 * A device the router can listen to (Solution Detail, ADR 0361 decision 3): one method, `subscribe`, returning its
 * own unsubscribe. The router depends only on this interface, never on a concrete device, so a test drives a fake
 * source and `KeyboardSource` is one implementation among others (`MidiSource`, `HidSource`, later phases).
 */
export type InputSource = {
  subscribe(onGesture: (event: GestureEvent) => void): () => void;
};
