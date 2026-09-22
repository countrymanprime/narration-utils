// Manuscript line identity (reaper-automation-follow-through PRD, Phase 7: "Link chapters" and its stale/conflict/
// drift states). Mirrors apps/desktop/internal/lineidentity.Service.Snapshot() exactly: one Stamp/Read run at a
// time, reported by phase.

/** One row of LineIdentityStamp's input: an item GUID, the manuscript entity ID it should carry, and that entity's current text. */
export type LineIdentityStampRow = {
  itemGuid: string;
  lineId: string;
  text: string;
};

/** How one read row compares to the current manuscript (apps/desktop/internal/lineidentity.rowStatus). */
export type LineIdentityRowStatus = 'ok' | 'drift' | 'stale-source' | 'removed' | 'unrecognized' | 'unknown';

/** One stamped item as `read_line_ids` reported it, classified against the current manuscript. */
export type LineIdentityLine = {
  itemGuid: string;
  lineId: string;
  entityId: string;
  position: number;
  length: number;
  text: string;
  status: LineIdentityRowStatus;
  /** Set only when `status` is 'drift': the manuscript's current text at this entity. */
  currentText?: string;
};

export type LineIdentityStampSummary = {
  applied: number;
  unchanged: number;
  missingCount: number;
  conflictsCount: number;
  missing: string[];
  conflicts: string[];
};

export type LineIdentityPhase = 'idle' | 'stamping' | 'reading' | 'success' | 'error';

export type LineIdentityState = {
  runId?: string;
  phase: LineIdentityPhase;
  message: string;
  stamp: LineIdentityStampSummary;
  lines: LineIdentityLine[];
  linesRead: number;
};

export type LineIdentityStartResult = { status: 'started' };

export interface LineIdentityApi {
  /** Writes `item_guid|line_id|line_text` rows and asks REAPER to stamp them; nothing is written until this is called. */
  lineIdentityStamp(rows: LineIdentityStampRow[], overwrite: boolean): Promise<LineIdentityStartResult>;
  /** Reads every stamped item currently in the REAPER project and classifies it against the current manuscript. */
  lineIdentityRead(): Promise<LineIdentityStartResult>;
  lineIdentityState(): Promise<LineIdentityState>;
  subscribeLineIdentity(onUpdate: (state: LineIdentityState) => void): () => void;
}
