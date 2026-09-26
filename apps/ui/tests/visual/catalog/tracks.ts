// The `tracks` rows of STATE_CATALOG (see state-catalog.ts), in the order they are captured.
// The Home variant of the sync consent dialog sits with the Tracks rows it belongs to, where the catalog has always listed it.
import type { StateEntry } from '../lib/types';
import { KEEPS_DESKTOP_SCROLL } from './shared';

export const tracksStates: StateEntry[] = [
  // Tracks
  {
    page: 'tracks',
    state: 'default',
    description: 'Tracks, a single .rpp auto-selected - first track active with transport controls, other tracks flagged for missing/unsupported items',
  },
  {
    page: 'tracks',
    state: 'sync-off',
    description: 'Tracks, the Chapter sync panel with sync turned off (?mockChapterSync=off, daw-chapter-track-auto-sync.prd.md Phase 3, mockup 02)',
  },
  {
    page: 'tracks',
    state: 'sync-consent',
    description:
      'Tracks, "Sync chapters to tracks?" (?mockChapterSync=ask, daw-chapter-track-auto-sync.prd.md Phase 3, mockups/daw-chapter-track-auto-sync/01-sync-consent-dialog.webp). The default fixture only has 3 tracks against 12 chapters, so its Needs-you and Tracks-that-are-not-chapters lists differ from the mockup\'s content; wording and layout for those sections are covered by ChapterSyncConsentDialog.test.tsx and ChapterSyncPanel.test.tsx instead, over a constructed preview - the mock has no seam yet for an ambiguous or uncertain match (a gap for lane A, not built here), so "tracks/sync-needs-you" is not a capturable state and is not in this catalog.',
  },
  {
    page: 'home',
    state: 'chapter-sync-consent',
    description:
      'Home, the same "Sync chapters to tracks?" dialog (?mockChapterSync=ask) - it shows from every link path, not only Tracks (Phase 3\'s "Home variant" row)',
  },
  {
    page: 'tracks',
    state: 'unplayable-track-selected',
    description: 'Tracks, a track whose source file is missing selected - "no playable audio" message with disabled transport',
  },
  {
    page: 'tracks',
    state: 'rpp-picker',
    description: 'Tracks, more than one .rpp file found - choose-a-project-file prompt (reached via the ?mockMultipleRpp=1 mock seam)',
  },
  {
    page: 'tracks',
    state: 'no-rpp',
    description: 'Tracks, no .rpp file in the project folder - "No REAPER project file found" empty state (reached via the ?mockNoRpp=1 mock seam)',
  },
  {
    page: 'tracks',
    state: 'no-daw-link',
    description:
      'Tracks with no linked REAPER project file (?mockNoDaw=1, PRD W19): the page’s own DAW-link control reads "Link a REAPER project file" instead of "Link a different REAPER project file" - Tracks itself stays usable since it reads its .rpp through its own discovery flow',
  },
  {
    page: 'tracks',
    state: 'playing',
    description: 'Tracks, Play pressed - the button becomes Pause and the position/duration readout is live',
  },
  {
    page: 'tracks',
    state: 'skipped-forward',
    description: 'Tracks, playing then "skip forward 30 seconds" pressed - the readout jumps to about 0:30',
  },
  {
    page: 'tracks',
    state: 'last-track-selected',
    description: 'Tracks, the last track (muted, MIDI-only) selected - Muted badge shown and Next track disabled',
  },
  {
    page: 'tracks',
    state: 'chapter-link-confirmed',
    description:
      'Tracks, the Chapter links list at the foot of the page - the first chapter confirmed to a track shows Linked with the track name, Change and Clear (analysis evidence ledger PRD, Phase 7)',
    ...KEEPS_DESKTOP_SCROLL,
  },
  {
    page: 'tracks',
    state: 'chapter-link-missing',
    description:
      'Tracks, a chapter confirmed to a track GUID no longer in the project - Track missing, with the missing-track message and Change/Clear (reached via the ?mockChapterLink=missing mock seam)',
    ...KEEPS_DESKTOP_SCROLL,
  },
  {
    page: 'tracks',
    state: 'editing-check-unmapped',
    description:
      'Tracks, the Chapter links list\'s "Editing check…" opened on an unlinked chapter, Check editing pressed: "This chapter can\'t be checked yet" with the inline track-link prompt, same as Home\'s recording check offers (?mockEditingRefusal=unmapped)',
    ...KEEPS_DESKTOP_SCROLL,
  },
  {
    page: 'tracks',
    state: 'link-chapters-preview',
    description: 'Tracks, "Link chapters" dialog open with one chapter mapped to a track - preview of the items that will be stamped, nothing written yet',
  },
  {
    page: 'tracks',
    state: 'link-chapters-success',
    description: 'Tracks, "Link chapters" dialog after a completed Read - every row status shown at once (ok, drift, stale-source, removed, unrecognized)',
    ...KEEPS_DESKTOP_SCROLL,
  },
  {
    page: 'tracks',
    state: 'link-chapters-conflict',
    description: 'Tracks, "Link chapters" dialog after a Stamp that hit a stale item and a conflict - both GUID lists shown',
    ...KEEPS_DESKTOP_SCROLL,
  },
  {
    page: 'tracks',
    state: 'link-chapters-error',
    description: 'Tracks, "Link chapters" dialog when REAPER reports a problem - inline error message, nothing written',
    ...KEEPS_DESKTOP_SCROLL,
  },
  {
    page: 'tracks',
    state: 'pickups-empty',
    description: 'Tracks, "Pickups" dialog open before any import - "No pickups yet", Next disabled, Export disabled',
    ...KEEPS_DESKTOP_SCROLL,
  },
  {
    page: 'tracks',
    state: 'pickups-imported',
    description: 'Tracks, "Pickups" dialog after a completed CSV import - remaining count and the import summary shown',
  },
  {
    page: 'tracks',
    state: 'pickups-import-errors',
    description: 'Tracks, "Pickups" dialog after importing a CSV with an unusable row - the row error listed, the usable row still counted',
  },
  {
    page: 'tracks',
    state: 'pickups-next',
    description: 'Tracks, "Pickups" dialog after "Next pickup" - the pickup\'s tag and note shown with "Mark this pickup done"',
  },
  {
    page: 'tracks',
    state: 'pickups-error',
    description: 'Tracks, "Pickups" dialog when REAPER reports a problem - inline error message (reached via the ?mockPickups=error mock seam)',
  },
  {
    page: 'tracks',
    state: 'render-config-prefilled',
    description: 'Tracks, "Prepare chapter render" dialog open before any configure - the suggested output folder prefilled, Configure render enabled',
  },
  {
    page: 'tracks',
    state: 'render-config-success',
    description:
      'Tracks, "Prepare chapter render" dialog after a completed configure - the resulting chapter file names and the "press Render in REAPER" instruction shown',
  },
  {
    page: 'tracks',
    state: 'render-config-no-regions',
    description: 'Tracks, "Prepare chapter render" dialog after a configure with no chapter regions yet - 0 files, "create them before rendering"',
  },
  {
    page: 'tracks',
    state: 'render-config-error',
    description:
      'Tracks, "Prepare chapter render" dialog when REAPER reports a problem - inline error message, nothing rendered (reached via the ?mockRenderConfig=error mock seam)',
  },
  {
    page: 'tracks',
    state: 'chapter-tags-idle',
    description: 'Tracks, "Embed chapter tags" dialog open before any chapter render is configured - "Prepare chapter render first" message, Embed disabled',
    ...KEEPS_DESKTOP_SCROLL,
  },
  {
    page: 'tracks',
    state: 'chapter-tags-ready',
    description:
      'Tracks, "Embed chapter tags" dialog with two rendered chapters known - the chapter list, destination field and confirm checkbox, Embed enabled once both are filled in (reached via the ?mockChapterTags=ready mock seam)',
    ...KEEPS_DESKTOP_SCROLL,
  },
  {
    page: 'tracks',
    state: 'chapter-tags-not-rendered',
    description:
      'Tracks, "Embed chapter tags" dialog with a chapter configured but not yet rendered - "not rendered yet" and the press-Render-first message, Embed disabled (reached via the ?mockChapterTags=not-rendered mock seam)',
    ...KEEPS_DESKTOP_SCROLL,
  },
  {
    page: 'tracks',
    state: 'chapter-tags-success',
    description: 'Tracks, "Embed chapter tags" dialog after a completed embed - the new tagged file\'s path shown, the original file unmentioned as changed',
    ...KEEPS_DESKTOP_SCROLL,
  },
  {
    page: 'tracks',
    state: 'chapter-tags-error',
    description:
      'Tracks, "Embed chapter tags" dialog when the embed fails - inline error message (reached via the ?mockChapterTags=ready&mockChapterTagsEmbedError=1 mock seam)',
    ...KEEPS_DESKTOP_SCROLL,
  },
  {
    page: 'tracks',
    state: 'cleanup-tools-idle',
    description: 'Tracks, "Cleanup tools" dialog open before any launch - Repair Pops/Clicks and Magnolius DeClick, each with its own Open button',
  },
  {
    page: 'tracks',
    state: 'cleanup-tools-launched',
    description:
      'Tracks, "Cleanup tools" dialog after REAPER opened Repair Pops/Clicks - "is open in REAPER. Nothing has changed yet" (reached via the ?mockCleanupTools=launched mock seam)',
  },
  {
    page: 'tracks',
    state: 'cleanup-tools-error',
    description:
      'Tracks, "Cleanup tools" dialog when REAPER refuses a launch - "Magnolius DeClick is not installed" inline alert, nothing opened (reached via the ?mockCleanupTools=error mock seam)',
  },
  {
    page: 'tracks',
    state: 'retake-lanes-list',
    description:
      'Tracks, "Retakes on lanes" dialog - two lines of Chapter 1 with their retakes by lane, which lane plays in the saved project, and a "Play this lane" button per retake',
  },
  {
    page: 'tracks',
    state: 'retake-lanes-picked',
    description:
      'Tracks, "Retakes on lanes" dialog after REAPER confirmed a pick - lane 2 now plays for both lines of the track, "Undo in REAPER" status line (reached via the ?mockRetakeLanes=picked mock seam)',
  },
  {
    page: 'tracks',
    state: 'retake-lanes-none',
    description:
      'Tracks, "Retakes on lanes" dialog for a project with no fixed-lane track - says why nothing is listed (reached via the ?mockRetakeLanes=none mock seam)',
  },
  {
    page: 'tracks',
    state: 'retake-lanes-error',
    description:
      'Tracks, "Retakes on lanes" dialog when REAPER refuses a pick - "not in fixed item lane mode" inline alert, nothing changed (reached via the ?mockRetakeLanes=error mock seam)',
  },
];
