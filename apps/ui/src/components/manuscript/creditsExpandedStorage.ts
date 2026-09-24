// Whether the Opening/Closing credits cards are open, per project (manuscript-credits-card-parity.prd.md, MC5 b): a
// per-viewer convenience in browser storage, like readerPreferences.ts, never a host reader-state field - a credits id
// never goes into expandedChapters or readerStateSave. Storage can be missing, full or blocked (a private window,
// cleared site data), so every access is guarded and a credits card opens by default (MC5) when nothing is stored or
// storage fails.

export type CreditsExpanded = { opening: boolean; closing: boolean };

export const DEFAULT_CREDITS_EXPANDED: CreditsExpanded = { opening: true, closing: true };

const storageKey = (projectFolder: string): string => `narration.manuscript.creditsExpanded.${projectFolder}`;

export function loadCreditsExpanded(projectFolder: string): CreditsExpanded {
  try {
    const raw = window.localStorage.getItem(storageKey(projectFolder));
    if (!raw) return DEFAULT_CREDITS_EXPANDED;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return DEFAULT_CREDITS_EXPANDED;
    const { opening, closing } = parsed as Record<string, unknown>;
    return {
      opening: typeof opening === 'boolean' ? opening : DEFAULT_CREDITS_EXPANDED.opening,
      closing: typeof closing === 'boolean' ? closing : DEFAULT_CREDITS_EXPANDED.closing,
    };
  } catch {
    return DEFAULT_CREDITS_EXPANDED;
  }
}

export function saveCreditsExpanded(projectFolder: string, state: CreditsExpanded): void {
  try {
    window.localStorage.setItem(storageKey(projectFolder), JSON.stringify(state));
  } catch {
    /* storage unavailable: the choice lasts for this visit only */
  }
}
