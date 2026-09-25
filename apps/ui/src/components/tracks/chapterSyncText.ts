import type { ChapterSyncNeedsYou, ChapterSyncPickupTrack, ChapterSyncTrackRef } from '../../api/contracts/chapterSync';

/**
 * Why a chapter is in Needs you (daw-chapter-track-auto-sync.prd.md Phase 3, mockups 01/02): the consent dialog and
 * the Tracks panel share the exact wording.
 */
export function chapterSyncReasonText(item: ChapterSyncNeedsYou): string {
  switch (item.reason) {
    case 'ambiguous': {
      const names = item.candidates.map((candidate) => `“${candidate.trackName}”`);
      if (names.length === 0) return 'More than one track looks like it.';
      if (names.length === 1) return `${names[0]} looks like it.`;
      return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]} both look like it.`;
    }
    case 'uncertain':
      return item.best ? `“${item.best.trackName}” is close, but not a confident match.` : 'No track is a confident match.';
    case 'region':
      return 'Only a project region names this chapter, not a track.';
    case 'rejected':
      return 'You unlinked this chapter before; sync will not relink it on its own.';
    case 'not-mutual':
      return item.best ? `“${item.best.trackName}” matches another chapter better.` : 'Its closest track matches another chapter better.';
  }
}

/** "Tracks that are not chapters" (mockup 02): unmatched track names plus any pickup tracks, with a note singling
 * the pickup tracks out (they are kept for take review, never a chapter link). */
export function chapterSyncNotChaptersText(unmatched: ChapterSyncTrackRef[], pickupTracks: ChapterSyncPickupTrack[]): { names: string; note: string } {
  const names = [...unmatched.map((track) => track.name), ...pickupTracks.map((pickup) => pickup.trackName)];
  if (names.length === 0) return { names: 'None.', note: '' };
  const subject = pickupTracks.length === 1 ? 'The last one is' : `The last ${pickupTracks.length} are`;
  const object = pickupTracks.length === 1 ? `${pickupTracks[0].chapterTitle}'s pickup track` : 'their chapters’ pickup tracks';
  const note = pickupTracks.length > 0 ? `${subject} kept as ${object}.` : '';
  return { names: names.join(', '), note };
}
