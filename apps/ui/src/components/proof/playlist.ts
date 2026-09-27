import type { TrackItem } from '../../api/contracts/tracks';

// The chapter's items, in the order the app plays them (edit-and-proof-workspace.prd.md Phase 2, "The player"): every
// playable item, sorted by position, each one's played range honoured (SOFFS to SOFFS + length * playRate) so a trim
// stops the app where REAPER would, instead of the whole source file from 0. The app plays raw source at its own
// (1x, or the narrator's EP17 speed) rate rather than REAPER's real-time-stretched render ("No pitch-correct
// play-rate emulation... in the app player" - What We're NOT Building), so a segment's own played duration on the
// app's timeline is its source span's length, not the item's project-time length.
export type PlaylistSegment = {
  itemGuid: string;
  sourceFile: string;
  sourceStart: number;
  sourceEnd: number;
  /** This segment's place on the app's own elapsed-time line (cumulative played source seconds, gaps skipped). */
  elapsedStart: number;
  elapsedEnd: number;
  /** This item starts before the previous one (by position) ended: they still play in position order, not merged. */
  overlapsPrevious: boolean;
};

/** Builds the playlist from a track's items: filters to playable audio, sorts by position, and maps each item's
 * played range onto the app's own elapsed timeline. Shared by useChapterPlayback and useTrackPlayback so both honour
 * the same played range. */
export function buildPlaylist(items: TrackItem[]): PlaylistSegment[] {
  const playable = items.filter((item) => item.supported && item.sourceAvailable).sort((a, b) => a.position - b.position);
  let elapsed = 0;
  let previousEnd = -Infinity;
  return playable.map((item) => {
    const playRate = item.playRate || 1;
    const sourceStart = item.sourceStart;
    const sourceEnd = sourceStart + item.length * playRate;
    const elapsedStart = elapsed;
    const elapsedEnd = elapsed + Math.max(0, sourceEnd - sourceStart);
    elapsed = elapsedEnd;
    const overlapsPrevious = item.position < previousEnd;
    previousEnd = Math.max(previousEnd, item.position + item.length);
    return { itemGuid: item.guid, sourceFile: item.sourceFile, sourceStart, sourceEnd, elapsedStart, elapsedEnd, overlapsPrevious };
  });
}

export function totalDuration(playlist: PlaylistSegment[]): number {
  return playlist.length === 0 ? 0 : playlist[playlist.length - 1].elapsedEnd;
}

/** The segment (and its index) that owns a given point on the app's elapsed line, clamped to the playlist's range. */
export function segmentAtElapsed(playlist: PlaylistSegment[], elapsed: number): { segment: PlaylistSegment; index: number } | undefined {
  if (playlist.length === 0) return undefined;
  const clamped = Math.max(0, Math.min(totalDuration(playlist), elapsed));
  const index = playlist.findIndex((segment) => clamped < segment.elapsedEnd);
  const resolved = index === -1 ? playlist.length - 1 : index;
  return { segment: playlist[resolved], index: resolved };
}
