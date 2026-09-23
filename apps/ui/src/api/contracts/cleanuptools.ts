// Cleanup launchers (reaper-automation-follow-through PRD, Phase 23, ADR 0146): open REAPER's own Repair Pops/Clicks
// dialog, or the narrator's installed Magnolius DeClick script, on the items selected in REAPER. The app changes
// nothing itself. Mirrors apps/desktop/internal/cleanuptools.Service.Snapshot() exactly: one launch at a time,
// reported by phase.

/** The allow-listed tools (cleanuptools.Tools in Go, TOOLS in narration_cleanup.lua). */
export type CleanupToolKey = 'repair_pops_clicks' | 'magnolius_declick';

export type CleanupToolsPhase = 'idle' | 'launching' | 'launched' | 'error';

export type CleanupToolsState = {
  runId?: string;
  phase: CleanupToolsPhase;
  message: string;
  /** The tool of the last launch; empty before any. */
  tool: CleanupToolKey | '';
  /** The REAPER action-list name that was opened; empty until a launch succeeds. */
  action: string;
};

export type CleanupToolsStartResult = { status: 'started' };

export interface CleanupToolsApi {
  /** Asks REAPER to open the tool's dialog on the selected items. Changes nothing itself. */
  cleanupToolsLaunch(tool: CleanupToolKey): Promise<CleanupToolsStartResult>;
  cleanupToolsState(): Promise<CleanupToolsState>;
  subscribeCleanupTools(onUpdate: (state: CleanupToolsState) => void): () => void;
}
