import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { gesture } from './gestures';
import type { GestureEvent } from './InputSource';
import { combineSources, createMidiSource, type MidiAccessLike, type MidiInputLike } from './MidiSource';

type Listener = (event: { data: Uint8Array | null }) => void;

function fakeInput(): { input: MidiInputLike; send: (data: number[]) => void; send0Byte: () => void; listenerCount: () => number } {
  const listeners: Listener[] = [];
  return {
    input: {
      addEventListener: (_type, listener) => {
        listeners.push(listener as Listener);
      },
      removeEventListener: (_type, listener) => {
        const index = listeners.indexOf(listener as Listener);
        if (index !== -1) listeners.splice(index, 1);
      },
    },
    send: (data: number[]) => {
      const event = { data: new Uint8Array(data) };
      for (const listener of [...listeners]) listener(event);
    },
    send0Byte: () => {
      for (const listener of [...listeners]) listener({ data: null });
    },
    listenerCount: () => listeners.length,
  };
}

function fakeAccess(initialInputs: MidiInputLike[] = []): { access: MidiAccessLike; hotplug: (input: MidiInputLike) => void } {
  const inputs = [...initialInputs];
  const access: MidiAccessLike = {
    inputs: { forEach: (callback) => inputs.forEach(callback) },
    onstatechange: null,
  };
  return {
    access,
    hotplug: (input: MidiInputLike) => {
      inputs.push(input);
      access.onstatechange?.();
    },
  };
}

const NOTE_ON = 0x90;
const CONTROL_CHANGE = 0xb0;

describe('createMidiSource', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does nothing when the platform has no requestMIDIAccess (Phase 8: WKWebView, WebKitGTK)', async () => {
    const source = createMidiSource({});
    const onGesture = vi.fn();
    const unsubscribe = source.subscribe(onGesture);
    await vi.waitFor(() => {});
    unsubscribe();
    expect(onGesture).not.toHaveBeenCalled();
  });

  it('does nothing when requestMIDIAccess rejects (denied or blocked by the webview host)', async () => {
    const source = createMidiSource({ requestMIDIAccess: () => Promise.reject(new Error('denied')) });
    const onGesture = vi.fn();
    source.subscribe(onGesture);
    await vi.waitFor(() => {});
    expect(onGesture).not.toHaveBeenCalled();
  });

  it('reports a note-on with velocity > 0 as a press, channel 1-based', async () => {
    const { input, send } = fakeInput();
    const { access } = fakeAccess([input]);
    const source = createMidiSource({ requestMIDIAccess: () => Promise.resolve(access) });
    const onGesture = vi.fn();
    source.subscribe(onGesture);
    await flushMicrotasks();

    send([NOTE_ON, 60, 100]);

    expect(onGesture).toHaveBeenCalledTimes(1);
    const event: GestureEvent = onGesture.mock.calls[0][0];
    expect(event.gesture).toEqual(gesture('midi', 'note/1/60'));
    expect(event.target).toBeNull();
  });

  it('ignores a note-on with velocity 0 (the note-off convention)', async () => {
    const { input, send } = fakeInput();
    const { access } = fakeAccess([input]);
    const source = createMidiSource({ requestMIDIAccess: () => Promise.resolve(access) });
    const onGesture = vi.fn();
    source.subscribe(onGesture);
    await flushMicrotasks();

    send([NOTE_ON, 60, 0]);

    expect(onGesture).not.toHaveBeenCalled();
  });

  it('ignores a real note-off message', async () => {
    const { input, send } = fakeInput();
    const { access } = fakeAccess([input]);
    const source = createMidiSource({ requestMIDIAccess: () => Promise.resolve(access) });
    const onGesture = vi.fn();
    source.subscribe(onGesture);
    await flushMicrotasks();

    send([0x80, 60, 100]);

    expect(onGesture).not.toHaveBeenCalled();
  });

  it('reports a CC message crossing the press threshold (value >= 64), serialised as PRD Q7 shows', async () => {
    const { input, send } = fakeInput();
    const { access } = fakeAccess([input]);
    const source = createMidiSource({ requestMIDIAccess: () => Promise.resolve(access) });
    const onGesture = vi.fn();
    source.subscribe(onGesture);
    await flushMicrotasks();

    send([CONTROL_CHANGE, 64, 127]);

    expect(onGesture).toHaveBeenCalledTimes(1);
    expect(onGesture.mock.calls[0][0].gesture).toEqual(gesture('midi', 'cc/1/64'));
  });

  it('ignores a CC message below the press threshold', async () => {
    const { input, send } = fakeInput();
    const { access } = fakeAccess([input]);
    const source = createMidiSource({ requestMIDIAccess: () => Promise.resolve(access) });
    const onGesture = vi.fn();
    source.subscribe(onGesture);
    await flushMicrotasks();

    send([CONTROL_CHANGE, 64, 10]);

    expect(onGesture).not.toHaveBeenCalled();
  });

  it('drops a truncated message instead of guessing at the missing bytes', async () => {
    const { input, send } = fakeInput();
    const { access } = fakeAccess([input]);
    const source = createMidiSource({ requestMIDIAccess: () => Promise.resolve(access) });
    const onGesture = vi.fn();
    source.subscribe(onGesture);
    await flushMicrotasks();

    send([NOTE_ON, 60]);

    expect(onGesture).not.toHaveBeenCalled();
  });

  it('drops a message with a data byte outside the 7-bit MIDI range', async () => {
    const { input, send } = fakeInput();
    const { access } = fakeAccess([input]);
    const source = createMidiSource({ requestMIDIAccess: () => Promise.resolve(access) });
    const onGesture = vi.fn();
    source.subscribe(onGesture);
    await flushMicrotasks();

    send([NOTE_ON, 200, 100]);

    expect(onGesture).not.toHaveBeenCalled();
  });

  it('drops a message whose first byte is not a real status byte', async () => {
    const { input, send } = fakeInput();
    const { access } = fakeAccess([input]);
    const source = createMidiSource({ requestMIDIAccess: () => Promise.resolve(access) });
    const onGesture = vi.fn();
    source.subscribe(onGesture);
    await flushMicrotasks();

    send([0x10, 60, 100]);

    expect(onGesture).not.toHaveBeenCalled();
  });

  it('ignores an event with no data at all', async () => {
    const { input, send0Byte } = fakeInput();
    const { access } = fakeAccess([input]);
    const source = createMidiSource({ requestMIDIAccess: () => Promise.resolve(access) });
    const onGesture = vi.fn();
    source.subscribe(onGesture);
    await flushMicrotasks();

    send0Byte();

    expect(onGesture).not.toHaveBeenCalled();
  });

  it('debounces a repeated press of the same gesture within 30ms', async () => {
    const { input, send } = fakeInput();
    const { access } = fakeAccess([input]);
    const source = createMidiSource({ requestMIDIAccess: () => Promise.resolve(access) });
    const onGesture = vi.fn();
    source.subscribe(onGesture);
    await flushMicrotasks();

    send([NOTE_ON, 60, 100]);
    vi.advanceTimersByTime(10);
    send([NOTE_ON, 60, 100]);

    expect(onGesture).toHaveBeenCalledTimes(1);
  });

  it('reports a press again once the debounce window has passed', async () => {
    const { input, send } = fakeInput();
    const { access } = fakeAccess([input]);
    const source = createMidiSource({ requestMIDIAccess: () => Promise.resolve(access) });
    const onGesture = vi.fn();
    source.subscribe(onGesture);
    await flushMicrotasks();

    send([NOTE_ON, 60, 100]);
    vi.advanceTimersByTime(31);
    send([NOTE_ON, 60, 100]);

    expect(onGesture).toHaveBeenCalledTimes(2);
  });

  it('does not debounce two different gestures arriving together', async () => {
    const { input, send } = fakeInput();
    const { access } = fakeAccess([input]);
    const source = createMidiSource({ requestMIDIAccess: () => Promise.resolve(access) });
    const onGesture = vi.fn();
    source.subscribe(onGesture);
    await flushMicrotasks();

    send([NOTE_ON, 60, 100]);
    send([NOTE_ON, 61, 100]);

    expect(onGesture).toHaveBeenCalledTimes(2);
  });

  it('follows port hot-plug: a device connected after subscribing still delivers presses', async () => {
    const { access, hotplug } = fakeAccess([]);
    const source = createMidiSource({ requestMIDIAccess: () => Promise.resolve(access) });
    const onGesture = vi.fn();
    source.subscribe(onGesture);
    await flushMicrotasks();

    const { input, send } = fakeInput();
    hotplug(input);
    send([NOTE_ON, 60, 100]);

    expect(onGesture).toHaveBeenCalledTimes(1);
  });

  it('stops listening once every subscriber has unsubscribed', async () => {
    const { input, send, listenerCount } = fakeInput();
    const { access } = fakeAccess([input]);
    const source = createMidiSource({ requestMIDIAccess: () => Promise.resolve(access) });
    const onGesture = vi.fn();
    const unsubscribe = source.subscribe(onGesture);
    await flushMicrotasks();
    expect(listenerCount()).toBe(1);

    unsubscribe();
    expect(listenerCount()).toBe(0);

    send([NOTE_ON, 60, 100]);
    expect(onGesture).not.toHaveBeenCalled();
  });

  it('only requests MIDI access once no matter how many subscribers come and go', async () => {
    const requestMIDIAccess = vi.fn(() => Promise.resolve(fakeAccess([]).access));
    const source = createMidiSource({ requestMIDIAccess });
    const unsubscribeA = source.subscribe(vi.fn());
    await flushMicrotasks();
    unsubscribeA();
    source.subscribe(vi.fn());
    await flushMicrotasks();

    expect(requestMIDIAccess).toHaveBeenCalledTimes(1);
  });

  it('offers the event to the most recently subscribed listener first, so it can consume it', async () => {
    const { input, send } = fakeInput();
    const { access } = fakeAccess([input]);
    const source = createMidiSource({ requestMIDIAccess: () => Promise.resolve(access) });
    const router = vi.fn();
    const recorder = vi.fn((event: GestureEvent) => event.preventDefault());
    source.subscribe(router); // subscribes first, like the router mounted at the app root
    await flushMicrotasks();
    source.subscribe(recorder); // subscribes later, like the Phase 6 recorder opening

    send([NOTE_ON, 60, 100]);

    expect(recorder).toHaveBeenCalledTimes(1);
    expect(router).not.toHaveBeenCalled();
  });

  it('still reaches an earlier subscriber when a later one does not consume the event', async () => {
    const { input, send } = fakeInput();
    const { access } = fakeAccess([input]);
    const source = createMidiSource({ requestMIDIAccess: () => Promise.resolve(access) });
    const router = vi.fn();
    const observer = vi.fn(); // does not call preventDefault
    source.subscribe(router);
    await flushMicrotasks();
    source.subscribe(observer);

    send([NOTE_ON, 60, 100]);

    expect(observer).toHaveBeenCalledTimes(1);
    expect(router).toHaveBeenCalledTimes(1);
  });

  it('goes back to reaching the remaining subscriber once the consuming one unsubscribes', async () => {
    const { input, send } = fakeInput();
    const { access } = fakeAccess([input]);
    const source = createMidiSource({ requestMIDIAccess: () => Promise.resolve(access) });
    const router = vi.fn();
    const recorder = vi.fn((event: GestureEvent) => event.preventDefault());
    source.subscribe(router);
    await flushMicrotasks();
    const unsubscribeRecorder = source.subscribe(recorder);

    unsubscribeRecorder();
    send([NOTE_ON, 60, 100]);

    expect(router).toHaveBeenCalledTimes(1);
  });
});

function fakeSource(): { subscribe: (onGesture: (event: GestureEvent) => void) => () => void; emit: (event: GestureEvent) => void } {
  let onGesture: ((event: GestureEvent) => void) | undefined;
  return {
    subscribe: vi.fn((handler: (event: GestureEvent) => void) => {
      onGesture = handler;
      return vi.fn();
    }),
    emit: (event: GestureEvent) => onGesture?.(event),
  };
}

describe('combineSources', () => {
  it('delivers a gesture from either source', () => {
    const sourceA = fakeSource();
    const sourceB = fakeSource();
    const combined = combineSources(sourceA, sourceB);
    const onGesture = vi.fn();
    combined.subscribe(onGesture);

    sourceA.emit({ gesture: gesture('keyboard', 'Space'), target: null, preventDefault: vi.fn() });
    sourceB.emit({ gesture: gesture('midi', 'note/1/60'), target: null, preventDefault: vi.fn() });

    expect(onGesture).toHaveBeenCalledTimes(2);
  });

  it('unsubscribes every underlying source', () => {
    const unsubscribeA = vi.fn();
    const unsubscribeB = vi.fn();
    const sourceA = { subscribe: vi.fn(() => unsubscribeA) };
    const sourceB = { subscribe: vi.fn(() => unsubscribeB) };
    const combined = combineSources(sourceA, sourceB);

    const unsubscribe = combined.subscribe(vi.fn());
    unsubscribe();

    expect(unsubscribeA).toHaveBeenCalledTimes(1);
    expect(unsubscribeB).toHaveBeenCalledTimes(1);
  });
});

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
