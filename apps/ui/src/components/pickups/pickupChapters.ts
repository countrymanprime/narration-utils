import type { TrackMapping } from '../../api/contracts/chapterTrackMap';
import type { TracksProject } from '../../api/contracts/tracks';
import { buildPlaylist } from '../proof/playlist';

/** A chapter a pickup falls in, and where on that chapter's Proof player it is (the chapter view's `?t=`). */
export type PickupChapter = { chapterId: string; title: string; elapsed: number };

/**
 * Which chapters a pickup marker at `position` (project seconds) falls in (stage-navigation-and-page-replacement.prd.md
 * Phase 7, "a pickup opens its Proof chapter view"): every chapter whose linked track has a playable item under that
 * time. Chapter tracks can overlap in time, so this returns every match in chapter order and never picks one
 * (recording-check-summary.prd.md RS5 B's reason for keeping the count project-wide). `elapsed` is the pickup's place
 * on the chapter player's own timeline, built by the same `buildPlaylist` the Proof chapter view plays.
 */
export function chaptersAtPosition(
  position: number,
  project: TracksProject,
  mappings: TrackMapping[],
  chapters: { id: string; title: string }[],
): PickupChapter[] {
  const matches: PickupChapter[] = [];
  for (const chapter of chapters) {
    const trackGuid = mappings.find((mapping) => mapping.chapterId === chapter.id)?.trackGuid;
    const track = project.tracks.find((candidate) => candidate.guid === trackGuid);
    if (!track) continue;
    // buildPlaylist keeps the playable items in position order, one segment each; the same filter and sort pair them up
    // by index (item GUIDs are not guaranteed unique in a hand-built project).
    const playable = track.items.filter((item) => item.supported && item.sourceAvailable).sort((a, b) => a.position - b.position);
    const playlist = buildPlaylist(track.items);
    for (const [index, segment] of playlist.entries()) {
      const item = playable[index];
      if (position < item.position || position >= item.position + item.length) continue;
      matches.push({ chapterId: chapter.id, title: chapter.title, elapsed: segment.elapsedStart + (position - item.position) * (item.playRate || 1) });
      break;
    }
  }
  return matches;
}
