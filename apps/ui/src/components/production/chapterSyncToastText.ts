import type { ChapterSyncBatch } from '../../api/contracts/chapterSync';

/**
 * The single toast for one chapter-sync batch (daw-chapter-track-auto-sync PRD Phase 3, S12: one toast per batch):
 * "Linked track 'X' to Chapter N" for one link, or a count when a batch links more than one track at once (the
 * first sync after consent can). `trackName` resolves a linked track's saved-project name (from the last
 * `chapterTrackLinks()` read); a track sync just linked is always in that list, so a miss only ever happens on a
 * race with the very first read, and falls back to naming the chapter alone. `batch.newTracks` is never named here:
 * it is listed quietly elsewhere, never in a toast.
 */
export function chapterSyncBatchToastText(batch: ChapterSyncBatch, trackName: (trackGuid: string) => string | undefined): string {
  if (batch.linked.length === 1) {
    const [link] = batch.linked;
    const name = trackName(link.trackGuid);
    return name ? `Linked track “${name}” to ${link.chapterTitle}.` : `Linked a track to ${link.chapterTitle}.`;
  }
  return `Linked ${batch.linked.length} tracks to chapters.`;
}
