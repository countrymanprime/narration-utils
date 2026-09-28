// Per-viewer reading preferences of the read-aloud dialog (teleprompter-manuscript-integration.prd.md, Decisions Log,
// "Per-viewer reading preferences", owner decision 2026-09-23): UI layout lives in browser storage, machine facts
// (microphone, engine, model) in global settings. Storage can be missing, full or blocked (a private window, cleared
// site data), so every access is guarded and the dialog renders with the defaults when it fails.

import { DEFAULT_FLAG_VISIBILITY, FLAG_KINDS, type FlagVisibility } from './readerFlags';

const RAIL_TABS = ['key', 'flags', 'notes', 'bible'] as const;
export type RailTab = (typeof RAIL_TABS)[number];
export type RailState = { open: boolean; tab: RailTab };

export const RAIL_STORAGE_KEY = 'narration.readAloud.rail';
export const DEFAULT_RAIL: RailState = { open: true, tab: 'key' };

const isRailTab = (value: unknown): value is RailTab => typeof value === 'string' && (RAIL_TABS as readonly string[]).includes(value);

/** The stored rail state, or the default when nothing usable is stored (absent, unreadable, or not the shape written below). */
export function loadRailState(): RailState {
  try {
    const raw = window.localStorage.getItem(RAIL_STORAGE_KEY);
    if (!raw) return DEFAULT_RAIL;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return DEFAULT_RAIL;
    const { open, tab } = parsed as Record<string, unknown>;
    return { open: typeof open === 'boolean' ? open : DEFAULT_RAIL.open, tab: isRailTab(tab) ? tab : DEFAULT_RAIL.tab };
  } catch {
    return DEFAULT_RAIL;
  }
}

export function saveRailState(state: RailState): void {
  try {
    window.localStorage.setItem(RAIL_STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* storage unavailable: the choice lasts for this dialog only */
  }
}

// Which flag kinds show in the text (Phase 7): a per-viewer reading preference like the rail, starting from the owner's default.
export const FLAG_STORAGE_KEY = 'narration.readAloud.flags';

/** The stored flag kinds to show; any kind stored as anything but a boolean takes its default. */
export function loadFlagVisibility(): FlagVisibility {
  try {
    const raw = window.localStorage.getItem(FLAG_STORAGE_KEY);
    if (!raw) return DEFAULT_FLAG_VISIBILITY;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return DEFAULT_FLAG_VISIBILITY;
    const stored = parsed as Record<string, unknown>;
    return Object.fromEntries(
      FLAG_KINDS.map((kind) => [kind, typeof stored[kind] === 'boolean' ? stored[kind] : DEFAULT_FLAG_VISIBILITY[kind]]),
    ) as FlagVisibility;
  } catch {
    return DEFAULT_FLAG_VISIBILITY;
  }
}

export function saveFlagVisibility(visibility: FlagVisibility): void {
  try {
    window.localStorage.setItem(FLAG_STORAGE_KEY, JSON.stringify(visibility));
  } catch {
    /* storage unavailable: the choice lasts for this dialog only */
  }
}
