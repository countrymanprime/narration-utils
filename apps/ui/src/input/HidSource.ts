import { gesture } from './gestures';
import type { GestureEvent, InputSource } from './InputSource';

const DEBOUNCE_MS = 30;
// A generous cap over the largest interrupt-transfer report a real HID device sends (threat-model.md row 11a):
// nothing here trusts a device to keep its reports small, so an oversized one is dropped instead of scanned.
const MAX_REPORT_BYTES = 64;

function toHex(id: number): string {
  return id.toString(16).padStart(4, '0');
}

/**
 * A press is a bit rising from 0 to 1 somewhere in the report, compared against the same device's and report id's
 * last-seen bytes. Unlike MIDI's fixed 3-byte status/data1/data2 shape (`MidiSource.ts`), a WebHID report has no
 * shape the browser hands us at all - `HIDDevice.collections` describes it per device, and this source deliberately
 * does not parse that: it just watches for the bit-level edge a simple USB button or pedal's report produces,
 * whatever byte or bit a particular device happens to use, the same idle-0/pressed-1 convention the USB HID button
 * usage page itself defines. The report id is part of every code (`<reportId>.<byteIndex>.<bit>`): a device with more
 * than one numbered report can reuse the same byte and bit position for an unrelated button in a different report,
 * so the id must disambiguate them, not just tell them apart for the 30 ms debounce below. Returns every code that
 * newly went high, in case one report flips more than one button (chording, or two pedals sharing a device).
 *
 * Returns `[]`, never guesses, for a device's very first report of a given report id (no baseline yet, so a button
 * already held down when the app opens must not fire) and for a report bigger than a real HID interrupt transfer
 * ever is or an empty one (threat-model.md row 11a) - the same "drop rather than guess" discipline `MidiSource`'s
 * parser uses for a malformed MIDI message.
 */
function pressCodesFromReport(previous: Uint8Array | undefined, data: DataView, reportId: number): string[] {
  if (data.byteLength === 0 || data.byteLength > MAX_REPORT_BYTES || !previous) return [];
  const codes: string[] = [];
  for (let byteIndex = 0; byteIndex < data.byteLength; byteIndex++) {
    const before = previous[byteIndex] ?? 0;
    const after = data.getUint8(byteIndex);
    const risen = after & ~before & 0xff;
    if (risen === 0) continue;
    for (let bit = 0; bit < 8; bit++) {
      if (risen & (1 << bit)) codes.push(`${reportId}.${byteIndex}.${bit}`);
    }
  }
  return codes;
}

/** The subset of `HIDInputReportEvent` this source needs. */
export type HidInputReportEventLike = { device: HidDeviceLike; reportId: number; data: DataView };

/** The subset of `HIDDevice` this source needs. A real `HIDDevice` satisfies this structurally. */
export type HidDeviceLike = {
  vendorId: number;
  productId: number;
  opened: boolean;
  open(): Promise<void>;
  addEventListener(type: 'inputreport', listener: (event: HidInputReportEventLike) => void): void;
  removeEventListener(type: 'inputreport', listener: (event: HidInputReportEventLike) => void): void;
};

/** The subset of `HID` (`navigator.hid`) this source needs. */
export type HidLike = {
  getDevices(): Promise<HidDeviceLike[]>;
  requestDevice(options: { filters: unknown[] }): Promise<HidDeviceLike[]>;
  addEventListener(type: 'connect' | 'disconnect', listener: (event: { device: HidDeviceLike }) => void): void;
  removeEventListener(type: 'connect' | 'disconnect', listener: (event: { device: HidDeviceLike }) => void): void;
};

type NavigatorLike = { hid?: HidLike };

const realNavigator: NavigatorLike = typeof navigator === 'undefined' ? {} : (navigator as unknown as NavigatorLike);

/**
 * The Could input source (Solution Detail, Phase 11): WebHID button presses, gated on Phase 8's spike actually
 * finding the API usable (its own recommendation was "do not start before a real WebView2 build confirms the device
 * chooser renders" - unconfirmed, not a clean yes). Feature-detected (`navigatorLike.hid` absent) exactly like
 * `MidiSource`, so a platform without it - Phase 8 found neither WKWebView (macOS) nor WebKitGTK 6.0 (Linux) ship
 * WebHID either - simply contributes nothing.
 *
 * Unlike `createMidiSource`, this never calls `requestDevice()` itself: WebHID requires a transient user gesture for
 * that call, so it can only ever run from inside a click handler, not automatically on subscribe. This source only
 * ever attaches to devices already granted (`navigator.hid.getDevices()`), plus whatever `requestHidDevice` below
 * pairs later; `getDevices()` and the `connect`/`disconnect` events need no gesture, so pairing survives a reload and
 * a hot-plug still following an already-granted device.
 *
 * Follows hot-plug through `navigator.hid`'s own `connect`/`disconnect` events (mirroring `MIDIAccess.onstatechange`)
 * and debounces a repeated press of the same gesture within 30 ms, for the same contact-bounce reason `MidiSource`
 * does.
 *
 * A gesture reaches every current subscriber, most recently subscribed first, and a subscriber that calls
 * `preventDefault()` stops it going to the rest - the same priority contract `MidiSource` documents, so the Phase 6
 * recorder can learn a press without the router also running whatever command that gesture already happens to be
 * bound to.
 */
export function createHidSource(navigatorLike: NavigatorLike = realNavigator): InputSource {
  const subscribers: Array<(event: GestureEvent) => void> = [];
  const lastFired = new Map<string, number>();
  const knownDevices = new Set<HidDeviceLike>();
  const attached = new Set<HidDeviceLike>();
  const lastReport = new Map<HidDeviceLike, Map<number, Uint8Array>>();
  const listeners = new Map<HidDeviceLike, (event: HidInputReportEventLike) => void>();
  let requested = false;

  const dispatch = (code: string) => {
    if (subscribers.length === 0) return;
    const now = Date.now();
    const last = lastFired.get(code);
    if (last !== undefined && now - last < DEBOUNCE_MS) return;
    lastFired.set(code, now);

    let consumed = false;
    const event: GestureEvent = {
      gesture: gesture('hid', code),
      target: null,
      preventDefault: () => {
        consumed = true;
      },
    };
    for (let i = subscribers.length - 1; i >= 0 && !consumed; i--) subscribers[i](event);
  };

  const listenerFor = (device: HidDeviceLike) => {
    let listener = listeners.get(device);
    if (listener) return listener;
    listener = (event) => {
      const reports = lastReport.get(device) ?? new Map<number, Uint8Array>();
      lastReport.set(device, reports);
      const previous = reports.get(event.reportId);
      const codes = pressCodesFromReport(previous, event.data, event.reportId);
      const bytes = new Uint8Array(event.data.buffer, event.data.byteOffset, event.data.byteLength);
      reports.set(event.reportId, bytes.slice());
      const prefix = `${toHex(device.vendorId)}:${toHex(device.productId)}/`;
      for (const suffix of codes) dispatch(prefix + suffix);
    };
    listeners.set(device, listener);
    return listener;
  };

  const attachDevices = () => {
    knownDevices.forEach((device) => {
      if (attached.has(device)) return;
      const listener = listenerFor(device);
      const listen = () => {
        if (attached.has(device)) return;
        attached.add(device);
        device.addEventListener('inputreport', listener);
      };
      if (device.opened) listen();
      else
        device
          .open()
          .then(listen)
          .catch(() => {
            // The OS denied opening the device, or it was unplugged before the open finished; it just never starts
            // reporting - the same silent "contributes nothing" degrade `MidiSource` uses for a rejected permission.
          });
    });
  };

  const detachDevices = () => {
    attached.forEach((device) => device.removeEventListener('inputreport', listeners.get(device)!));
    attached.clear();
  };

  const forgetDevice = (device: HidDeviceLike) => {
    knownDevices.delete(device);
    attached.delete(device);
    lastReport.delete(device);
    listeners.delete(device);
  };

  const refresh = () => {
    navigatorLike
      .hid!.getDevices()
      .then((devices) => {
        for (const device of devices) knownDevices.add(device);
        if (subscribers.length > 0) attachDevices();
      })
      .catch(() => {
        // getDevices() itself failing (an unsupported or torn-down navigator.hid) leaves this source with no
        // devices; KeyboardSource and MidiSource still cover the booth, so it just contributes nothing.
      });
  };

  const ensureAccess = () => {
    if (requested) return;
    requested = true;
    if (!navigatorLike.hid) return;
    navigatorLike.hid.addEventListener('connect', refresh);
    navigatorLike.hid.addEventListener('disconnect', (event) => forgetDevice(event.device));
    refresh();
  };

  return {
    subscribe(onGesture) {
      subscribers.push(onGesture);
      if (requested) attachDevices();
      else ensureAccess();
      return () => {
        const index = subscribers.indexOf(onGesture);
        if (index !== -1) subscribers.splice(index, 1);
        if (subscribers.length === 0) detachDevices();
      };
    },
  };
}

/**
 * Shows the browser's HID device chooser so the narrator can pair a new pedal (Phase 11). Unlike Web MIDI, WebHID
 * requires a transient user gesture for `requestDevice()`, so - unlike `createMidiSource`, which asks for access on
 * first subscribe - `createHidSource` above never calls this itself; it is meant to run from a future Keyboard &
 * pedals "Connect a pedal" button's click handler (not yet built - out of this phase's `src/input/hid*` scope).
 * Once granted, `createHidSource`'s own `connect` listener picks the device up the same way it would a hot-plugged
 * already-granted one, with no extra wiring here.
 */
export async function requestHidDevice(navigatorLike: NavigatorLike = realNavigator): Promise<void> {
  if (!navigatorLike.hid) return;
  try {
    await navigatorLike.hid.requestDevice({ filters: [] });
  } catch {
    // The narrator dismissed the chooser, or - Phase 8's spike found this plausible on WebView2 - no chooser ever
    // appeared at all; either way there is nothing to recover here beyond "no device got paired this time".
  }
}

/**
 * The one instance `main.tsx` and a future recorder both subscribe to, so the priority rule documented above is
 * real, the same reasoning as `midiSource`.
 */
export const hidSource: InputSource = createHidSource();
