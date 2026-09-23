// The pickup list (reaper-automation-follow-through PRD, Phase 9): import a proofer's CSV, jump to the next open
// pickup, resolve it, export the remaining list. Mirrors apps/desktop/internal/pickups.Service.Snapshot() exactly:
// one run (import, export, jump or resolve or count) at a time, reported by phase, with remaining/total surviving
// between runs so the count does not flash back to zero while a different action is in flight.

export type PickupsPhase = 'idle' | 'importing' | 'exporting' | 'jumping' | 'resolving' | 'counting' | 'success' | 'error';

/** One pickup the narrator jumped to, or resolved: the marker's project time in seconds, its optional tag, and its note. */
export type PickupsMoment = {
  position: number;
  tag: string;
  note: string;
};

/** What the last Import run found, once REAPER answers: how many markers it actually added, how many were
 * already there (idempotent re-import), and how many payload rows Lua itself rejected (Go already validates
 * every row before sending, so this is normally 0, but the same defensiveness as everywhere else on this wire
 * applies here too). */
export type PickupsImportReport = {
  added: number;
  existing: number;
  invalid: number;
};

export type PickupsState = {
  runId?: string;
  phase: PickupsPhase;
  message: string;
  /** How many pickups are still open, and how many exist in total (open plus resolved); from the last Count. */
  remaining: number;
  total: number;
  /** Set after a successful Next. */
  next?: PickupsMoment;
  /** Set after a successful Resolve. */
  resolved?: PickupsMoment;
  /** Set after a successful Import. */
  importReport?: PickupsImportReport;
  /** The remaining pickups, as CSV text (header start,note,tag); set after a successful Export, ready to
   * offer as a download with no second round trip. */
  csv: string;
};

/** PickupsImport's answer: the run has started, plus every CSV row Go could not use (line number and why),
 * reported rather than silently dropped. */
export type PickupsImportResult = {
  status: 'started';
  rowErrors: string[];
};

export type PickupsStartResult = { status: 'started' };

export interface PickupsApi {
  /** Parses and validates csvText (columns start,note,tag; an optional header row) in Go and, if any row is
   * usable, writes the payload and asks REAPER to import it. Throws when every row is unusable. */
  pickupsImport(csvText: string): Promise<PickupsImportResult>;
  /** Asks REAPER for every remaining pickup; read-only. */
  pickupsExport(): Promise<PickupsStartResult>;
  /** Moves the edit cursor to the next open pickup after the cursor, wrapping to the earliest one. */
  pickupsNext(): Promise<PickupsStartResult>;
  /** Marks the open pickup nearest position (seconds) as done. */
  pickupsResolve(position: number): Promise<PickupsStartResult>;
  /** Asks REAPER how many pickups remain versus the total; read-only. */
  pickupsCount(): Promise<PickupsStartResult>;
  pickupsState(): Promise<PickupsState>;
  subscribePickups(onUpdate: (state: PickupsState) => void): () => void;
}
