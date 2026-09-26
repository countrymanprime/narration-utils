// The mock host (mockApi.ts): its seeds and shared state.
import type {
  CreditValues,
  Finding,
  GuideEntity,
  ManuscriptChapter,
  ManuscriptParagraph,
  TeleprompterDevice,
  TrackMapping,
  TracksDiscovery,
} from '../../types';
import type { JobEnded } from '../contracts/system';
import { WIRE_CHAPTERS, WIRE_ENTITIES, WIRE_PARAGRAPHS, WIRE_TRACKS_PROJECT, wireClone } from '../mockFixtures';
import type { MockImportKind } from '../mockImportPreview';
import type { MockReaperInputSeed, MockReaperSeed, TeleprompterSeed } from '../teleprompterMock';
import type { CoverageSeed } from '../coverageMock';
import type { PreviewSeed } from '../previewMock';
import type { StagesSeed } from '../stagesMock';
import type { MockResumeSeed } from '../resumeMockSeed';
import type { MockReaper } from '../findingsMock';
import type { MockMeasureSeed } from '../measureMock';
import type { MockDeliveryProfileSeed } from '../deliveryProfilesMock';
import type { MockDiagnosticsSeed } from '../diagnosticsMock';
import type { EditingSeed } from '../editingMock';
import type { MockAssetSeed } from '../assetInstallMock';
import type { MockUpdateSeed } from './update';

// What createMockApi boots from (the seeds), and the host state more than one domain reads or writes.
// manuscriptCandidate boots a project with no imported manuscript but a
// manuscript file waiting in its folder (Home offers to import it, ADR-0019).
// teleprompter boots with a session already part-way through the first chapter.
export type MockApiSeed = {
  projectFolder?: string;
  tracksCandidates?: string[];
  noManuscript?: boolean;
  manuscriptCandidate?: { path: string; name: string };
  teleprompter?: TeleprompterSeed;
  /** The project's own credits values at boot (the credits on the teleprompter with every token resolved, Phase 4). */
  creditValues?: CreditValues;
  /** Adds a chapter announcement template with this body to the library at boot (Phase 5). */
  chapterAnnouncement?: string;
  /** Drops the closing credit templates from the seeded library (credits-in-chapter-table.prd.md Phase 2, CT5): the
   * Home table's Closing credits row then shows "Not set up" with a link to Settings > Credits. */
  creditsMissingClosing?: boolean;
  /** Widens `creditsProjectValues().detected` past Title/Author to every token the front matter parser can find
   * (credits-token-setup-and-front-matter-detection.prd.md Phase 1), including one low-confidence candidate, so
   * Settings > Credits' per-field source caption can be seen on every field, not just the two the default mock
   * always detects. */
  creditsDetected?: boolean;
  /** Boots a project whose credits setup prompt asks (credits-token-setup-and-front-matter-detection.prd.md Phase 2,
   * `?mockCredits=setup`). Without it the mock boots as if the narrator already chose "Don't ask", so the prompt never
   * covers the other states. */
  creditsSetup?: boolean;
  /** The project's retail sample at boot (Phase 5): by paragraph id, or by lines of the chapter at this index in the
   * manuscript once it has loaded (the bundled text replaces the seed's paragraph ids). */
  retailSample?: { startParagraphId: string; endParagraphId: string } | { chapterIndex: number; startLine: number; endLine: number };
  /** Makes every Story Bible preview fail with this text once the voice is installed. */
  previewError?: string;
  /** Makes that payload arrive in the wrong shape, through the real `parseWire`, so the failure screens can be seen without a host. */
  invalidPayload?: 'bootstrap' | 'manuscript' | 'storybible';
  /** Tells the app at once that live updates from the host are degraded, so the notice can be seen without a failing host. */
  liveUpdatesDegraded?: boolean;
  /** Tells the app this text at once, as the host does after keeping a file it could not read. */
  notice?: string;
  /** Makes every Story Bible edit hang, as a Python process that has not answered would, so the busy state can be seen without a host. */
  holdEdits?: boolean;
  /** Boots with a Story Bible rebuild that is still running, so its dialog (and Continue in background) can be seen without a host. */
  rebuildRunning?: boolean;
  /**
   * How the next Story Bible build behaves: `hold` starts it and keeps it running at 30 percent, and `fails` starts it and has the host
   * report it failed at the first poll, so the chained build after an import (story-bible-and-import-ux-briefs PRD, Phase 3) can be seen
   * running and failing without a host. Without it a build finishes at once.
   */
  build?: 'hold' | 'fails';
  /** Which manuscript an import picks: a Word file (the default) or a Markdown one, which has the chapter heading level choice. */
  importPreview?: MockImportKind;
  /** Boots the update state (see `MockUpdateSeed`). */
  update?: MockUpdateSeed;
  /** How the next voice or model download behaves (see `MockAssetSeed`). */
  assets?: MockAssetSeed;
  /** What `teleprompterDevices` reports; defaults to `WIRE_TELEPROMPTER_DEVICES`. An empty array exercises the picker's no-devices fallback. */
  teleprompterDevices?: TeleprompterDevice[];
  /** `?mockLevel=`: the RMS in dBFS of every input level the teleprompter mock sends, for a still meter. */
  teleprompterLevel?: number;
  /** `?mockReaperState=`: what `readAloudReaperState` answers for every chapter (see `MockReaperSeed`). */
  reaperState?: MockReaperSeed;
  /** `?mockReaperInput=`: what `teleprompterReaperInput` answers (see `MockReaperInputSeed`). */
  reaperInput?: MockReaperInputSeed;
  /** Which resume card state `teleprompterLocate` answers for every chapter (see `MockResumeSeed`). */
  resume?: MockResumeSeed;
  /** Boots with the manuscript's last narration chapter already removed from recording (chapter-track-link-control PRD
   * Phase 3), so the "Removed from recording" list and its Restore can be seen without driving a removal. */
  removedChapter?: boolean;
  /** Chapter sync's consent at boot (daw-chapter-track-auto-sync PRD Phase 3): `ask` has not been asked yet (the consent
   * dialog shows), `off` answered Not now, and `linked` is on and, once something subscribes, runs a sync that links the
   * confident chapters and sends the batch for the toast. `unsaved` is on, with REAPER holding unsaved edits and a Sync
   * activity row from a save in REAPER (Phase 4). `pickups` is on, with the first chapter's pickup track changed since its
   * last take-review scan (Phase 8). Unset, sync is on and has run before with nothing new, so no dialog or
   * toast covers the other states. */
  chapterSync?: 'ask' | 'off' | 'linked' | 'unsaved' | 'pickups';
  /** Whether the mock project boots with a linked DAW project file (PRD W13/W14). Defaults to true. */
  dawFileLinked?: boolean;
  /** Makes the next `linkDawFile()` call behave like a chosen file outside the project folder (PRD W15): refused, not linked. */
  dawLinkMismatch?: boolean;
  /**
   * Whether `dawCatalogList()`'s REAPER entry reports installed (docs/architecture/daw-integration.md).
   * Defaults to true; false shows the not-detected state and its "Get REAPER" button.
   */
  dawCatalogInstalled?: boolean;
  /** Seeds the confirmed chapter-track mapping (analysis evidence ledger PRD, Phase 5/7), so a link's state (a
   * missing track, in particular) can be seen without going through Confirm in the UI first. */
  chapterTrackMappings?: TrackMapping[];
  /** The mock .rpp's record-armed track GUIDs, which `chapterSuggestion` reads (ADR 0113). Defaults to none, so the
   * Teleprompter keeps its usual default chapter. */
  armedTracks?: readonly string[];
  /** Boots LineIdentityState already at this result, so "Link chapters" states can be seen without stepping through a run. */
  lineIdentity?: 'success' | 'conflict' | 'error';
  /** Boots PickupsState already at this result, so the pickup list's states can be seen without stepping through a run. */
  pickups?: 'import-success' | 'next-success' | 'export-success' | 'error';
  /** Boots RenderConfigState already at this result, so "Prepare chapter render" states can be seen without stepping through a run. */
  renderConfig?: 'success' | 'no-regions' | 'error';
  /** Boots CleanupToolsState already at this result, so the cleanup launcher's states can be seen without a launch. 'error' also makes every launch fail. */
  cleanupTools?: 'launched' | 'error';
  /** How a project-state check answers (follow-through PRD Phase 13): 'changed' (count 42, one more than the last
   * comparison's 41, the default), 'unchanged' (41), or 'error' (REAPER is not open from this app). */
  projectState?: 'changed' | 'unchanged' | 'error';
  /** Boots the retake-lane list and RetakeLanesState at this result, so "Retakes on lanes" states can be seen without a pick. 'none' lists a project with no lane tracks; 'error' also makes every pick fail. */
  retakeLanes?: 'picked' | 'error' | 'none';
  /** Boots ChapterTagsPreview already at this result, so "Embed chapter tags" states can be seen without a real render. */
  chapterTags?: 'idle' | 'ready' | 'not-rendered';
  /** Makes chapterTagsEmbed always reject, to review the error state. */
  chapterTagsEmbedAlwaysErrors?: boolean;
  /** Seeds the recording coverage mock (a refusal for every start, or stale chapters), see `CoverageSeed`. */
  coverage?: CoverageSeed;
  /** Seeds the stage recommendations mock (a chapter's recording evidence, a live confirmation, a dismissal), see `StagesSeed`. */
  stages?: StagesSeed;
  /**
   * Boots without the offline dictionary (`missing`) or with one that fails its check (`damaged`), so a lookup answers with its first-use
   * gate (story-bible-and-import-ux-briefs.prd.md Phases 7-8). A download seed of `assets` boots without it too.
   */
  dictionary?: 'missing' | 'damaged';
  /** Seeds the findings store the review bindings answer from; defaults to `WIRE_FINDINGS` (an empty list is an empty queue). */
  findings?: Finding[];
  /** The findings' analyzer runs again right after the page first lists them, so a decision on what it showed is refused as stale. */
  findingsRerun?: boolean;
  /** What the Review page's REAPER does for Go to, Loop and Stop; connected when not given. */
  reaper?: MockReaper;
  /** Holds a started pickup and duplicate scan part way through, so its real progress can be looked at (take review Phase 5). */
  takeReviewScanHold?: boolean;
  /** Holds a started take comparison part way through, so its real progress can be looked at (take review Phase 10). */
  takeComparisonHold?: boolean;
  /** Holds a started measurement part way through, so its real progress can be looked at, or breaks it (diagnostics PRD Phases 1 and 5). */
  measure?: MockMeasureSeed;
  /** Holds a started diagnostics check part way through, or breaks it (diagnostics PRD Phase 6). */
  diagnostics?: MockDiagnosticsSeed;
  /** Seeds the editing-readiness check mock (a refusal, a held-running state, or seeded candidates), see `EditingSeed`. */
  editing?: EditingSeed;
  /** Seeds the preview-candidates mock (an outcome or seeded candidates), see `PreviewSeed`. */
  preview?: PreviewSeed;
  /** The project's Delivery limits, by key (`true_peak_dbtp_max: '-3'`), set as if saved in Settings (diagnostics PRD Phase 5). */
  deliveryLimits?: Record<string, string>;
  /**
   * `mixed` adds a buttonless Front Matter chapter (contentKind 'opening', a 3-digit word count) before the Alice
   * chapters and raises one chapter's word count to 5 digits, so the header alignment mock has a mix of 3-, 4- and
   * 5-digit counts and a row with no Read aloud button alongside rows that have one
   * (manuscript-chapter-header-alignment.prd.md), plus four heading shapes - source capitals with a subtitle, no
   * subtitle, a long subtitle, a title already ending in a colon - for chapterName()/TitleSubtitle
   * (chapter-title-display-consistency.prd.md). Off by default so every existing screenshot is unchanged.
   */
  mockManuscript?: 'mixed';
  /** Boots with a custom delivery profile chosen for the project (delivery-platform-profiles.prd.md); ACX judges otherwise. */
  deliveryProfile?: MockDeliveryProfileSeed;
};

export const wireContext = (payload: string) => ({ boundary: 'host.binding', payload });

// The confirmed chapter-track mapping (analysis evidence ledger PRD, Phase 5): keyed to one mock documentId, since the
// mock always has exactly one manuscript document loaded.
export const mockDocumentId = 'mock-document-1';

/** The host state more than one domain reads or writes, kept in one place so every domain sees the same values. */
export type MockState = {
  entities: GuideEntity[];
  chapters: ManuscriptChapter[];
  paragraphs: ManuscriptParagraph[];
  /** One counter for every id the mock hands out (Story Bible entities, reader bookmarks, notes). */
  nextId: number;
  tracksDiscovery: TracksDiscovery;
  chapterTrackMappings: TrackMapping[];
  jobEndListeners: Set<(event: JobEnded) => void>;
  endJob: (event: JobEnded) => void;
};

export function createMockState(initial: MockApiSeed): MockState {
  // One candidate auto-selects (like the Go host); several leave the choice to the narrator.
  const tracksCandidates = initial.tracksCandidates ?? [WIRE_TRACKS_PROJECT.path];
  // A job that ends tells whoever listens, after the call that started it has returned, the way the host does (ADR 0076). The mock ends
  // only the Story Bible rebuild this way: its comparison run is driven by a timer the visual suite steps through, and a toast raised at
  // the end of one would land in every screenshot of the results.
  const jobEndListeners = new Set<(event: JobEnded) => void>();
  return {
    entities: wireClone(WIRE_ENTITIES),
    chapters: wireClone(WIRE_CHAPTERS),
    paragraphs: wireClone(WIRE_PARAGRAPHS),
    nextId: 1,
    tracksDiscovery: { candidates: tracksCandidates, selected: tracksCandidates.length === 1 ? tracksCandidates[0] : '' },
    // A seed built before links had an origin (ADR 0202) reads as the narrator's own link, as the host reads a v1 file.
    chapterTrackMappings: wireClone(initial.chapterTrackMappings ?? []).map((link) => ({ origin: 'manual', match: null, ...link })),
    jobEndListeners,
    endJob: (event) => void setTimeout(() => jobEndListeners.forEach((listener) => listener(event)), 0),
  };
}
