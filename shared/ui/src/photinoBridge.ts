// Bridges Photino's raw WebMessageReceived/SendWebMessage channel into the
// same window.pywebview.api surface (and 'pywebviewready' event) the pywebview
// host used to provide, so App.tsx/state.ts need no changes across hub
// implementations. A no-op outside Photino (e.g. `npm run dev` in a browser).
import type { NarrationApi } from './types';

// lib.dom.d.ts already declares window.external as the legacy IE `External`
// type, so this can't be a `declare global` augmentation of Window without
// conflicting with it - cast through this narrower shape at the call sites
// instead of trying to redeclare the global.
interface PhotinoExternal {
  sendMessage?: (message: string) => void;
  receiveMessage?: (callback: (message: string) => void) => void;
}
const external = (): PhotinoExternal | undefined => (window as unknown as { external?: PhotinoExternal }).external;

const METHODS: (keyof NarrationApi)[] = [
  'ready', 'bootstrap', 'poll', 'selectManuscript', 'saveSettings',
  'guideBuild', 'guideIndex', 'guideEdit', 'guideExport', 'guidePreview',
  'transcriptStart', 'transcriptCancel', 'transcriptAddEquivalence',
  'transcriptJump', 'transcriptSuggestHints', 'reportClientDiagnostic',
];

type PendingCall = { resolve: (value: unknown) => void; reject: (reason: unknown) => void };

function installPhotinoBridge(): void {
  const ext = external();
  if (typeof ext?.sendMessage !== 'function' || typeof ext?.receiveMessage !== 'function') return;

  let nextId = 1;
  const pending = new Map<number, PendingCall>();

  ext.receiveMessage((raw: string) => {
    let parsed: { id?: number; result?: unknown; error?: string };
    try { parsed = JSON.parse(raw); } catch { return; }
    if (typeof parsed.id !== 'number') return;
    const waiting = pending.get(parsed.id);
    if (!waiting) return;
    pending.delete(parsed.id);
    if (parsed.error !== undefined) waiting.reject(new Error(parsed.error));
    else waiting.resolve(parsed.result);
  });

  const call = (method: string, ...args: unknown[]) => new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    ext.sendMessage!(JSON.stringify({ id, method, args }));
  });

  const api = Object.fromEntries(METHODS.map((name) => [name, (...args: unknown[]) => call(name, ...args)])) as unknown as NarrationApi;
  window.pywebview = { api };
  window.dispatchEvent(new Event('pywebviewready'));
}

installPhotinoBridge();
