/**
 * One catalog entry as `DawCatalogList` answers it (Go: `apps/desktop/dawcatalog.go`'s `DawCatalogEntry`,
 * docs/architecture/daw-integration.md): the catalog copy plus an on-demand detection fact.
 * `path` and `source` are only set when `installed` is true (`source` mirrors `apps/desktop/internal/daw`'s
 * `Source*` constants, e.g. `uninstall_registry`), so the UI can tell the narrator how confident the detection is.
 */
export type DawCatalogEntry = {
  id: string;
  name: string;
  publisher: string;
  licenseNote: string;
  installed: boolean;
  path?: string;
  source?: string;
};

export interface DawCatalogApi {
  /** The DAW catalog (REAPER only today) with each entry's detection state. Runs detection fresh every call - on demand, never polled. */
  dawCatalogList(): Promise<DawCatalogEntry[]>;
  /**
   * Opens the catalog entry `id`'s official download page in the narrator's default browser. Never downloads,
   * verifies or executes anything itself - the id crosses the boundary, never a URL, so the destination is
   * always the host's own hardcoded catalog entry.
   */
  dawCatalogOpenDownloadPage(id: string): Promise<void>;
}
