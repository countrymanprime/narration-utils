// The live "project changed" check (reaper-automation-follow-through PRD Phase 13): REAPER's own edit counter
// (GetProjectStateChangeCount), read on demand while REAPER is open from this app. The Transcript page compares it with
// the count its comparison started from (TranscriptState.projectChangeCount) to say "changed since comparison"; nothing
// re-runs on its own. Mirrors apps/desktop/internal/projectstate.Service.Snapshot() exactly.

export type ProjectStatePhase = 'idle' | 'checking' | 'success' | 'error';

export type ProjectStateState = {
  runId?: string;
  phase: ProjectStatePhase;
  message: string;
  /** REAPER's change count; absent before a check answers. */
  changeCount?: number;
  /** The saved .rpp REAPER has open; empty for a project never saved, and before a check. */
  projectFile: string;
  /** The saved file's modification time in Unix milliseconds; absent when it cannot be read. */
  savedModifiedAt?: number;
};

export type ProjectStateStartResult = { status: 'started' };

export type ProjectStateChanged = { changed: boolean };

export interface ProjectStateApi {
  /** Asks REAPER for its change count; the answer arrives as a projectstate:state update. Fails at once without REAPER. */
  projectStateCheck(): Promise<ProjectStateStartResult>;
  /** Whether REAPER's count now differs from a baseline, such as the comparison's projectChangeCount. */
  projectStateChangedSince(current: number, baseline: number): Promise<ProjectStateChanged>;
  projectStateState(): Promise<ProjectStateState>;
  subscribeProjectState(onUpdate: (state: ProjectStateState) => void): () => void;
}
