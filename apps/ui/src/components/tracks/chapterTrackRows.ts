import type { ManuscriptChapter, Track, TrackMapping } from '../../types';

/** A chapter's link state for the Tracks page list (analysis evidence ledger PRD, Phase 7, Q7): `linked` when the
 * confirmed track still exists in the current REAPER project, `missing_track` when the confirmed trackGuid no longer
 * resolves to a track (the track was deleted or the project points elsewhere), `unlinked` when nothing is confirmed yet. */
export type ChapterLinkState = 'linked' | 'unlinked' | 'missing_track';

export type ChapterTrackRow = {
  chapter: ManuscriptChapter;
  mapping?: TrackMapping;
  trackName?: string;
  state: ChapterLinkState;
};

/** Builds one row per narration chapter (reference chapters are hidden here the way the page-flip reader hides them,
 * since they have no audio to link) joined against the confirmed mappings and the tracks currently in the project.
 * A chapter with more than one confirmed track (D5's "the store may hold several links, consumers treat that as
 * unknown") shows its first mapping only; SR is the consumer that reports the conflict itself. */
export function chapterTrackRows(chapters: ManuscriptChapter[], tracks: Track[], mappings: TrackMapping[]): ChapterTrackRow[] {
  const trackByGuid = new Map(tracks.map((track) => [track.guid, track]));
  const mappingByChapter = new Map<string, TrackMapping>();
  for (const mapping of mappings) {
    if (!mappingByChapter.has(mapping.chapterId)) mappingByChapter.set(mapping.chapterId, mapping);
  }
  return chapters
    .filter((chapter) => chapter.contentKind !== 'reference')
    .map((chapter) => {
      const mapping = mappingByChapter.get(chapter.id);
      if (!mapping) return { chapter, state: 'unlinked' as const };
      const track = trackByGuid.get(mapping.trackGuid);
      return { chapter, mapping, trackName: track?.name, state: (track ? 'linked' : 'missing_track') as ChapterLinkState };
    });
}
