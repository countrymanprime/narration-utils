// The golden payloads for the DAW project's tracks, chapter links, chapter sync and chapter regions: which schema owns each file in tests/fixtures/contracts/ (see index.ts).
import type { z } from 'zod';
import { chapterSyncPreviewSchema, chapterSyncStateSchema } from '../schemas/chapterSync';
import {
  chapterRegionPlanSchema,
  chapterRegionsCreatedSchema,
  chaptersForTracksSchema,
  chapterSuggestionSchema,
  chapterTrackLinksSchema,
  chapterTrackMappingSchema,
  chapterTrackMatchSchema,
  chapterTrackSetSchema,
  trackMappingSchema,
} from '../schemas/chapterTrackMap';
import { tracksDiscoverySchema, tracksProjectSchema } from '../schemas/tracks';

export const chapterTracksGoldens: Record<string, z.ZodType> = {
  'tracks-project.json': tracksProjectSchema,
  'tracks-discovery-none.json': tracksDiscoverySchema,
  'tracks-discovery-several.json': tracksDiscoverySchema,
  'tracks-discovery-selected.json': tracksDiscoverySchema,
  'chapter-track-map-empty.json': chapterTrackMappingSchema,
  'chapter-track-map-confirmed.json': trackMappingSchema,
  'chapter-track-map-list.json': chapterTrackMappingSchema,
  'chapter-track-match-matched.json': chapterTrackMatchSchema,
  'chapter-track-match-ambiguous.json': chapterTrackMatchSchema,
  'chapter-track-match-none.json': chapterTrackMatchSchema,
  'chapter-track-links-ready.json': chapterTrackLinksSchema,
  'chapter-sync-state-ask.json': chapterSyncStateSchema,
  'chapter-sync-state-synced.json': chapterSyncStateSchema,
  'chapter-sync-state-stale.json': chapterSyncStateSchema,
  'chapter-sync-state-pickups.json': chapterSyncStateSchema,
  'chapter-sync-preview.json': chapterSyncPreviewSchema,
  'chapter-track-links-no-project.json': chapterTrackLinksSchema,
  'chapter-track-links-conflict.json': chapterTrackLinksSchema,
  'chapter-regions-preview.json': chapterRegionPlanSchema,
  'chapter-regions-no-project.json': chapterRegionPlanSchema,
  'chapter-regions-created.json': chapterRegionsCreatedSchema,
  'chapter-track-set-displaced.json': chapterTrackSetSchema,
  'chapter-track-unlink.json': chapterTrackMappingSchema,
  'chapter-suggestion-matched.json': chapterSuggestionSchema,
  'chapter-suggestion-ambiguous.json': chapterSuggestionSchema,
  'chapter-suggestion-none.json': chapterSuggestionSchema,
  'chapters-for-tracks.json': chaptersForTracksSchema,
};
