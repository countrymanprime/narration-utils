/**
 * Wikimedia Commons audio links read from Wiktextract's own offline pronunciation data (Go: `apps/desktop/internal/wiktextract`,
 * `apps/desktop/bindings_wiktextract_commons.go`; `docs/prds/prep-depth.prd.md` Phase 10, D72, Open Question Q12; `#782`). One
 * word at a time, opened externally through the same host path `PronunciationLookupOpen` already uses - never fetched, streamed
 * or cached by the app itself.
 */
export interface PronunciationCommonsAudioApi {
  /**
   * Opens the Commons recording Wiktextract's own index names for word in the narrator's default browser or media
   * player, and nothing else. word crosses the boundary, never a URL: the address is always built server-side from
   * the installed index's own Commons file name, so nothing this call passes can pick an arbitrary destination. Rejects
   * with a clear reason when the Wiktextract source is not installed, or has no audio file name for word.
   */
  pronunciationCommonsAudioOpen(word: string): Promise<void>;
}
