import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { combineSources } from './MidiSource';
import { gesture } from './gestures';
import { createHidSource, requestHidDevice, type HidDeviceLike, type HidInputReportEventLike, type HidLike } from './HidSource';
import type { GestureEvent } from './InputSource';

type ReportListener = (event: HidInputReportEventLike) => void;

function fakeDevice(vendorId = 0x046d, productId = 0xc52b) {
  const listeners: ReportListener[] = [];
  let opened = false;
  let openCalls = 0;
  let failOpen = false;

  const device: HidDeviceLike = {
    vendorId,
    productId,
    get opened() {
      return opened;
    },
    open: () => {
      openCalls++;
      if (failOpen) return Promise.reject(new Error('open denied'));
      opened = true;
      return Promise.resolve();
    },
    addEventListener: (_type, listener) => {
      listeners.push(listener);
    },
    removeEventListener: (_type, listener) => {
      const index = listeners.indexOf(listener);
      if (index !== -1) listeners.splice(index, 1);
    },
  };

  return {
    device,
    sendReport: (reportId: number, bytes: number[]) => {
      const data = new DataView(new Uint8Array(bytes).buffer);
      for (const listener of [...listeners]) listener({ device, reportId, data });
    },
    listenerCount: () => listeners.length,
    openCalls: () => openCalls,
    setFailOpen: () => {
      failOpen = true;
    },
  };
}

function fakeHid(initialDevices: HidDeviceLike[] = []) {
  const devices = [...initialDevices];
  const connectListeners: Array<() => void> = [];
  const disconnectListeners: Array<(event: { device: HidDeviceLike }) => void> = [];
  const requestDevice = vi.fn(() => Promise.resolve<HidDeviceLike[]>([]));

  const hid: HidLike = {
    getDevices: () => Promise.resolve([...devices]),
    requestDevice,
    addEventListener: (type, listener) => {
      if (type === 'connect') connectListeners.push(listener as () => void);
      else disconnectListeners.push(listener as (event: { device: HidDeviceLike }) => void);
    },
    removeEventListener: (type, listener) => {
      const list = type === 'connect' ? connectListeners : disconnectListeners;
      const index = list.indexOf(listener as never);
      if (index !== -1) list.splice(index, 1);
    },
  };

  return {
    hid,
    requestDevice,
    hotplug: (device: HidDeviceLike) => {
      devices.push(device);
      connectListeners.forEach((listener) => listener());
    },
    disconnect: (device: HidDeviceLike) => {
      const index = devices.indexOf(device);
      if (index !== -1) devices.splice(index, 1);
      disconnectListeners.forEach((listener) => listener({ device }));
    },
  };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('createHidSource', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does nothing when the platform has no navigator.hid (Phase 8: WKWebView, WebKitGTK)', async () => {
    const source = createHidSource({});
    const onGesture = vi.fn();
    source.subscribe(onGesture);
    await flushMicrotasks();
    expect(onGesture).not.toHaveBeenCalled();
  });

  it('does nothing when getDevices() rejects', async () => {
    const hid: HidLike = {
      getDevices: () => Promise.reject(new Error('gone')),
      requestDevice: () => Promise.resolve([]),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    const source = createHidSource({ hid });
    const onGesture = vi.fn();
    source.subscribe(onGesture);
    await flushMicrotasks();
    expect(onGesture).not.toHaveBeenCalled();
  });

  it('does not fire on a device’s very first report (no baseline yet, so an already-held button stays silent)', async () => {
    const { device, sendReport } = fakeDevice();
    const { hid } = fakeHid([device]);
    const source = createHidSource({ hid });
    const onGesture = vi.fn();
    source.subscribe(onGesture);
    await flushMicrotasks();

    sendReport(0, [0b00001000]);

    expect(onGesture).not.toHaveBeenCalled();
  });

  it('reports a bit rising from 0 to 1 as a press, coded hid:<vid>:<pid>/<byte>.<bit>', async () => {
    const { device, sendReport } = fakeDevice(0x046d, 0xc52b);
    const { hid } = fakeHid([device]);
    const source = createHidSource({ hid });
    const onGesture = vi.fn();
    source.subscribe(onGesture);
    await flushMicrotasks();

    sendReport(0, [0]); // baseline
    sendReport(0, [0b00001000]); // bit 3 rises

    expect(onGesture).toHaveBeenCalledTimes(1);
    const event: GestureEvent = onGesture.mock.calls[0][0];
    expect(event.gesture).toEqual(gesture('hid', '046d:c52b/0.0.3'));
    expect(event.target).toBeNull();
  });

  it('does not re-fire while the bit stays high (only the edge is a press, not the level)', async () => {
    const { device, sendReport } = fakeDevice();
    const { hid } = fakeHid([device]);
    const source = createHidSource({ hid });
    const onGesture = vi.fn();
    source.subscribe(onGesture);
    await flushMicrotasks();

    sendReport(0, [0]);
    sendReport(0, [1]);
    vi.advanceTimersByTime(1000);
    sendReport(0, [1]);

    expect(onGesture).toHaveBeenCalledTimes(1);
  });

  it('fires again once the bit falls and rises again, after the debounce window', async () => {
    const { device, sendReport } = fakeDevice();
    const { hid } = fakeHid([device]);
    const source = createHidSource({ hid });
    const onGesture = vi.fn();
    source.subscribe(onGesture);
    await flushMicrotasks();

    sendReport(0, [0]);
    sendReport(0, [1]);
    vi.advanceTimersByTime(31);
    sendReport(0, [0]);
    sendReport(0, [1]);

    expect(onGesture).toHaveBeenCalledTimes(2);
  });

  it('debounces a rapidly bouncing button within 30ms', async () => {
    const { device, sendReport } = fakeDevice();
    const { hid } = fakeHid([device]);
    const source = createHidSource({ hid });
    const onGesture = vi.fn();
    source.subscribe(onGesture);
    await flushMicrotasks();

    sendReport(0, [0]);
    sendReport(0, [1]);
    vi.advanceTimersByTime(10);
    sendReport(0, [0]); // contact bounce
    sendReport(0, [1]);

    expect(onGesture).toHaveBeenCalledTimes(1);
  });

  it('does not debounce two different buttons arriving together', async () => {
    const { device, sendReport } = fakeDevice();
    const { hid } = fakeHid([device]);
    const source = createHidSource({ hid });
    const onGesture = vi.fn();
    source.subscribe(onGesture);
    await flushMicrotasks();

    sendReport(0, [0]);
    sendReport(0, [0b00000011]);

    expect(onGesture).toHaveBeenCalledTimes(2);
  });

  it('reports more than one rising bit from the same report (chording)', async () => {
    const { device, sendReport } = fakeDevice();
    const { hid } = fakeHid([device]);
    const source = createHidSource({ hid });
    const onGesture = vi.fn();
    source.subscribe(onGesture);
    await flushMicrotasks();

    sendReport(0, [0]);
    sendReport(0, [0b00000101]);

    expect(onGesture).toHaveBeenCalledTimes(2);
    expect(onGesture.mock.calls[0][0].gesture.code).toMatch(/\/0\.0\.0$/);
    expect(onGesture.mock.calls[1][0].gesture.code).toMatch(/\/0\.0\.2$/);
  });

  it('ignores an empty report', async () => {
    const { device, sendReport } = fakeDevice();
    const { hid } = fakeHid([device]);
    const source = createHidSource({ hid });
    const onGesture = vi.fn();
    source.subscribe(onGesture);
    await flushMicrotasks();

    sendReport(0, [0]);
    sendReport(0, []);

    expect(onGesture).not.toHaveBeenCalled();
  });

  it('drops a report larger than a real HID interrupt transfer, instead of scanning it', async () => {
    const { device, sendReport } = fakeDevice();
    const { hid } = fakeHid([device]);
    const source = createHidSource({ hid });
    const onGesture = vi.fn();
    source.subscribe(onGesture);
    await flushMicrotasks();

    sendReport(0, new Array(65).fill(0)); // baseline, over the cap
    sendReport(0, new Array(65).fill(1));

    expect(onGesture).not.toHaveBeenCalled();
  });

  it('tracks each report id on a device separately', async () => {
    const { device, sendReport } = fakeDevice();
    const { hid } = fakeHid([device]);
    const source = createHidSource({ hid });
    const onGesture = vi.fn();
    source.subscribe(onGesture);
    await flushMicrotasks();

    sendReport(1, [0]);
    sendReport(2, [0]);
    sendReport(1, [1]);
    sendReport(2, [1]);

    expect(onGesture).toHaveBeenCalledTimes(2);
  });

  it('follows hot-plug: a device connected after subscribing still delivers presses', async () => {
    const { hid, hotplug } = fakeHid([]);
    const source = createHidSource({ hid });
    const onGesture = vi.fn();
    source.subscribe(onGesture);
    await flushMicrotasks();

    const { device, sendReport } = fakeDevice();
    hotplug(device);
    await flushMicrotasks();
    sendReport(0, [0]);
    sendReport(0, [1]);

    expect(onGesture).toHaveBeenCalledTimes(1);
  });

  it('forgets a disconnected device, so reconnecting needs a fresh baseline', async () => {
    const { device, sendReport } = fakeDevice();
    const { hid, disconnect, hotplug } = fakeHid([device]);
    const source = createHidSource({ hid });
    const onGesture = vi.fn();
    source.subscribe(onGesture);
    await flushMicrotasks();

    sendReport(0, [0]);
    disconnect(device);
    hotplug(device);
    await flushMicrotasks();
    sendReport(0, [1]); // first report again after reconnect: no baseline, must not fire

    expect(onGesture).not.toHaveBeenCalled();
  });

  it('opens a device only once', async () => {
    const { device, sendReport, openCalls } = fakeDevice();
    const { hid } = fakeHid([device]);
    const source = createHidSource({ hid });
    const unsubscribe = source.subscribe(vi.fn());
    await flushMicrotasks();
    unsubscribe();
    source.subscribe(vi.fn());
    await flushMicrotasks();

    sendReport(0, [0]);

    expect(openCalls()).toBe(1);
  });

  it('stops listening once every subscriber has unsubscribed, and resumes on resubscribe', async () => {
    const { device, sendReport, listenerCount } = fakeDevice();
    const { hid } = fakeHid([device]);
    const source = createHidSource({ hid });
    const onGesture = vi.fn();
    const unsubscribe = source.subscribe(onGesture);
    await flushMicrotasks();
    expect(listenerCount()).toBe(1);

    unsubscribe();
    expect(listenerCount()).toBe(0);
    sendReport(0, [1]);
    expect(onGesture).not.toHaveBeenCalled();

    source.subscribe(onGesture);
    await flushMicrotasks();
    expect(listenerCount()).toBe(1);
  });

  it('retries opening a device that failed to open on the next attach, and never fires from it', async () => {
    const { device, sendReport, openCalls, setFailOpen } = fakeDevice();
    setFailOpen();
    const { hid } = fakeHid([device]);
    const source = createHidSource({ hid });
    const onGesture = vi.fn();
    const unsubscribe = source.subscribe(onGesture);
    await flushMicrotasks();
    unsubscribe();
    source.subscribe(onGesture);
    await flushMicrotasks();

    expect(openCalls()).toBe(2);
    sendReport(0, [1]);
    expect(onGesture).not.toHaveBeenCalled();
  });

  it('offers the event to the most recently subscribed listener first, so it can consume it', async () => {
    const { device, sendReport } = fakeDevice();
    const { hid } = fakeHid([device]);
    const source = createHidSource({ hid });
    const router = vi.fn();
    const recorder = vi.fn((event: GestureEvent) => event.preventDefault());
    source.subscribe(router); // subscribes first, like the router mounted at the app root
    await flushMicrotasks();
    source.subscribe(recorder); // subscribes later, like the Phase 6 recorder opening

    sendReport(0, [0]);
    sendReport(0, [1]);

    expect(recorder).toHaveBeenCalledTimes(1);
    expect(router).not.toHaveBeenCalled();
  });

  it('still reaches an earlier subscriber when a later one does not consume the event', async () => {
    const { device, sendReport } = fakeDevice();
    const { hid } = fakeHid([device]);
    const source = createHidSource({ hid });
    const router = vi.fn();
    const observer = vi.fn();
    source.subscribe(router);
    await flushMicrotasks();
    source.subscribe(observer);

    sendReport(0, [0]);
    sendReport(0, [1]);

    expect(observer).toHaveBeenCalledTimes(1);
    expect(router).toHaveBeenCalledTimes(1);
  });
});

describe('createHidSource combined with combineSources', () => {
  it('delivers a HID gesture alongside another source', () => {
    const fakeOther = {
      subscribe: vi.fn((handler: (event: GestureEvent) => void) => {
        handler({ gesture: gesture('keyboard', 'Space'), target: null, preventDefault: vi.fn() });
        return vi.fn();
      }),
    };
    const hidLike = { subscribe: vi.fn(() => vi.fn()) };
    const combined = combineSources(fakeOther, hidLike);
    const onGesture = vi.fn();
    combined.subscribe(onGesture);

    expect(onGesture).toHaveBeenCalledTimes(1);
    expect(hidLike.subscribe).toHaveBeenCalledTimes(1);
  });
});

describe('requestHidDevice', () => {
  it('does nothing when the platform has no navigator.hid', async () => {
    await expect(requestHidDevice({})).resolves.toBeUndefined();
  });

  it('calls navigator.hid.requestDevice with no filters', async () => {
    const { hid, requestDevice } = fakeHid();
    await requestHidDevice({ hid });
    expect(requestDevice).toHaveBeenCalledWith({ filters: [] });
  });

  it('swallows a rejection (the narrator cancelled the chooser, or none ever appeared)', async () => {
    const hid: HidLike = {
      getDevices: () => Promise.resolve([]),
      requestDevice: () => Promise.reject(new Error('cancelled')),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    await expect(requestHidDevice({ hid })).resolves.toBeUndefined();
  });
});
