// Per-viewer reading preferences of the read-aloud dialog (teleprompter-manuscript-integration.prd.md, Decisions Log,
// "Per-viewer reading preferences", owner decision 2026-09-23): UI layout lives in browser storage, machine facts
// (microphone, engine, model) in global settings. Storage can be missing, full or blocked (a private window, cleared
// site data), so every access is guarded and the dialog renders with the defaults when it fails.

const RAIL_TABS = ['key', 'notes', 'bible'] as const;
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
