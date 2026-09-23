// Retakes as fixed lanes (reaper-automation-follow-through PRD, Phase 25, ADR 0147): list the retakes of each
// manuscript line that sit on fixed item lanes in the saved REAPER project, and make the narrator's pick the only lane
// playing on its track. The app changes nothing else: it never turns lanes on, converts takes and lanes, or builds
// comps. Mirrors apps/desktop/internal/retakelanes (List and Service.Snapshot()) exactly.

/** One item of a line on a fixed lane. A retake is named by line id plus item GUID. */
export type RetakeLane = {
  itemGuid: string;
  name: string;
  /** 0-based lane; the narrator sees lane + 1, as REAPER numbers them. */
  lane: number;
  /** Whether the lane plays in the saved project. */
  plays: boolean;
  position: number;
  length: number;
};

export type RetakeLaneLine = {
  lineId: string;
  trackGuid: string;
  trackName: string;
  retakes: RetakeLane[];
};

export type RetakeLanesList = {
  lines: RetakeLaneLine[];
  /** How many tracks are in fixed-lane mode at all, so "no lane tracks" and "nothing to choose" read differently. */
  laneTracks: number;
};

export type RetakeLanesPhase = 'idle' | 'picking' | 'picked' | 'error';

export type RetakeLanesState = {
  runId?: string;
  phase: RetakeLanesPhase;
  message: string;
  lineId: string;
  itemGuid: string;
  trackName: string;
  /** The lane REAPER now plays alone; set once a pick succeeds. */
  lane?: number;
};

export type RetakeLanesStartResult = { status: 'started' };

export interface RetakeLanesApi {
  retakeLanesList(): Promise<RetakeLanesList>;
  /** Asks REAPER to make this retake's lane the only one playing on its track, in one undo step. */
  retakeLanesPick(lineId: string, itemGuid: string): Promise<RetakeLanesStartResult>;
  retakeLanesState(): Promise<RetakeLanesState>;
  subscribeRetakeLanes(onUpdate: (state: RetakeLanesState) => void): () => void;
}
