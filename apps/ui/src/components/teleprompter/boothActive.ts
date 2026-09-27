// Whether the booth (BoothView.tsx) is currently mounted (booth-mode-and-companion-panel.prd.md Phase 5): a tiny,
// app-wide flag `useBoothRecording` reads, since the toast dispatcher it guards (App.tsx) sits well outside the
// booth's own component tree and has no other way to know. Plain module state rather than a context: there is
// exactly one narrator-facing booth surface at a time (the Risks table's "one active session" invariant), so one
// flag is enough, and a context would need providing from the app root for one boolean only App.tsx reads.
let active = false;
const listeners = new Set<() => void>();

export function setBoothActive(value: boolean): void {
  if (active === value) return;
  active = value;
  for (const listener of listeners) listener();
}

export function boothIsActive(): boolean {
  return active;
}

export function subscribeBoothActive(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
