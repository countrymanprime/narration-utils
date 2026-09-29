// The last chapter the narrator looked at on Proof, per project (ADR 0750, D100): the book-level waveform card opens on it.
// A per-viewer convenience in browser storage, like readerPreferences.ts and creditsExpandedStorage.ts, never a host field.
// Storage can be missing, full or blocked (a private window, cleared site data), so every access is guarded and the card
// falls back to the first narration chapter when nothing is stored or storage fails.

const storageKey = (projectFolder: string): string => `narration.proof.lastChapter.${projectFolder}`;

export function loadLastChapter(projectFolder: string): string {
  try {
    return window.localStorage.getItem(storageKey(projectFolder)) ?? '';
  } catch {
    return '';
  }
}

export function saveLastChapter(projectFolder: string, chapterId: string): void {
  if (!chapterId) return;
  try {
    window.localStorage.setItem(storageKey(projectFolder), chapterId);
  } catch {
    /* storage unavailable: the choice lasts for this visit only */
  }
}
