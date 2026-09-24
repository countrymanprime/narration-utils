// Browser/mock API. It deliberately uses the same literal fixture data
// everywhere so visual review never silently exercises placeholder
// content instead of the screen we are trying to match.
import { parseWire, parseWireJson } from './wire/parseWire';
import { chaptersSchema } from './schemas/manuscript';
import { guideEntitiesSchema, guidePropertiesSchema } from './schemas/storyBible';
import { bootstrapSchema } from './schemas/system';
import type {
  ChapterTagsPreview,
  CreditsAnnouncement,
  CreditsRenderResult,
  CreditsStatuses,
  CreditTemplate,
  CreditValues,
  DawCatalogEntry,
  GuideEntity,
  GuideEvidence,
  GuideProperty,
  GuidePronunciation,
  LineIdentityState,
  ManuscriptChapter,
  ManuscriptNote,
  ManuscriptParagraph,
  NarrationApi,
  PickupsMoment,
  PickupsState,
  ProjectAttachState,
  ReaderBookmark,
  ReaderState,
  RecentProject,
  RenderConfigState,
  CleanupToolsState,
  RetakeLanesState,
  RetailSampleAnswer,
  Scope,
  ScopedSettingField,
  Finding,
  TeleprompterDevice,
  TrackMapping,
  TracksDiscovery,
  TranscriptState,
  WorkJob,
} from '../types';
import { DESKTOP_HOST_API_VERSION } from '../hostApi';
import type { JobEnded } from './contracts/system';
import type { UpdateJob, UpdateStatus } from './contracts/update';
import {
  aliceChapterSeeds,
  WIRE_CHAPTERS,
  WIRE_DISCREPANCIES,
  WIRE_ENTITIES,
  WIRE_LINE_IDENTITY_ERROR,
  WIRE_LINE_IDENTITY_IDLE,
  WIRE_LINE_IDENTITY_READ_SUCCESS,
  WIRE_LINE_IDENTITY_STAMP_CONFLICT,
  WIRE_LOGS,
  WIRE_NOTES,
  WIRE_PARAGRAPHS,
  WIRE_PICKUPS_ERROR,
  WIRE_PICKUPS_EXPORT_SUCCESS,
  WIRE_PICKUPS_IDLE,
  WIRE_PICKUPS_IMPORT_SUCCESS,
  WIRE_PICKUPS_NEXT_SUCCESS,
  withFormatting,
  WIRE_READER_STATE,
  WIRE_CHAPTER_TAGS_EMBED_SUCCESS,
  WIRE_CHAPTER_TAGS_PREVIEW_IDLE,
  WIRE_CHAPTER_TAGS_PREVIEW_NOT_RENDERED,
  WIRE_CHAPTER_TAGS_PREVIEW_READY,
  WIRE_RENDER_CONFIG_ERROR,
  WIRE_CLEANUP_TOOLS_ERROR,
  WIRE_CLEANUP_TOOLS_IDLE,
  WIRE_CLEANUP_TOOLS_LAUNCHED,
  WIRE_RETAKE_LANES_ERROR,
  WIRE_RETAKE_LANES_IDLE,
  WIRE_RETAKE_LANES_LIST,
  WIRE_RETAKE_LANES_NONE,
  WIRE_RETAKE_LANES_PICKED,
  WIRE_RENDER_CONFIG_IDLE,
  WIRE_RENDER_CONFIG_NO_REGIONS,
  WIRE_RENDER_CONFIG_SUCCESS,
  WIRE_FINDINGS,
  WIRE_TELEPROMPTER_DEVICES,
  WIRE_TRACKS_PROJECT,
  WIRE_TRANSCRIPT,
  wireClone,
  wireSettings,
} from './mockFixtures';
import { loadAliceManuscript } from './aliceManuscript';
import { mockChapterTrackLinks, mockChapterTrackMatch, mockRecordedLength } from './chapterTrackMatchMock';
import { mockChapterSuggestion } from './chapterSuggestionMock';
import { mockImportPreview, mockImportPreviewLog, type MockImportKind } from './mockImportPreview';
import { createTeleprompterMock, type TeleprompterSeed } from './teleprompterMock';
import { createCoverageMock, type CoverageSeed } from './coverageMock';
import { createStagesMock, type StagesSeed } from './stagesMock';
import type { MockResumeSeed } from './resumeMockSeed';
import { createFindingsMock, type MockReaper } from './findingsMock';
import { createTakeReviewScanMock } from './takeReviewMock';
import { createTakeComparisonMock } from './takeComparisonMock';
import { createMeasureMock, type MockMeasureSeed } from './measureMock';
import { createDiagnosticsMock, type MockDiagnosticsSeed } from './diagnosticsMock';
import { createInstallMock, installSeedFor, LOCAL_ASSETS_SEEDS, type MockAssetSeed } from './assetInstallMock';
import type { AssetInstallState } from './contracts/assets';
import { MOCK_DICTIONARY, MOCK_DICTIONARY_DISK_SIZE, MOCK_DICTIONARY_DOWNLOAD_SIZE, mockDictionaryLookup } from './dictionaryMock';

const DEFAULT_PROJECT_FOLDER = 'C:/Projects/Alice-in-Wonderland';
const DEFAULT_PROJECT_NAME = 'Alice’s Adventures in Wonderland';
// Mirrors the Go host's Phase 1 default (`~/NarrationUtils`, project.DefaultDirName): what an empty parent
// resolves to in ProjectCreateIn.
const DEFAULT_PROJECTS_DIRECTORY = 'C:/Users/Mock/NarrationUtils';

/** Mirrors the Go backend's `filepath.Base(path)` default-naming rule for a folder chosen with no explicit name. */
/** What the sidecar does with the `properties` value of an edit: a JSON list of pairs, a name on every one and no name twice (whatever its case). */
function parseMockProperties(text: string): GuideProperty[] {
  const seen = new Set<string>();
  return parseWireJson(guidePropertiesSchema, text, wireContext('mock properties')).map((row, index) => {
    const key = row.key.trim();
    if (!key) throw new Error(`Property ${index + 1} has no name.`);
    if (seen.has(key.toLowerCase())) throw new Error(`There are two properties named '${key}'; give each a different name.`);
    seen.add(key.toLowerCase());
    return { key, value: row.value.trim() };
  });
}

function basename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

/**
 * A real, silent 22.05 kHz mono WAV (a 44-byte header and 200 bytes of samples). The Story Bible preview hook
 * rejects an empty payload (the host never sends one), so the mock must send audio.
 */
const MOCK_PREVIEW_WAV_BASE64 =
  'UklGRuwAAABXQVZFZm10IBAAAAABAAEAIlYAAESsAAACABAAZGF0YcgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==';

const MOCK_AUDIO_SECONDS = 600;
/** The version the mock host reports as its own; the update states (`MockUpdateSeed`) offer a newer one. */
const MOCK_APP_VERSION = '0.2.6';
const MOCK_DEVELOPMENT_VERSION = '0.0.0-dev';
const MOCK_CHECKED_AT = '2026-09-21T12:00:00Z';

/** Which update state the mock host boots in: `available` found a newer release, `found` is the same and the host also says so at once, as a background check does, `downloading` is the same with a download that stops at 40% (to look at the dialog) and `download-fails` one that ends in an error, `failed` could not reach GitHub, `current` checked and is up to date, `development` is a build with no release to compare with. Without one, nothing has been checked yet. */
export type MockUpdateSeed =
  'available' | 'found' | 'downloading' | 'download-fails' | 'ready' | 'install-blocked' | 'install-refused' | 'failed' | 'current' | 'development';

function seedUpdateStatus(seed: MockUpdateSeed | undefined): UpdateStatus {
  const status: UpdateStatus = {
    version: MOCK_APP_VERSION,
    development: false,
    platform: 'windows-x64',
    channel: 'candidates',
    canInstall: true,
    installBlockedReason: '',
    downloaded: null,
    lastChecked: '',
    failure: '',
    available: null,
  };
  switch (seed) {
    case 'install-blocked':
      return {
        ...seedUpdateStatus('available'),
        canInstall: false,
        installBlockedReason:
          'Narration Utils is installed where it is not allowed to replace itself. Download the update and replace the program yourself, or ask whoever manages this computer.',
      };
    case 'available':
    case 'found':
    case 'downloading':
    case 'download-fails':
    case 'ready':
    case 'install-refused':
      return {
        ...status,
        lastChecked: MOCK_CHECKED_AT,
        available: {
          version: '0.2.7',
          tag: 'v0.2.7-rc',
          candidate: true,
          notesUrl: 'https://github.com/countrymanprime/narration-utils/releases/tag/v0.2.7-rc',
          size: 419_895_808,
          publishedAt: '2026-09-20T10:00:00Z',
          replaces: true,
        },
      };
    case 'failed':
      return { ...status, failure: 'Could not reach GitHub to check for updates.' };
    case 'current':
      return { ...status, lastChecked: MOCK_CHECKED_AT };
    case 'development':
      return {
        ...status,
        version: MOCK_DEVELOPMENT_VERSION,
        development: true,
        canInstall: false,
        installBlockedReason: 'A development build does not update itself.',
      };
    default:
      return status;
  }
}
let mockAudioUrl: string | undefined;

/**
 * Browser mock mode has no /media route, so play, skip, and the time readout
 * would have nothing to act on. This serves a real, silent WAV from memory
 * instead. It's built lazily and only where object URLs exist (not jsdom).
 */
function mockAudioSource(): string | undefined {
  if (typeof URL.createObjectURL !== 'function') return undefined;
  if (!mockAudioUrl) {
    const sampleRate = 8000;
    const dataBytes = sampleRate * MOCK_AUDIO_SECONDS;
    const wav = new Uint8Array(44 + dataBytes).fill(128); // unsigned 8-bit silence
    const view = new DataView(wav.buffer);
    const text = (offset: number, value: string) => [...value].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
    text(0, 'RIFF');
    view.setUint32(4, 36 + dataBytes, true);
    text(8, 'WAVE');
    text(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate, true);
    view.setUint16(32, 1, true);
    view.setUint16(34, 8, true);
    text(36, 'data');
    view.setUint32(40, dataBytes, true);
    mockAudioUrl = URL.createObjectURL(new Blob([wav], { type: 'audio/wav' }));
  }
  return mockAudioUrl;
}

const wireContext = (payload: string) => ({ boundary: 'host.binding', payload });

// A JS mirror of apps/desktop/internal/credits.Render: `[Token]` placeholders resolved from `values`, and `{...}`
// optional segments dropped whole (their own punctuation with them) when any token inside is unresolved (PRD
// audiobook-credits-templates.prd.md, Open Questions C5/C6). Kept deliberately close to the Go renderer so the mock's
// preview behaves like the real one; it does not need to be the same implementation, only the same behavior.
function renderMockCredits(template: string, values: Record<string, string>): CreditsRenderResult {
  const unresolved: string[] = [];
  const noteUnresolved = (name: string) => {
    if (!unresolved.includes(name)) unresolved.push(name);
  };
  const renderTokens = (fragment: string, onUnresolved?: (name: string) => void) =>
    fragment.replace(/\[([^[\]{}]+)]/g, (match, name: string) => {
      const value = values[name];
      if (value) return value;
      onUnresolved?.(name);
      return match;
    });
  let text = '';
  let remaining = template;
  for (;;) {
    const open = remaining.indexOf('{');
    if (open === -1) {
      text += renderTokens(remaining, noteUnresolved);
      break;
    }
    const closeIndex = remaining.indexOf('}', open);
    if (closeIndex === -1) {
      text += renderTokens(remaining, noteUnresolved);
      break;
    }
    text += renderTokens(remaining.slice(0, open), noteUnresolved);
    const segment = remaining.slice(open + 1, closeIndex);
    let complete = true;
    const resolvedSegment = renderTokens(segment, () => {
      complete = false;
    });
    if (complete) text += resolvedSegment;
    remaining = remaining.slice(closeIndex + 1);
  }
  const words = text.split(/\s+/).filter(Boolean).length;
  return { text, words, unresolved };
}

function resolveMockCreditValues(values: CreditValues, narratorGlobal: string): Record<string, string> {
  return {
    Title: values.title ?? '',
    Subtitle: values.subtitle ?? '',
    Author: values.author ?? '',
    Series: values.series ?? '',
    'Book Number': values.bookNumber ?? '',
    Copyright: values.copyright ?? '',
    Year: values.year ?? '',
    'Copyright Holder': values.copyrightHolder ?? '',
    Publisher: values.publisher ?? '',
    Narrator: values.narrator || narratorGlobal,
  };
}

// `?mockManuscript=mixed` (manuscript-chapter-header-alignment.prd.md): a buttonless row (Front Matter, contentKind
// 'opening') before the narration chapters, and one narration chapter's word count raised to 5 digits, so the
// header's stat block and action slot can be shown lining up across a 3-, a 4- and a 5-digit count, with and without
// a Read aloud button, without a second, forked mock. A pure function (not inlined in the Alice-loading promise
// chain) so it has its own unit test, independent of whether the bundled Alice text loads in a given environment.
export function applyMixedManuscriptMock(
  chapters: ManuscriptChapter[],
  paragraphs: ManuscriptParagraph[],
): { chapters: ManuscriptChapter[]; paragraphs: ManuscriptParagraph[] } {
  const frontMatterId = 'front-matter';
  const frontMatterParagraph: ManuscriptParagraph = {
    id: 'p-front-matter-0',
    chapterId: frontMatterId,
    chapter: 'Front Matter',
    index: -1,
    sourceLine: 1,
    text: 'Also by the same author.',
    entityIds: [],
  };
  const frontMatter: ManuscriptChapter = {
    id: frontMatterId,
    title: 'Front Matter',
    index: -1,
    wordCount: 318,
    status: 'not_started',
    contentKind: 'opening',
    paragraphIds: [{ id: frontMatterParagraph.id, index: frontMatterParagraph.index }],
  };
  return {
    chapters: [frontMatter, ...chapters.map((chapter, index) => (index === 0 ? { ...chapter, wordCount: 12_406 } : chapter))],
    paragraphs: [frontMatterParagraph, ...paragraphs],
  };
}

// A JS mirror of apps/desktop/internal/credits.MeasureSample (Phase 5, ADR 0152): the range start..end of the paragraphs in
// book order, its lines within each chapter, and its length at 9,300 words per finished hour, refused over 5 minutes.
const MOCK_WORDS_PER_FINISHED_HOUR = 9300;
const MOCK_MAX_RETAIL_SAMPLE_SECONDS = 300;
function measureMockRetailSample(paragraphs: ManuscriptParagraph[], startId: string, endId: string): RetailSampleAnswer['sample'] {
  const perChapter = new Map<string, number>();
  const lines = paragraphs.map((paragraph) => {
    const line = (perChapter.get(paragraph.chapterId) ?? 0) + 1;
    perChapter.set(paragraph.chapterId, line);
    return line;
  });
  const start = paragraphs.findIndex((paragraph) => paragraph.id === startId);
  const end = paragraphs.findIndex((paragraph) => paragraph.id === endId);
  if (start === -1 || end === -1) throw new Error("the retail sample's lines are not in this manuscript; pick the range again");
  if (end < start) throw new Error('the retail sample ends before it starts');
  const words = paragraphs.slice(start, end + 1).reduce((total, paragraph) => total + paragraph.text.split(/\s+/).filter(Boolean).length, 0);
  const seconds = (words * 3600) / MOCK_WORDS_PER_FINISHED_HOUR;
  if (words * 3600 > MOCK_MAX_RETAIL_SAMPLE_SECONDS * MOCK_WORDS_PER_FINISHED_HOUR) {
    const whole = Math.round(seconds);
    const about =
      whole >= 3600
        ? `${Math.floor(whole / 3600)}h ${String(Math.floor((whole % 3600) / 60)).padStart(2, '0')}m`
        : `${Math.floor(whole / 60)}m ${String(whole % 60).padStart(2, '0')}s`;
    throw new Error(`a retail sample can be at most 5 minutes; this range is ${words} words, about ${about}`);
  }
  return {
    startParagraphId: startId,
    endParagraphId: endId,
    startChapterId: paragraphs[start].chapterId,
    startLine: lines[start],
    endChapterId: paragraphs[end].chapterId,
    endLine: lines[end],
    words,
    seconds,
  };
}

/** Answers that go through the real `parseWire` with a payload of the wrong shape, so the failure screens can be seen without a host. */
function invalidPayloadOverrides(which: 'bootstrap' | 'manuscript' | 'storybible', base: NarrationApi): Partial<NarrationApi> {
  switch (which) {
    case 'bootstrap':
      return { bootstrap: async () => parseWire(bootstrapSchema, { ...(await base.bootstrap()), projectName: null }, wireContext('Bootstrap')) };
    case 'manuscript':
      return {
        manuscriptChapters: async () => parseWire(chaptersSchema, [{ id: 'c-0001', title: 'Chapter One', index: 'first' }], wireContext('ManuscriptChapters')),
      };
    case 'storybible':
      return { guideEntities: async () => parseWire(guideEntitiesSchema, [{ id: 7, canonical_name: 'Alice' }], wireContext('GuideEntities')) };
  }
}

type AssetFactsSource = {
  id: string;
  displayName: string;
  version: string;
  publisher: string;
  license: string;
  licenseUrl: string;
  modelCardUrl: string;
  provenanceUrl: string;
  attribution: string;
  downloadSize: number;
};

/** Where the mock says downloaded assets are kept. */
const MOCK_ASSET_ROOT = 'C:/Users/narrator/AppData/Local/narration-utils/assets';

export function createMockApi(
  overrides: Partial<NarrationApi> = {},
  // manuscriptCandidate boots a project with no imported manuscript but a
  // manuscript file waiting in its folder (Home offers to import it, ADR-0019).
  // teleprompter boots with a session already part-way through the first chapter.
  initial: {
    projectFolder?: string;
    tracksCandidates?: string[];
    noManuscript?: boolean;
    manuscriptCandidate?: { path: string; name: string };
    teleprompter?: TeleprompterSeed;
    /** The project's own credits values at boot (the credits on the teleprompter with every token resolved, Phase 4). */
    creditValues?: CreditValues;
    /** Adds a chapter announcement template with this body to the library at boot (Phase 5). */
    chapterAnnouncement?: string;
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
    /** Which resume card state `teleprompterLocate` answers for every chapter (see `MockResumeSeed`). */
    resume?: MockResumeSeed;
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
    /** The project's Delivery limits, by key (`true_peak_dbtp_max: '-3'`), set as if saved in Settings (diagnostics PRD Phase 5). */
    deliveryLimits?: Record<string, string>;
    /**
     * `mixed` adds a buttonless Front Matter chapter (contentKind 'opening', a 3-digit word count) before the Alice
     * chapters and raises one chapter's word count to 5 digits, so the header alignment mock has a mix of 3-, 4- and
     * 5-digit counts and a row with no Read aloud button alongside rows that have one
     * (manuscript-chapter-header-alignment.prd.md). Off by default so every existing screenshot is unchanged.
     */
    mockManuscript?: 'mixed';
  } = {},
): NarrationApi {
  let updateStatus = seedUpdateStatus(initial.update);
  let updateJob: UpdateJob | undefined =
    initial.update === 'ready' || initial.update === 'install-refused'
      ? {
          id: 'mock-update',
          version: '0.2.7',
          phase: 'ready',
          message: 'Version 0.2.7 is downloaded and checked.',
          percent: 100,
          bytesDone: 419_895_808,
          bytesTotal: 419_895_808,
          error: '',
        }
      : undefined;
  let updateJobTimer: ReturnType<typeof setInterval> | undefined;
  const mockUpdateStatus = (): UpdateStatus => ({
    ...updateStatus,
    downloaded: updateJob?.phase === 'ready' && updateStatus.available ? { jobId: updateJob.id, version: updateJob.version } : null,
  });
  let entities = wireClone(WIRE_ENTITIES);
  let chapters = wireClone(WIRE_CHAPTERS);
  let paragraphs = wireClone(WIRE_PARAGRAPHS);
  let notes = wireClone(WIRE_NOTES);
  let readerState: ReaderState = wireClone(WIRE_READER_STATE);
  let hints: string[] = [];
  let projectFolder = initial.projectFolder ?? DEFAULT_PROJECT_FOLDER;
  let projectName = initial.projectFolder === undefined ? DEFAULT_PROJECT_NAME : basename(projectFolder);
  let daw = 'REAPER';
  // Whether the mock project has a linked DAW project file (PRD W13/W14/W19), independent of `daw`: real Bootstrap
  // computes this from the manifest, not the label. Defaults to true so the existing default-linked mock scenarios
  // (App.test.tsx clicking into Proofing) keep working; attaching a different project resets it, like a fresh
  // project would have no link yet.
  let dawFileLinked = initial.dawFileLinked ?? true;
  let dawRppPath = `${projectFolder}/${basename(projectFolder)}.rpp`;
  // Independent of dawFileLinked/dawReachable: a Phase 1 detection fact about the machine, not about this
  // project's link (docs/architecture/daw-integration.md). Defaults to true so the default capture shows
  // REAPER detected; ?mockDawNotDetected=1 flips it for the not-detected + "Get REAPER" state.
  const dawCatalogInstalled = initial.dawCatalogInstalled ?? true;
  const DAW_CATALOG: DawCatalogEntry[] = [
    {
      id: 'reaper',
      name: 'REAPER',
      publisher: 'Cockos Incorporated',
      licenseNote: "A fully-functional evaluation license from the publisher's own site; see their page for terms.",
      installed: dawCatalogInstalled,
      ...(dawCatalogInstalled ? { path: 'C:/Program Files/REAPER (x64)/reaper.exe', source: 'uninstall_registry' } : {}),
    },
  ];
  // One candidate auto-selects (like the Go host); several leave the choice to the narrator.
  const tracksCandidates = initial.tracksCandidates ?? [WIRE_TRACKS_PROJECT.path];
  let tracksDiscovery: TracksDiscovery = { candidates: tracksCandidates, selected: tracksCandidates.length === 1 ? tracksCandidates[0] : '' };
  // The confirmed chapter-track mapping (analysis evidence ledger PRD, Phase 5): keyed to one mock documentId, since the
  // mock always has exactly one manuscript document loaded.
  const mockDocumentId = 'mock-document-1';
  let chapterTrackMappings: TrackMapping[] = wireClone(initial.chapterTrackMappings ?? []);
  let recentProjects: RecentProject[] = [
    { path: 'C:/Projects/Alice-in-Wonderland', name: 'Alice’s Adventures in Wonderland', lastOpened: '2026-09-15T09:00:00Z' },
    { path: 'C:/Projects/Voltage-and-the-Undercroft', name: 'Voltage and the Undercroft', lastOpened: '2026-09-10T18:30:00Z' },
  ];
  // Mirrors apps/desktop/internal/credits' shipped defaults (PRD audiobook-credits-templates.prd.md, Phase 1) so a
  // mock session shows the same starting library as the real host.
  let creditTemplates: CreditTemplate[] = [
    {
      id: 'default-opening-acx-minimum',
      kind: 'opening',
      name: 'ACX minimum (opening)',
      body: '[Title], written by [Author], narrated by [Narrator].',
      builtIn: true,
    },
    {
      id: 'default-closing-acx-best-practice',
      kind: 'closing',
      name: 'ACX best practice (closing)',
      body: 'You have been listening to [Title], written by [Author], narrated by [Narrator]. The End.',
      builtIn: true,
    },
    {
      id: 'default-with-copyright',
      kind: 'closing',
      name: 'With copyright (contractual)',
      body: '[Title]. Written by [Author]. Read by [Narrator]. Copyright by [Copyright].',
      builtIn: true,
    },
  ];
  if (initial.chapterAnnouncement !== undefined)
    creditTemplates.push({ id: 'mock-chapter-announcement', kind: 'chapter_announcement', name: 'Chapter announcement', body: initial.chapterAnnouncement });
  let nextCreditTemplateId = 1;
  let creditValues: CreditValues = wireClone(initial.creditValues ?? {});
  let creditsStatuses: CreditsStatuses = {};
  let retailSample: { startParagraphId: string; endParagraphId: string } | undefined;
  let seededSample = initial.retailSample;
  const readRetailSample = (): RetailSampleAnswer => {
    if (seededSample) {
      const ids = 'chapterIndex' in seededSample ? (chapters[seededSample.chapterIndex]?.paragraphIds ?? []) : [];
      retailSample =
        'chapterIndex' in seededSample
          ? { startParagraphId: ids[seededSample.startLine - 1]?.id ?? '', endParagraphId: ids[seededSample.endLine - 1]?.id ?? '' }
          : { ...seededSample };
      seededSample = undefined;
    }
    if (!retailSample) return { sample: null, problem: '' };
    try {
      return { sample: measureMockRetailSample(paragraphs, retailSample.startParagraphId, retailSample.endParagraphId), problem: '' };
    } catch (error) {
      return { sample: null, problem: error instanceof Error ? error.message : String(error) };
    }
  };
  const mockNarratorGlobal = () => settings.global.General.find((field) => field.key === 'narrator_name')?.effectiveValue ?? '';
  // The credits text a teleprompter session reads (Phase 4, ADR 0150): the first template of the kind (ADR 0093), rendered
  // as `creditsPreview` renders it, as the host's creditsScript does.
  const mockCreditsText = (kind: 'opening' | 'closing') => {
    const template = creditTemplates.find((item) => item.kind === kind);
    return template ? renderMockCredits(template.body, resolveMockCreditValues(creditValues, mockNarratorGlobal())).text : undefined;
  };
  const projectAttachSubscribers = new Set<(state: ProjectAttachState) => void>();
  const attachProject = (path: string, name?: string) => {
    projectFolder = path;
    projectName = name || basename(path);
    daw = 'Standalone';
    // A newly attached project has no stored DAW link yet, matching the real host: dawFileLinked is computed from
    // the new project's own manifest, not carried over from whatever was open before.
    dawFileLinked = false;
    dawRppPath = `${projectFolder}/${projectName}.rpp`;
    projectAttachSubscribers.forEach((fn) => fn({ attached: true }));
    return { switched: true };
  };
  const manuscriptReady = loadAliceManuscript(aliceChapterSeeds).then((loaded) => {
    if (!loaded) return;
    chapters = loaded.chapters;
    // The real text needs the same preserved formatting/line-break sample as
    // the seed fixture, so the reader shows both in either data source.
    paragraphs = loaded.paragraphs.map(withFormatting).map((paragraph) => ({
      ...paragraph,
      entityIds: entities
        .filter((entity) => [entity.canonical_name, ...entity.aliases.map((alias) => alias.text)].some((term) => paragraph.text.includes(term)))
        .map((entity) => entity.id),
    }));
    // The host's chapter list carries each chapter's paragraph ids/indexes, which
    // "Go to line" deep links (#p<index>) use to find the owning chapter.
    chapters = chapters.map((chapter) => ({
      ...chapter,
      paragraphIds: paragraphs.filter((paragraph) => paragraph.chapterId === chapter.id).map(({ id, index }) => ({ id, index })),
    }));
    if (initial.mockManuscript === 'mixed') {
      const mixed = applyMixedManuscriptMock(chapters, paragraphs);
      chapters = mixed.chapters;
      paragraphs = mixed.paragraphs;
    }
    // WIRE_ENTITIES' occurrence paragraph numbers are computed against the
    // small local seed fixture, not the real manuscript text just loaded
    // above, so they'd point at the wrong line ("go to line" landing
    // nowhere near the actual occurrence) - recompute them against the
    // paragraphs that are now actually in the reader.
    const evidenceFor = (term: string): GuideEvidence[] =>
      paragraphs
        .filter((paragraph) => paragraph.text.includes(term))
        .map((paragraph) => ({ chapter: paragraph.chapter, paragraph: paragraph.index, sourceLine: paragraph.sourceLine, excerpt: paragraph.text }));
    entities = entities.map((entity) => {
      const occurrences = evidenceFor(entity.canonical_name);
      const aliases = entity.aliases.map((alias) => ({ ...alias, occurrences: evidenceFor(alias.text) }));
      return {
        ...entity,
        occurrences,
        aliases,
        occurrence_count: occurrences.length + aliases.reduce((total, alias) => total + alias.occurrences.length, 0),
      };
    });
  });
  const vocabularyCandidates = Array.from(new Set(entities.flatMap((entity) => [entity.canonical_name, ...entity.aliases.map((alias) => alias.text)])));
  let transcript: TranscriptState = wireClone(WIRE_TRANSCRIPT);
  let lastCompleted: TranscriptState = {
    ...wireClone(WIRE_TRANSCRIPT),
    phase: 'success',
    percent: 100,
    elapsed: 42,
    message: 'Comparison complete.',
    summary: `${WIRE_DISCREPANCIES.length} discrepancies found.`,
    logs: WIRE_LOGS.map((entry) => entry.text),
    rows: wireClone(WIRE_DISCREPANCIES),
    trackName: 'Chapter 1',
    audioItemCount: 3,
    completedAt: '2026-09-15T14:30:00Z',
  };
  const globalSettings = wireSettings();
  const settings: Record<Scope, Record<string, ScopedSettingField[]>> = {
    global: globalSettings,
    project: Object.fromEntries(
      Object.entries(globalSettings).map(([tool, fields]) => [
        tool,
        // A field set in Global is inherited from there; one set nowhere keeps the default the host would send.
        fields.map((field) => ({
          ...field,
          value: '',
          isSet: false,
          effectiveValue: field.isSet ? field.value : field.effectiveValue,
          effectiveSource: field.isSet ? 'Global' : field.effectiveSource,
        })),
      ]),
    ),
  };
  const deliveryLimits = initial.deliveryLimits ?? {};
  settings.project.Delivery = settings.project.Delivery.map((field) =>
    field.key in deliveryLimits
      ? { ...field, value: deliveryLimits[field.key], isSet: true, effectiveValue: deliveryLimits[field.key], effectiveSource: 'project' }
      : field,
  );
  const subscribers = new Set<(state: TranscriptState) => void>();
  let nextId = 1;
  let lineIdentity: LineIdentityState = wireClone(
    initial.lineIdentity === 'success'
      ? WIRE_LINE_IDENTITY_READ_SUCCESS
      : initial.lineIdentity === 'conflict'
        ? WIRE_LINE_IDENTITY_STAMP_CONFLICT
        : initial.lineIdentity === 'error'
          ? WIRE_LINE_IDENTITY_ERROR
          : WIRE_LINE_IDENTITY_IDLE,
  );
  const lineIdentitySubscribers = new Set<(state: LineIdentityState) => void>();
  const publishLineIdentity = () => lineIdentitySubscribers.forEach((fn) => fn(wireClone(lineIdentity)));
  let pickups: PickupsState = wireClone(
    initial.pickups === 'import-success'
      ? WIRE_PICKUPS_IMPORT_SUCCESS
      : initial.pickups === 'next-success'
        ? WIRE_PICKUPS_NEXT_SUCCESS
        : initial.pickups === 'export-success'
          ? WIRE_PICKUPS_EXPORT_SUCCESS
          : initial.pickups === 'error'
            ? WIRE_PICKUPS_ERROR
            : WIRE_PICKUPS_IDLE,
  );
  // The pickups a real REAPER project would still have open: seeded to match whichever WIRE_PICKUPS_* fixture
  // booted above, so Next and Resolve behave consistently with what the seed already shows as remaining.
  let pickupsOpen: PickupsMoment[] =
    initial.pickups === undefined || initial.pickups === 'error'
      ? []
      : [
          { position: 9.25, tag: 'narrator', note: 'Mispronounced "labyrinthine"' },
          { position: 42, tag: '', note: 'Dog barked in the background' },
        ];
  let pickupsResolvedCount = 0;
  // The 'error' seed models a broken REAPER script (the recurring cause a real ERROR event reports), not a
  // one-off: every action keeps failing the same way until the narrator fixes REAPER and reopens, the same as
  // a real session import_pickups/next_pickup/etc. would if the script itself is what's wrong.
  const pickupsAlwaysErrors = initial.pickups === 'error';
  const pickupsSubscribers = new Set<(state: PickupsState) => void>();
  const publishPickups = () => pickupsSubscribers.forEach((fn) => fn(wireClone(pickups)));
  // Mirrors the Go service's begin(): every new run starts from a clean state (no stale next/resolved/importReport/csv
  // from a previous run), except remaining/total, which survive so the count does not flash back to zero.
  const beginPickups = (phase: PickupsState['phase'], message: string) => {
    pickups = { ...wireClone(WIRE_PICKUPS_IDLE), runId: String(Date.now()), phase, message, remaining: pickups.remaining, total: pickups.total };
  };
  // A run's settled outcome is either onSuccess (the normal path) or, when pickupsAlwaysErrors, the same
  // REAPER error every time. Every action's setTimeout callback runs this instead of writing its own success
  // state directly, so the 'error' seed stays broken across every action, not just the first.
  const settlePickups = (onSuccess: () => void) => {
    if (pickupsAlwaysErrors) {
      pickups = { ...pickups, phase: 'error', message: WIRE_PICKUPS_ERROR.message };
    } else {
      onSuccess();
    }
    publishPickups();
  };
  // A job that ends tells whoever listens, after the call that started it has returned, the way the host does (ADR 0076). The mock ends
  // only the Story Bible rebuild this way: its comparison run is driven by a timer the visual suite steps through, and a toast raised at
  // the end of one would land in every screenshot of the results.
  let renderConfig: RenderConfigState = wireClone(
    initial.renderConfig === 'success'
      ? WIRE_RENDER_CONFIG_SUCCESS
      : initial.renderConfig === 'no-regions'
        ? WIRE_RENDER_CONFIG_NO_REGIONS
        : initial.renderConfig === 'error'
          ? WIRE_RENDER_CONFIG_ERROR
          : WIRE_RENDER_CONFIG_IDLE,
  );
  // The 'no-regions' seed models a project with no chapter regions yet (Configure still succeeds - it is just
  // project-info keys - but predicts 0 files); 'error' models a broken REAPER script, sticking the same way the
  // pickups 'error' seed does.
  const renderConfigHasRegions = initial.renderConfig !== 'no-regions';
  const renderConfigAlwaysErrors = initial.renderConfig === 'error';
  const renderConfigSubscribers = new Set<(state: RenderConfigState) => void>();
  const publishRenderConfig = () => renderConfigSubscribers.forEach((fn) => fn(wireClone(renderConfig)));
  let cleanupTools: CleanupToolsState = wireClone(
    initial.cleanupTools === 'launched' ? WIRE_CLEANUP_TOOLS_LAUNCHED : initial.cleanupTools === 'error' ? WIRE_CLEANUP_TOOLS_ERROR : WIRE_CLEANUP_TOOLS_IDLE,
  );
  const cleanupToolsAlwaysErrors = initial.cleanupTools === 'error';
  const cleanupToolsSubscribers = new Set<(state: CleanupToolsState) => void>();
  const publishCleanupTools = () => cleanupToolsSubscribers.forEach((fn) => fn(wireClone(cleanupTools)));
  const retakeLanesList = wireClone(initial.retakeLanes === 'none' ? WIRE_RETAKE_LANES_NONE : WIRE_RETAKE_LANES_LIST);
  let retakeLanes: RetakeLanesState = wireClone(
    initial.retakeLanes === 'picked' ? WIRE_RETAKE_LANES_PICKED : initial.retakeLanes === 'error' ? WIRE_RETAKE_LANES_ERROR : WIRE_RETAKE_LANES_IDLE,
  );
  const retakeLanesAlwaysErrors = initial.retakeLanes === 'error';
  const retakeLanesSubscribers = new Set<(state: RetakeLanesState) => void>();
  const publishRetakeLanes = () => retakeLanesSubscribers.forEach((fn) => fn(wireClone(retakeLanes)));
  // Chapter tag embedding (Phase 12) never talks to REAPER: its preview is a fixed seed, not derived from
  // renderConfig's live state, since the two are independent bindings on the real host too (ChapterTagsPreview
  // reads renderConfig.Snapshot() itself, server-side).
  const chapterTagsPreview: ChapterTagsPreview = wireClone(
    initial.chapterTags === 'ready'
      ? WIRE_CHAPTER_TAGS_PREVIEW_READY
      : initial.chapterTags === 'not-rendered'
        ? WIRE_CHAPTER_TAGS_PREVIEW_NOT_RENDERED
        : WIRE_CHAPTER_TAGS_PREVIEW_IDLE,
  );
  const chapterTagsEmbedAlwaysErrors = initial.chapterTagsEmbedAlwaysErrors === true;
  const jobEndListeners = new Set<(event: JobEnded) => void>();
  const endJob = (event: JobEnded) => void setTimeout(() => jobEndListeners.forEach((listener) => listener(event)), 0);
  let runTimers: ReturnType<typeof setTimeout>[] = [];
  let importJob: WorkJob = { id: null, kind: 'manuscript_import', phase: 'idle', message: 'Ready to import.', percent: 0, logs: [], elapsed: 0 };
  // Choosing a file and accepting the offer of one both begin the same job; the preview it will answer is `initial.importPreview`.
  const startImport = () => {
    importJob = {
      id: 'mock-import',
      kind: 'manuscript_import',
      phase: 'preparing',
      message: 'Manuscript selected. Choose import options to continue.',
      percent: 0,
      logs: ['Selected manuscript'],
      elapsed: 0,
      preview: mockImportPreview(initial.importPreview),
      requiresReset: false,
    };
    return { selected: true, jobId: 'mock-import' };
  };
  let storyBibleJob: WorkJob = initial.rebuildRunning
    ? {
        id: 'mock-guide-running',
        kind: 'story_bible',
        phase: 'running',
        message: 'Extracting names and terms',
        percent: 45,
        logs: ['Reading canonical manuscript', 'Read 240 paragraphs in 3 chapters', 'Extracting names and terms'],
        elapsed: 12,
      }
    : { id: null, kind: 'story_bible', phase: 'idle', message: 'Ready to build.', percent: 0, logs: [], elapsed: 0 };
  let ttsInstalled = false;
  // What the host says about a voice that is not installed yet (Go's previewVoice); the install state and download size are separate keys.
  const mockVoiceIdentity = {
    id: 'en_US-ljspeech-high',
    provider: 'piper',
    displayName: 'LJ Speech (U.S. English)',
    locale: 'en_US',
    version: '1.0.0',
    publisher: 'rhasspy',
    license: 'Public domain training data; Piper Voices repository MIT',
    licenseUrl: 'https://keithito.com/LJ-Speech-Dataset/',
    modelCardUrl: 'https://huggingface.co/rhasspy/piper-voices/blob/v1.0.0/en/en_US/ljspeech/high/MODEL_CARD',
    provenanceUrl: 'https://huggingface.co/rhasspy/piper-voices/tree/v1.0.0/en/en_US/ljspeech/high',
    attribution: 'LJ Speech Dataset (public domain); Piper voice model by rhasspy contributors.',
  };
  const mockVoice = { ...mockVoiceIdentity, downloadSize: 114203981, installState: 'not_installed' as const };
  // Whisper defaults to already installed so existing setup/run flows are not
  // gated in every test; a dedicated scenario calls whisperRemove first to
  // exercise the asset_required prompt.
  // A download seed boots without the model, so a page that needs it asks to download it.
  // The seeds for the Local assets page (installing, checking, damaged) keep it installed, so the page shows a mix of states.
  const localAssetsSeed = initial.assets !== undefined && LOCAL_ASSETS_SEEDS.includes(initial.assets);
  let whisperInstalled = initial.assets === undefined || localAssetsSeed;
  // Damaged: the files are there but no longer match, which is what `verification_failed` (Needs repair) says. A repair or a removal ends it.
  let whisperDamaged = initial.assets === 'damaged';
  const whisperState = (): AssetInstallState => (!whisperInstalled ? 'not_installed' : whisperDamaged ? 'verification_failed' : 'installed');
  // The Story Bible language model is installed by default for the same reason; a download seed boots without it, so the build asks first.
  let spacyInstalled = initial.assets === undefined || localAssetsSeed;
  const mockWhisperIdentity = {
    id: 'small',
    provider: 'faster-whisper',
    displayName: 'Small',
    version: '536b0662742c02347bc0e980a01041f333bce120',
    publisher: 'Systran',
    license: 'MIT',
    licenseUrl: 'https://huggingface.co/Systran/faster-whisper-small',
    modelCardUrl: 'https://huggingface.co/Systran/faster-whisper-small',
    provenanceUrl: 'https://huggingface.co/Systran/faster-whisper-small',
    attribution: 'CTranslate2 conversion of OpenAI Whisper small, published by Systran.',
  };
  const voiceInstall = createInstallMock({
    total: 114203981,
    noun: 'voice',
    extra: { kind: 'tts', assetId: 'en_US-ljspeech-high' },
    seed: installSeedFor(initial.assets),
    onInstalled: () => {
      ttsInstalled = true;
    },
  });
  // A page opened while the voice downloads follows the job through the list's `activeJobId` (the Local assets page, `?mockAssets=installing|checking`).
  if (initial.assets === 'installing' || initial.assets === 'checking') void voiceInstall.start();
  const modelInstall = createInstallMock({
    total: 483546902 + 2370 + 2203239 + 459861,
    noun: 'Whisper model',
    extra: { kind: 'whisper', assetId: 'small' },
    // The Local assets seeds hold the voice download and nothing else: the Whisper model is repaired and reinstalled to the end.
    seed: localAssetsSeed ? undefined : initial.assets,
    onInstalled: () => {
      whisperInstalled = true;
      whisperDamaged = false;
    },
  });
  const mockLanguageModel = {
    id: 'en_core_web_sm',
    provider: 'spacy',
    displayName: 'English, small (fast)',
    description: 'The default: a small download that runs on any computer.',
    version: '3.8.0',
    publisher: 'Explosion',
    license: 'MIT',
    licenseUrl: 'https://spacy.io/models/en#en_core_web_sm',
    modelCardUrl: 'https://github.com/explosion/spacy-models/releases/tag/en_core_web_sm-3.8.0',
    provenanceUrl: 'https://github.com/explosion/spacy-models/releases/tag/en_core_web_sm-3.8.0',
    attribution: 'spaCy English pipeline by Explosion (MIT). Trained on OntoNotes 5, the ClearNLP dependency conversion and WordNet 3.0.',
  };
  const languageModelInstall = createInstallMock({
    total: 12806118,
    noun: 'language model',
    extra: { kind: 'spacy', assetId: 'en_core_web_sm' },
    seed: localAssetsSeed ? undefined : initial.assets,
    onInstalled: () => {
      spacyInstalled = true;
    },
  });
  // The Teleprompter's second live engine (teleprompter-engines-and-input-devices.prd.md phase 7): the real catalog's tiny model
  // (config/moonshine-assets.json), installed or not on the same seeds as the Whisper model.
  let moonshineInstalled = initial.assets === undefined || localAssetsSeed;
  const MOONSHINE_TINY_BYTES = 77748675;
  const mockMoonshineIdentity = {
    id: 'tiny',
    provider: 'moonshine',
    displayName: 'Tiny',
    version: 'quantized_26_08_21',
    publisher: 'Moonshine AI',
    license: 'MIT',
    licenseUrl: 'https://github.com/moonshine-ai/moonshine/blob/main/LICENSE',
    modelCardUrl: 'https://github.com/moonshine-ai/moonshine',
    provenanceUrl: 'https://download.moonshine.ai/model/tiny-streaming-en/quantized_26_08_21',
    attribution: 'Moonshine tiny-streaming-en, published by Moonshine AI (Useful Sensors), MIT licensed.',
  };
  const moonshineInstall = createInstallMock({
    total: MOONSHINE_TINY_BYTES,
    noun: 'Moonshine model',
    extra: { kind: 'moonshine', assetId: 'tiny' },
    seed: localAssetsSeed ? undefined : initial.assets,
    onInstalled: () => {
      moonshineInstalled = true;
    },
  });
  // The dictionary is installed by default like the language model, and a download seed boots without it; `damaged` is an index that fails its check.
  let dictionaryState: AssetInstallState =
    initial.dictionary === 'damaged'
      ? 'verification_failed'
      : initial.dictionary === 'missing' || (initial.assets !== undefined && !localAssetsSeed)
        ? 'not_installed'
        : 'installed';
  const dictionaryInstall = createInstallMock({
    total: MOCK_DICTIONARY_DOWNLOAD_SIZE,
    noun: 'dictionary',
    extra: { kind: 'dictionary', assetId: MOCK_DICTIONARY.id },
    seed: localAssetsSeed ? undefined : initial.assets,
    onInstalled: () => {
      dictionaryState = 'installed';
    },
  });
  const installMockFor = (jobId: string) =>
    jobId.startsWith('mock-voice')
      ? voiceInstall
      : jobId.startsWith('mock-language')
        ? languageModelInstall
        : jobId.startsWith('mock-Moonshine')
          ? moonshineInstall
          : jobId.startsWith('mock-dictionary')
            ? dictionaryInstall
            : modelInstall;
  const mockWhisperModel = { ...mockWhisperIdentity, downloadSize: 483546902 + 2370 + 2203239 + 459861, installState: 'not_installed' as const };
  // The first-use gate every Whisper start has (teleprompter, recording coverage): undefined once the model is installed.
  const whisperAssetRequired = () =>
    whisperInstalled
      ? undefined
      : {
          status: 'asset_required' as const,
          model: mockWhisperIdentity,
          installState: 'not_installed' as const,
          downloadSize: mockWhisperModel.downloadSize,
          diskSize: mockWhisperModel.downloadSize,
          installPath: MOCK_ASSET_ROOT + '/whisper/faster-whisper/small',
        };
  const teleprompter = createTeleprompterMock({
    ready: manuscriptReady,
    chapters: () => chapters,
    paragraphs: () => paragraphs,
    creditsText: mockCreditsText,
    assetRequired: (engine) => {
      if (engine === 'moonshine') {
        return moonshineInstalled
          ? undefined
          : {
              status: 'asset_required',
              engine,
              model: mockMoonshineIdentity,
              installState: 'not_installed',
              downloadSize: MOONSHINE_TINY_BYTES,
              diskSize: MOONSHINE_TINY_BYTES,
              installPath: MOCK_ASSET_ROOT + '/moonshine/moonshine/tiny/quantized_26_08_21',
            };
      }
      return whisperInstalled
        ? undefined
        : {
            status: 'asset_required',
            engine,
            model: mockWhisperIdentity,
            installState: 'not_installed',
            downloadSize: mockWhisperModel.downloadSize,
            diskSize: mockWhisperModel.downloadSize,
            installPath: MOCK_ASSET_ROOT + '/whisper/faster-whisper/small',
          };
    },
    trackMatch: (chapterId) => mockChapterTrackMatch(chapterId, chapters, WIRE_TRACKS_PROJECT, chapterTrackMappings),
    tracksProject: WIRE_TRACKS_PROJECT,
    seed: initial.teleprompter,
    devices: initial.teleprompterDevices ?? WIRE_TELEPROMPTER_DEVICES,
    resume: initial.resume,
  });
  const { withMeasurement, ...coverage } = createCoverageMock({
    chapters: () => chapters,
    assetRequired: whisperAssetRequired,
    endJob,
    seed: initial.coverage,
  });
  const stages = createStagesMock({
    ready: manuscriptReady,
    chapters: () => chapters.map(withMeasurement),
    setStatus: (chapterId, status) => {
      chapters = chapters.map((chapter) => (chapter.id === chapterId ? { ...chapter, status } : chapter));
    },
    seed: initial.stages,
  });
  const { saveAnalyzerFindings, saveFinding, ...findings } = createFindingsMock(initial.findings ?? WIRE_FINDINGS, {
    rerunAfterFirstList: initial.findingsRerun,
    reaper: initial.reaper,
  });
  const takeReviewScan = createTakeReviewScanMock(saveAnalyzerFindings, endJob, initial.takeReviewScanHold);
  const takeComparison = createTakeComparisonMock({ get: findings.findingsGet, save: saveFinding }, endJob, initial.takeComparisonHold);
  const measurePicked = new Set<string>();
  const deliveryLimitValues = () => Object.fromEntries(settings.project.Delivery.map((field) => [field.key, field.effectiveValue]));
  const { peekDiagnostics, ...diagnostics } = createDiagnosticsMock(endJob, measurePicked, initial.diagnostics);
  const measurement = createMeasureMock(endJob, initial.measure, measurePicked, deliveryLimitValues, peekDiagnostics);
  const publish = () => {
    subscribers.forEach((fn) => fn(wireClone(transcript)));
  };
  const stopRun = () => {
    runTimers.forEach(clearTimeout);
    runTimers = [];
  };
  const updateEntity = (id: string, change: (entity: GuideEntity) => GuideEntity) => {
    entities = entities.map((entity) => (entity.id === id ? change(entity) : entity));
  };
  const startRun = () => {
    stopRun();
    transcript = { ...wireClone(WIRE_TRANSCRIPT), phase: 'running', percent: 8, elapsed: 4, message: 'Transcribing chunk 1 of 7…', logs: [] };
    publish();
    WIRE_LOGS.forEach((entry, index) =>
      runTimers.push(
        setTimeout(
          () => {
            if (transcript.phase !== 'running') return;
            transcript = {
              ...transcript,
              percent: Math.min(90, 18 + index * 13),
              elapsed: Math.min(42, 9 + index * 6),
              message: `Transcribing chunk ${Math.min(7, index + 2)} of 7…`,
              logs: [...transcript.logs, entry.text],
            };
            publish();
          },
          380 * (index + 1),
        ),
      ),
    );
    runTimers.push(
      setTimeout(() => {
        if (transcript.phase !== 'running') return;
        transcript = {
          ...wireClone(WIRE_TRANSCRIPT),
          phase: 'success',
          percent: 100,
          elapsed: 42,
          message: 'Comparison complete.',
          summary: `${WIRE_DISCREPANCIES.length} discrepancies found.`,
          logs: WIRE_LOGS.map((entry) => entry.text),
          rows: wireClone(WIRE_DISCREPANCIES),
        };
        lastCompleted = wireClone(transcript);
        publish();
        stopRun();
      }, 2_600),
    );
  };
  const base: NarrationApi = {
    ready: async () => ({ apiVersion: DESKTOP_HOST_API_VERSION, diagnosticId: 'mock' }),
    bootstrap: async () => ({
      apiVersion: DESKTOP_HOST_API_VERSION,
      diagnosticId: 'mock',
      version: updateStatus.version,
      projectFolder,
      projectName,
      daw,
      // Its own mutable state, not derived from `daw` (PRD W13): the real host computes this from the project's
      // manifest link, independent of the DAW label. reachable/matches stay false/unknown until Phase 6 (W14).
      dawFileLinked,
      dawReachable: false,
      dawProjectMatches: false,
      manuscript:
        initial.noManuscript || initial.manuscriptCandidate
          ? null
          : {
              id: 'alice',
              format: 'docx',
              sourceName: 'Alice.docx',
              importedAt: '2026-01-01T00:00:00Z',
              narratableWordCount: 2672,
              narratableChapterCount: 3,
            },
      manuscriptCandidate: initial.manuscriptCandidate ?? null,
      runtime: {},
      transcript: wireClone(transcript),
    }),
    selectManuscript: async () => startImport(),
    manuscriptBeginImport: async () => startImport(),
    manuscriptImportState: async () => wireClone(importJob),
    manuscriptImportPreview: async (_jobId, { markdownHeadingLevel }) => {
      importJob = {
        ...importJob,
        phase: 'ready',
        percent: 100,
        message: 'Import preview is ready.',
        // Mirrors the host's staged import log (apps/desktop/internal/importer).
        logs: [...importJob.logs, ...(importJob.preview ? mockImportPreviewLog(importJob.preview, markdownHeadingLevel) : [])],
      };
      return wireClone(importJob);
    },
    manuscriptImportCommit: async () => {
      const sourceName = importJob.preview?.sourceName ?? 'Alice.docx';
      const format = importJob.preview?.format ?? 'docx';
      importJob = {
        ...importJob,
        phase: 'success',
        percent: 100,
        message: 'Manuscript import complete.',
        logs: [
          ...importJob.logs,
          `Copying ${sourceName} (48 KB) into the project and computing its checksum`,
          'Writing manuscript.json',
          'Manuscript imported',
        ],
        result: { id: 'alice', format, sourceName, importedAt: '2026-01-01T00:00:00Z' },
      };
      return wireClone(importJob);
    },
    manuscriptImportCancel: async () => {
      importJob = { ...importJob, phase: 'cancelled', message: 'Manuscript import cancelled.' };
    },
    saveSettings: async (tool, scope, values) => {
      settings[scope][tool] = (settings[scope][tool] || []).map((field) =>
        field.key in values
          ? {
              ...field,
              value: values[field.key] ?? '',
              isSet: values[field.key] !== null,
              // A cleared project field falls back to Global, a cleared Global field to the value the mock started with (its default).
              effectiveValue:
                values[field.key] ??
                (scope === 'project' ? settings.global[tool] : wireSettings()[tool])?.find((item) => item.key === field.key)?.effectiveValue ??
                '',
            }
          : field,
      );
      return base.bootstrap();
    },
    settingsForScope: async (scope) => wireClone(settings[scope]),
    guideBuild: async (options) => {
      // The first-use gate: the selected language model is an asset, so nothing starts until the narrator chooses to download it or to
      // build without it this once.
      if (!spacyInstalled && !options?.rulesOnly) {
        return {
          status: 'asset_required' as const,
          model: mockLanguageModel,
          installState: 'not_installed' as const,
          downloadSize: 12806118,
          diskSize: 15251718,
          installPath: MOCK_ASSET_ROOT + '/spacy/en_core_web_sm/3.8.0',
        };
      }
      if (initial.build) {
        const running: WorkJob = {
          id: 'mock-guide',
          kind: 'story_bible',
          phase: 'running',
          message: 'Extracting names and terms',
          percent: 30,
          logs: ['Reading canonical manuscript', 'Read 221 paragraphs in 5 chapters', 'Extracting names and terms'],
          elapsed: 4,
        };
        const failure = 'The language model could not be loaded: the model folder is missing its config.cfg.';
        storyBibleJob = initial.build === 'hold' ? running : { ...running, phase: 'error', message: failure, error: failure, logs: [...running.logs, failure] };
        if (initial.build === 'fails') endJob({ id: 'mock-guide', kind: 'story_bible', outcome: 'error', message: failure, durationMs: 4000 });
        return { status: 'started' as const, job: wireClone(running) };
      }
      const message = options?.rulesOnly
        ? 'Story Bible rebuild complete with the rules-only extraction, which is lower quality than a language model.'
        : 'Story Bible rebuild complete.';
      storyBibleJob = {
        id: 'mock-guide',
        kind: 'story_bible',
        phase: 'success',
        message,
        percent: 100,
        logs: ['Reading canonical manuscript', 'Built Story Bible with 7 entities'],
        elapsed: 1,
        result: { message: 'Story Bible rebuilt.' },
      };
      endJob({ id: 'mock-guide', kind: 'story_bible', outcome: 'success', message, durationMs: 1000 });
      return { status: 'started' as const, job: wireClone(storyBibleJob) };
    },
    guideBuildState: async () => wireClone(storyBibleJob),
    clearProjectData: async () => {},
    guideEntities: async () => {
      await manuscriptReady;
      return wireClone(entities);
    },
    guideEdit: async (id, values) => {
      // A Python process that has not answered yet: the Save button stays busy, so its look can be seen (`?mockHoldEdits=1`).
      if (initial.holdEdits) await new Promise<void>(() => {});
      return updateEntity(id, (entity) => ({
        ...entity,
        canonical_name: values.canonical_name ?? entity.canonical_name,
        category: values.category ?? entity.category,
        description: values.description === undefined ? entity.description : { text: values.description, evidence: {} },
        personality_notes: values.personality === undefined ? entity.personality_notes : values.personality ? [{ text: values.personality, evidence: {} }] : [],
        context: values.context ?? entity.context,
        properties: values.properties === undefined ? entity.properties : parseMockProperties(values.properties),
        aliases:
          values.aliases === undefined
            ? entity.aliases
            : values.aliases
                .split(';')
                .map((text) => text.trim())
                .filter(Boolean)
                .map(
                  (text) =>
                    entity.aliases.find((alias) => alias.text === text) ?? {
                      text,
                      pronunciation: { ipa: '', source: 'Piper', confidence: 'pending' },
                      occurrences: [],
                    },
                ),
      }));
    },
    guideSetLocked: async (id, locked) => updateEntity(id, (entity) => ({ ...entity, locked })),
    guideRescan: async (id) =>
      updateEntity(id, (entity) => ({
        ...entity,
        aliases: entity.aliases.map((alias) =>
          alias.occurrences.length
            ? alias
            : {
                ...alias,
                pronunciation: { ipa: '/generated/', source: 'Piper', confidence: 'generated' },
                occurrences: [{ chapter: 'Chapter 2', paragraph: 1, sourceLine: 17, excerpt: `Found a mention of ${alias.text} while scanning Chapter 2.` }],
              },
        ),
        occurrence_count: entity.occurrences.length + entity.aliases.reduce((sum, alias) => sum + (alias.occurrences.length || 1), 0),
      })),
    guideCreate: async (name, category, aliases) => {
      const id = `new-${nextId++}`;
      entities = [
        ...entities,
        {
          id,
          canonical_name: name || 'New entity',
          category: category || 'Draft',
          locked: false,
          review_state: 'draft',
          pronunciation: { ipa: '', source: 'Piper', confidence: 'pending' },
          description: { text: '', evidence: {} },
          personality_notes: [],
          properties: [],
          context: '',
          aliases: aliases.map((text) => ({ text, pronunciation: { ipa: '', source: 'Piper', confidence: 'pending' }, occurrences: [] })),
          relationships: [],
          occurrences: [],
          occurrence_count: 0,
        },
      ];
      return id;
    },
    guideMerge: async (sourceId, targetId) => {
      const source = entities.find((entity) => entity.id === sourceId);
      const target = entities.find((entity) => entity.id === targetId);
      if (!source || !target || source.locked) return;
      const names = [{ text: source.canonical_name, pronunciation: source.pronunciation, occurrences: source.occurrences }, ...source.aliases];
      const aliases = [...target.aliases];
      names.forEach((candidate) => {
        if (
          candidate.text.toLowerCase() !== target.canonical_name.toLowerCase() &&
          !aliases.some((alias) => alias.text.toLowerCase() === candidate.text.toLowerCase())
        )
          aliases.push(candidate);
      });
      updateEntity(targetId, (entity) => ({
        ...entity,
        aliases,
        occurrences: [...entity.occurrences, ...source.occurrences],
        relationships: [...entity.relationships, ...source.relationships.filter((relationship) => relationship.id !== targetId)],
      }));
      entities = entities
        .filter((entity) => entity.id !== sourceId)
        .map((entity) => ({
          ...entity,
          relationships: entity.relationships
            .map((relationship) => (relationship.id === sourceId ? { ...relationship, id: targetId, name: target.canonical_name } : relationship))
            .filter((relationship, index, rows) => rows.findIndex((item) => item.id === relationship.id && item.label === relationship.label) === index),
        }));
    },
    guideDelete: async (id) => {
      entities = entities
        .filter((entity) => entity.id !== id)
        .map((entity) => ({ ...entity, relationships: entity.relationships.filter((relationship) => relationship.id !== id) }));
    },
    guideRelate: async (id, otherId, label) =>
      updateEntity(id, (entity) => ({
        ...entity,
        relationships: entity.relationships.some((relationship) => relationship.id === otherId && relationship.label === label)
          ? entity.relationships
          : [...entity.relationships, { id: otherId, name: entities.find((row) => row.id === otherId)?.canonical_name ?? otherId, label }],
      })),
    guideUnrelate: async (id, otherId, label) =>
      updateEntity(id, (entity) => ({
        ...entity,
        relationships: entity.relationships.filter((relationship) => !(relationship.id === otherId && relationship.label === label)),
      })),
    guidePreview: async () => {
      if (!ttsInstalled) {
        return {
          status: 'asset_required' as const,
          voice: mockVoiceIdentity,
          installState: 'not_installed' as const,
          downloadSize: mockVoice.downloadSize,
          diskSize: mockVoice.downloadSize,
          installPath: MOCK_ASSET_ROOT + '/tts/piper/en_US-ljspeech-high',
        };
      }
      // The failing seam behind ?mockPreviewError=<text>, so a real host failure can be seen without a host.
      if (initial.previewError) throw new Error(initial.previewError);
      return { status: 'ready' as const, audioBase64: MOCK_PREVIEW_WAV_BASE64, mimeType: 'audio/wav' };
    },
    guidePronounce: async (id, source, aliasIndex) => {
      const entity = entities.find((row) => row.id === id);
      if (!entity) throw new Error('Entity not found.');
      if (entity.locked) throw new Error('This entity is locked. Unlock it before editing.');
      // The mock always succeeds; the real chain can refuse a name a given engine has nothing for (D13/B10).
      const value: GuidePronunciation =
        source === 'cmu'
          ? { ipa: '/mɒk kjuː ɛm juː/', source: 'CMU dictionary', confidence: 'medium', chosen: true }
          : { ipa: '/mɒk iː spiːk/', source: 'eSpeak NG', confidence: 'low', chosen: true };
      updateEntity(id, (row) =>
        aliasIndex === undefined
          ? { ...row, pronunciation: value }
          : { ...row, aliases: row.aliases.map((alias, index) => (index === aliasIndex ? { ...alias, pronunciation: value } : alias)) },
      );
    },
    ttsCatalog: async () => ({
      catalogVersion: 1,
      provider: { id: 'piper', effectiveSource: 'repo_default' },
      voice: { id: mockVoice.id, effectiveSource: 'repo_default' },
      voices: [{ ...mockVoice, installState: ttsInstalled ? 'installed' : 'not_installed' }],
    }),
    ttsInstall: async (voiceId) => {
      if (voiceId !== mockVoice.id) throw new Error('Unknown approved TTS voice.');
      return { ...(await voiceInstall.start()), voiceId };
    },
    ttsInstallState: async (jobId) => ({ ...(await voiceInstall.state(jobId)), voiceId: mockVoice.id }),
    ttsInstallCancel: async (jobId) => ({ ...(await voiceInstall.cancel(jobId)), voiceId: mockVoice.id }),
    ttsRemove: async (voiceId) => {
      if (voiceId === mockVoice.id) ttsInstalled = false;
    },
    whisperCatalog: async () => ({
      catalogVersion: 1,
      model: { id: mockWhisperModel.id, effectiveSource: 'repo_default' },
      models: [{ ...mockWhisperModel, installState: whisperState() }],
    }),
    whisperInstall: async (modelId) => {
      if (modelId !== mockWhisperModel.id) throw new Error('Unknown approved Whisper model.');
      return { ...(await modelInstall.start()), modelId };
    },
    whisperInstallState: async (jobId) => ({ ...(await modelInstall.state(jobId)), modelId: mockWhisperModel.id }),
    whisperInstallCancel: async (jobId) => ({ ...(await modelInstall.cancel(jobId)), modelId: mockWhisperModel.id }),
    whisperRemove: async (modelId) => {
      if (modelId === mockWhisperModel.id) {
        whisperInstalled = false;
        whisperDamaged = false;
      }
    },
    assetsList: async () => {
      const item = (kind: string, kindLabel: string, model: AssetFactsSource, installState: AssetInstallState, activeJobId: string) => ({
        kind,
        kindLabel,
        id: model.id,
        displayName: model.displayName,
        version: model.version,
        publisher: model.publisher,
        license: model.license,
        licenseUrl: model.licenseUrl,
        modelCardUrl: model.modelCardUrl,
        provenanceUrl: model.provenanceUrl,
        attribution: model.attribution,
        downloadSize: model.downloadSize,
        installState,
        diskSize: kind === 'spacy' ? 15251718 : model.downloadSize,
        path: `${MOCK_ASSET_ROOT}/${kind}/${model.id}`,
        installedAt: installState === 'not_installed' ? '' : '2026-09-20T09:30:00Z',
        verifiedAt: installState === 'installed' ? '2026-09-20T09:30:00Z' : '',
        activeJobId,
      });
      const voice = item('tts', 'Preview voice', mockVoice, ttsInstalled ? 'installed' : 'not_installed', voiceInstall.activeId());
      const language = item(
        'spacy',
        'Story Bible language model',
        { ...mockLanguageModel, downloadSize: 12806118 },
        spacyInstalled ? 'installed' : 'not_installed',
        languageModelInstall.activeId(),
      );
      const model = item('whisper', 'Whisper model', mockWhisperModel, whisperState(), modelInstall.activeId());
      const dictionary = {
        ...item('dictionary', 'Dictionary', { ...MOCK_DICTIONARY, downloadSize: MOCK_DICTIONARY_DOWNLOAD_SIZE }, dictionaryState, dictionaryInstall.activeId()),
        diskSize: MOCK_DICTIONARY_DISK_SIZE,
      };
      return {
        cacheRoot: MOCK_ASSET_ROOT,
        // Only what verifies counts: a damaged asset is not one the app can use.
        totalInstalledBytes:
          (ttsInstalled ? voice.diskSize : 0) +
          (whisperInstalled && !whisperDamaged ? model.diskSize : 0) +
          (spacyInstalled ? language.diskSize : 0) +
          (dictionaryState === 'installed' ? dictionary.diskSize : 0),
        assets: [voice, model, language, dictionary],
      };
    },
    assetsInstall: async (kind, id) => {
      if (kind === 'tts' && id === mockVoice.id) return voiceInstall.start();
      if (kind === 'whisper' && id === mockWhisperModel.id) return modelInstall.start();
      if (kind === 'spacy' && id === mockLanguageModel.id) return languageModelInstall.start();
      if (kind === 'moonshine' && id === mockMoonshineIdentity.id) return moonshineInstall.start();
      if (kind === 'dictionary' && id === MOCK_DICTIONARY.id) return dictionaryInstall.start();
      throw new Error(`"${id}" is not in the approved catalog of ${kind}`);
    },
    assetsInstallState: async (jobId) => installMockFor(jobId).state(jobId),
    assetsInstallCancel: async (jobId) => installMockFor(jobId).cancel(jobId),
    assetsVerify: async (kind, id) => {
      if (kind === 'dictionary') return { kind, id, installState: dictionaryState };
      const installed = kind === 'tts' ? ttsInstalled : kind === 'spacy' ? spacyInstalled : kind === 'moonshine' ? moonshineInstalled : whisperInstalled;
      if (kind === 'whisper' && whisperDamaged) return { kind, id, installState: 'verification_failed' as const };
      return { kind, id, installState: installed ? ('installed' as const) : ('not_installed' as const) };
    },
    assetsRemove: async (kind) => {
      if (kind === 'tts') ttsInstalled = false;
      else if (kind === 'spacy') spacyInstalled = false;
      else if (kind === 'moonshine') moonshineInstalled = false;
      else if (kind === 'dictionary') dictionaryState = 'not_installed';
      else {
        whisperInstalled = false;
        whisperDamaged = false;
      }
    },
    transcriptStart: async () =>
      whisperInstalled
        ? (startRun(), { status: 'started' as const })
        : {
            status: 'asset_required' as const,
            model: mockWhisperIdentity,
            installState: 'not_installed' as const,
            downloadSize: mockWhisperModel.downloadSize,
            diskSize: mockWhisperModel.downloadSize,
            installPath: MOCK_ASSET_ROOT + '/whisper/faster-whisper/small',
          },
    transcriptCancel: async () => {
      stopRun();
      transcript = { ...transcript, phase: 'cancelled', message: 'Comparison cancelled' };
      publish();
    },
    transcriptReset: async () => {
      stopRun();
      transcript = wireClone(WIRE_TRANSCRIPT);
      publish();
    },
    transcriptLastCompleted: async () => wireClone(lastCompleted),
    transcriptAddEquivalence: async () => 'Added pronunciation equivalence.',
    transcriptJump: async () => {},
    transcriptExportMarkers: async () => {
      const exportable = transcript.rows.filter((row) => (row.markerState ?? 'pending') === 'pending');
      transcript = {
        ...transcript,
        markerExport: {
          phase: 'exporting',
          message: `Exporting ${exportable.length} marker${exportable.length === 1 ? '' : 's'} to REAPER…`,
          added: 0,
          skipped: 0,
        },
      };
      publish();
      setTimeout(() => {
        const added = transcript.rows.filter((row) => (row.markerState ?? 'pending') === 'pending').length;
        transcript = {
          ...transcript,
          rows: transcript.rows.map((row) => ((row.markerState ?? 'pending') === 'pending' ? { ...row, markerState: 'exported' } : row)),
          markerExport: {
            phase: 'complete',
            message: `Exported ${added} marker${added === 1 ? '' : 's'}; skipped ${transcript.rows.length - added} existing.`,
            added,
            skipped: transcript.rows.length - added,
          },
        };
        lastCompleted = wireClone(transcript);
        publish();
      }, 250);
    },
    transcriptSuggestHints: async () => ({
      terms: vocabularyCandidates.filter(
        (candidate) => !hints.some((accepted) => accepted.localeCompare(candidate, undefined, { sensitivity: 'accent' }) === 0),
      ),
      found: vocabularyCandidates.length,
    }),
    transcriptHints: async () => [...hints],
    transcriptSaveHints: async (accepted) => {
      hints = [...accepted];
    },
    reportClientDiagnostic: async () => {},
    systemNotify: async () => {},
    systemLookup: async (word) => mockDictionaryLookup(word, dictionaryState),
    manuscriptChapters: async () => {
      await manuscriptReady;
      const readable = Boolean(tracksDiscovery.selected);
      return wireClone(
        chapters.map((chapter) => ({ ...withMeasurement(chapter), ...mockRecordedLength(chapter.id, WIRE_TRACKS_PROJECT, chapterTrackMappings, readable) })),
      );
    },
    manuscriptParagraphs: async (chapter) => {
      await manuscriptReady;
      return wireClone(paragraphs.filter((paragraph) => paragraph.chapterId === chapter || paragraph.chapter === chapter));
    },
    manuscriptSearch: async (query) => {
      await manuscriptReady;
      const needle = query.toLowerCase();
      return wireClone(
        paragraphs
          .map((paragraph) => ({ paragraph, matchStart: paragraph.text.toLowerCase().indexOf(needle) }))
          .filter(({ matchStart }) => matchStart >= 0)
          .map(({ paragraph, matchStart }) => ({
            chapter: paragraph.chapter,
            chapterId: paragraph.chapterId,
            paragraph: paragraph.index,
            paragraphId: paragraph.id,
            sourceLine: paragraph.sourceLine,
            excerpt: paragraph.text,
            matchStart,
          })),
      );
    },
    manuscriptSetChapterStatus: async (chapter, status) => {
      await manuscriptReady;
      const found = chapters.find((item) => item.id === chapter || item.title === chapter);
      if (!found) throw new Error(`Unknown chapter: ${chapter}`);
      found.status = status;
      return wireClone(withMeasurement(found));
    },
    noteList: async (chapter) => wireClone(chapter ? notes.filter((note) => note.chapter === chapter) : notes),
    manuscriptReader: async () => {
      await manuscriptReady;
      return { chapters: wireClone(chapters.map(withMeasurement)), paragraphs: wireClone(paragraphs), notes: wireClone(notes) };
    },
    readerState: async () => wireClone(readerState),
    readerStateSave: async (values) => {
      readerState = { ...readerState, ...values };
      return wireClone(readerState);
    },
    readerBookmarkCreate: async (bookmark) => {
      const item: ReaderBookmark = { ...bookmark, id: `bookmark-${nextId++}`, createdAt: new Date().toISOString() };
      readerState = { ...readerState, bookmarks: [...readerState.bookmarks, item] };
      return wireClone(item);
    },
    readerBookmarkDelete: async (id) => {
      readerState = { ...readerState, bookmarks: readerState.bookmarks.filter((bookmark) => bookmark.id !== id) };
    },
    noteCreate: async (chapterId, paragraphId, text, anchorStart, anchorEnd, anchorText) => {
      const paragraph = paragraphs.find((item) => item.id === paragraphId);
      if (!paragraph || paragraph.chapterId !== chapterId) throw new Error('Unknown manuscript paragraph');
      const note: ManuscriptNote = {
        id: `note-${nextId++}`,
        chapter: paragraph.chapter,
        chapterId,
        paragraph: paragraph.index,
        paragraphId,
        text,
        createdAt: new Date().toISOString(),
        anchorStart,
        anchorEnd,
        anchorText,
      };
      notes = [...notes, note];
      return wireClone(note);
    },
    noteDelete: async (id) => {
      notes = notes.filter((note) => note.id !== id);
    },
    subscribeTranscript: (onUpdate) => {
      subscribers.add(onUpdate);
      onUpdate(wireClone(transcript));
      return () => subscribers.delete(onUpdate);
    },
    lineIdentityStamp: async (rows, overwrite) => {
      if (rows.length === 0) throw new Error('select at least one item to stamp');
      lineIdentity = {
        ...wireClone(WIRE_LINE_IDENTITY_IDLE),
        runId: String(Date.now()),
        phase: 'stamping',
        message: 'Stamping manuscript line identity in REAPER…',
      };
      publishLineIdentity();
      setTimeout(() => {
        if (lineIdentity.phase !== 'stamping') return;
        const applied = rows.length;
        lineIdentity = {
          ...lineIdentity,
          phase: 'success',
          message: `Stamped ${applied} line${applied === 1 ? '' : 's'}.`,
          stamp: { applied, unchanged: 0, missingCount: 0, conflictsCount: 0, missing: [], conflicts: [] },
        };
        publishLineIdentity();
      }, 300);
      void overwrite; // the mock never simulates a real conflict from a second stamp; WIRE_LINE_IDENTITY_STAMP_CONFLICT covers that state directly (initial.lineIdentity)
      return { status: 'started' };
    },
    lineIdentityRead: async () => {
      lineIdentity = {
        ...wireClone(WIRE_LINE_IDENTITY_IDLE),
        runId: String(Date.now()),
        phase: 'reading',
        message: 'Reading manuscript line identity from REAPER…',
      };
      publishLineIdentity();
      setTimeout(() => {
        if (lineIdentity.phase !== 'reading') return;
        lineIdentity = { ...wireClone(WIRE_LINE_IDENTITY_READ_SUCCESS), runId: lineIdentity.runId };
        publishLineIdentity();
      }, 300);
      return { status: 'started' };
    },
    lineIdentityState: async () => wireClone(lineIdentity),
    subscribeLineIdentity: (onUpdate) => {
      lineIdentitySubscribers.add(onUpdate);
      onUpdate(wireClone(lineIdentity));
      return () => lineIdentitySubscribers.delete(onUpdate);
    },
    pickupsImport: async (csvText) => {
      const lines = csvText
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
      const dataLines = lines.length > 0 && lines[0].toLowerCase().startsWith('start') ? lines.slice(1) : lines;
      const rowErrors: string[] = [];
      const added: PickupsMoment[] = [];
      dataLines.forEach((line, index) => {
        const [startRaw, note, tag] = line.split(',');
        const position = Number(startRaw);
        if (!Number.isFinite(position) || position < 0 || !note) {
          rowErrors.push(`line ${index + 1}: could not parse this row`);
          return;
        }
        added.push({ position, note: note.trim(), tag: (tag ?? '').trim() });
      });
      if (added.length === 0) throw new Error(`no valid pickups were found in the file${rowErrors[0] ? `: ${rowErrors[0]}` : ''}`);
      pickupsOpen = [...pickupsOpen, ...added];
      beginPickups('importing', 'Importing pickups into REAPER…');
      publishPickups();
      setTimeout(() => {
        if (pickups.phase !== 'importing') return;
        settlePickups(() => {
          pickups = {
            ...pickups,
            phase: 'success',
            message: `Imported ${added.length} pickup${added.length === 1 ? '' : 's'}.`,
            importReport: { added: added.length, existing: 0, invalid: 0 },
            remaining: pickupsOpen.length,
            total: pickupsOpen.length + pickupsResolvedCount,
          };
        });
      }, 300);
      return { status: 'started', rowErrors };
    },
    pickupsExport: async () => {
      beginPickups('exporting', 'Exporting pickups from REAPER…');
      publishPickups();
      setTimeout(() => {
        if (pickups.phase !== 'exporting') return;
        settlePickups(() => {
          const rows = pickupsOpen.map((row) => `${row.position.toFixed(6)},${row.note},${row.tag}`);
          const csv = ['start,note,tag', ...rows].join('\n') + (rows.length > 0 ? '\n' : '');
          pickups = {
            ...pickups,
            phase: 'success',
            message: `Exported ${pickupsOpen.length} pickup${pickupsOpen.length === 1 ? '' : 's'}.`,
            csv,
            remaining: pickupsOpen.length,
            total: pickupsOpen.length + pickupsResolvedCount,
          };
        });
      }, 300);
      return { status: 'started' };
    },
    pickupsNext: async () => {
      beginPickups('jumping', 'Jumping to the next pickup…');
      publishPickups();
      setTimeout(() => {
        if (pickups.phase !== 'jumping') return;
        settlePickups(() => {
          if (pickupsOpen.length === 0) {
            pickups = { ...pickups, phase: 'error', message: 'No pickups remain.' };
          } else {
            pickups = { ...pickups, phase: 'success', message: 'Jumped to the next pickup.', next: pickupsOpen[0] };
          }
        });
      }, 300);
      return { status: 'started' };
    },
    pickupsResolve: async (position) => {
      beginPickups('resolving', 'Resolving this pickup…');
      publishPickups();
      setTimeout(() => {
        if (pickups.phase !== 'resolving') return;
        settlePickups(() => {
          const index = pickupsOpen.findIndex((row) => Math.abs(row.position - position) <= 0.15);
          if (index < 0) {
            pickups = { ...pickups, phase: 'error', message: 'No open pickup was found at that position.' };
          } else {
            const resolved = pickupsOpen[index];
            pickupsOpen = pickupsOpen.filter((_, candidateIndex) => candidateIndex !== index);
            pickupsResolvedCount += 1;
            pickups = {
              ...pickups,
              phase: 'success',
              message: 'Marked this pickup done.',
              resolved,
              remaining: pickupsOpen.length,
              total: pickupsOpen.length + pickupsResolvedCount,
            };
          }
        });
      }, 300);
      return { status: 'started' };
    },
    pickupsCount: async () => {
      beginPickups('counting', 'Counting pickups…');
      publishPickups();
      setTimeout(() => {
        if (pickups.phase !== 'counting') return;
        settlePickups(() => {
          const remaining = pickupsOpen.length;
          const total = remaining + pickupsResolvedCount;
          pickups = { ...pickups, phase: 'success', message: `${remaining} pickup${remaining === 1 ? '' : 's'} remaining of ${total}.`, remaining, total };
        });
      }, 300);
      return { status: 'started' };
    },
    pickupsState: async () => wireClone(pickups),
    subscribePickups: (onUpdate) => {
      pickupsSubscribers.add(onUpdate);
      onUpdate(wireClone(pickups));
      return () => pickupsSubscribers.delete(onUpdate);
    },
    renderConfigConfigure: async (outputFolder) => {
      const folder = outputFolder.trim();
      if (!folder) throw new Error('an output folder is required');
      renderConfig = { ...wireClone(WIRE_RENDER_CONFIG_IDLE), runId: String(Date.now()), phase: 'configuring', message: 'Configuring the chapter render…' };
      publishRenderConfig();
      setTimeout(() => {
        if (renderConfig.phase !== 'configuring') return;
        if (renderConfigAlwaysErrors) {
          renderConfig = { ...renderConfig, phase: 'error', message: WIRE_RENDER_CONFIG_ERROR.message };
        } else if (renderConfigHasRegions) {
          const targets = [`${folder}\\Chapter 1.wav`, `${folder}\\Chapter 2.wav`];
          renderConfig = {
            ...renderConfig,
            phase: 'success',
            folder,
            targets,
            count: targets.length,
            message: `Render configured for ${targets.length} chapter files. Press Render in REAPER to create them.`,
          };
        } else {
          renderConfig = {
            ...renderConfig,
            phase: 'success',
            folder,
            targets: [],
            count: 0,
            message: 'Render configured. No chapter regions were found yet: create them before rendering.',
          };
        }
        publishRenderConfig();
      }, 300);
      return { status: 'started' };
    },
    renderConfigSuggestFolder: async () => ({ folder: `${projectFolder}\\renders` }),
    renderConfigState: async () => wireClone(renderConfig),
    subscribeRenderConfig: (onUpdate) => {
      renderConfigSubscribers.add(onUpdate);
      onUpdate(wireClone(renderConfig));
      return () => renderConfigSubscribers.delete(onUpdate);
    },
    cleanupToolsLaunch: async (tool) => {
      const labels: Record<string, string> = { repair_pops_clicks: 'Repair Pops/Clicks', magnolius_declick: 'Magnolius DeClick' };
      const label = labels[tool];
      if (!label) throw new Error(`unknown cleanup tool "${tool}"`);
      cleanupTools = { ...wireClone(WIRE_CLEANUP_TOOLS_IDLE), runId: String(Date.now()), phase: 'launching', tool, message: `Opening ${label} in REAPER…` };
      publishCleanupTools();
      setTimeout(() => {
        if (cleanupTools.phase !== 'launching') return;
        cleanupTools = cleanupToolsAlwaysErrors
          ? { ...cleanupTools, phase: 'error', message: WIRE_CLEANUP_TOOLS_ERROR.message }
          : {
              ...cleanupTools,
              phase: 'launched',
              action: tool === 'repair_pops_clicks' ? WIRE_CLEANUP_TOOLS_LAUNCHED.action : 'Script: Magnolius_DeClick.lua',
              message: `${label} is open in REAPER. Nothing has changed yet: the repair happens only when you apply it there.`,
            };
        publishCleanupTools();
      }, 300);
      return { status: 'started' };
    },
    cleanupToolsState: async () => wireClone(cleanupTools),
    subscribeCleanupTools: (onUpdate) => {
      cleanupToolsSubscribers.add(onUpdate);
      onUpdate(wireClone(cleanupTools));
      return () => cleanupToolsSubscribers.delete(onUpdate);
    },
    retakeLanesList: async () => wireClone(retakeLanesList),
    retakeLanesPick: async (lineId, itemGuid) => {
      const line = retakeLanesList.lines.find((candidate) => candidate.lineId === lineId);
      const retake = line?.retakes.find((candidate) => candidate.itemGuid === itemGuid);
      if (!line || !retake)
        throw new Error('that retake is not on a fixed-lane track in the saved project; save the project in REAPER and open the list again');
      retakeLanes = {
        ...wireClone(WIRE_RETAKE_LANES_IDLE),
        runId: String(Date.now()),
        phase: 'picking',
        lineId,
        itemGuid,
        trackName: line.trackName,
        message: `Asking REAPER to play this retake on ${line.trackName}…`,
      };
      publishRetakeLanes();
      setTimeout(() => {
        if (retakeLanes.phase !== 'picking') return;
        retakeLanes = retakeLanesAlwaysErrors
          ? { ...retakeLanes, phase: 'error', message: WIRE_RETAKE_LANES_ERROR.message }
          : {
              ...retakeLanes,
              phase: 'picked',
              lane: retake.lane,
              message: `Lane ${retake.lane + 1} is now the only lane playing on ${line.trackName}. To go back, use Undo in REAPER: it restores what played before.`,
            };
        publishRetakeLanes();
      }, 300);
      return { status: 'started' };
    },
    retakeLanesState: async () => wireClone(retakeLanes),
    subscribeRetakeLanes: (onUpdate) => {
      retakeLanesSubscribers.add(onUpdate);
      onUpdate(wireClone(retakeLanes));
      return () => retakeLanesSubscribers.delete(onUpdate);
    },
    chapterTagsPreview: async () => wireClone(chapterTagsPreview),
    chapterTagsEmbed: async (destPath) => {
      if (!destPath.trim()) throw new Error('choose the MP3 file to add chapters to');
      if (chapterTagsEmbedAlwaysErrors) throw new Error('could not write chapter tags to the new copy');
      return wireClone(WIRE_CHAPTER_TAGS_EMBED_SUCCESS);
    },
    subscribeProjectAttach: (onUpdate) => {
      projectAttachSubscribers.add(onUpdate);
      return () => projectAttachSubscribers.delete(onUpdate);
    },
    projectRecents: async () => wireClone(recentProjects),
    selectProjectFolder: async () => ({ selected: true, path: 'C:/Projects/Mock-Project' }),
    switchProject: async (path, name) => attachProject(path, name),
    createProject: async (parent, name) => attachProject(`${parent || DEFAULT_PROJECTS_DIRECTORY}/${name}`, name),
    removeRecentProject: async (path) => {
      recentProjects = recentProjects.filter((entry) => entry.path.toLowerCase() !== path.toLowerCase());
      return wireClone(recentProjects);
    },
    linkDawFile: async () => {
      if (initial.dawLinkMismatch) {
        const elsewhere = 'C:/Projects/Elsewhere/Elsewhere.rpp';
        return {
          selected: true,
          linked: false,
          path: elsewhere,
          folderMismatch: true,
          message: `Elsewhere.rpp is outside this project's folder (${projectFolder}). Choose a REAPER project file saved inside the project, or open that project instead.`,
        };
      }
      dawFileLinked = true;
      return { selected: true, linked: true, path: dawRppPath };
    },
    // The mock never grows a real heartbeat (dawReachable stays whatever Bootstrap already reports, ADR 0092
    // Phase 7 is Go/Lua only): this just answers as if REAPER accepted the launch.
    launchDaw: async () => ({ launched: true, path: 'C:/Program Files/REAPER (x64)/reaper.exe', source: 'uninstall_registry' }),
    creditsTemplates: async () => wireClone(creditTemplates),
    saveCreditsTemplate: async (id, kind, name, body) => {
      if (id) {
        const index = creditTemplates.findIndex((template) => template.id === id);
        const updated: CreditTemplate = { id, kind, name, body, builtIn: index >= 0 ? creditTemplates[index].builtIn : false };
        if (index >= 0) creditTemplates[index] = updated;
        else creditTemplates.push(updated);
        return wireClone(updated);
      }
      const created: CreditTemplate = { id: `mock-credit-template-${nextCreditTemplateId++}`, kind, name, body, builtIn: false };
      creditTemplates.push(created);
      return wireClone(created);
    },
    duplicateCreditsTemplate: async (id) => {
      const original = creditTemplates.find((template) => template.id === id);
      if (!original) throw new Error(`No credit template with id "${id}"`);
      const duplicate: CreditTemplate = {
        id: `mock-credit-template-${nextCreditTemplateId++}`,
        kind: original.kind,
        name: `${original.name} copy`,
        body: original.body,
        builtIn: false,
      };
      creditTemplates.push(duplicate);
      return wireClone(duplicate);
    },
    deleteCreditsTemplate: async (id) => {
      creditTemplates = creditTemplates.filter((template) => template.id !== id);
    },
    creditsProjectValues: async () => ({
      values: wireClone(creditValues),
      narratorGlobal: settings.global.General.find((field) => field.key === 'narrator_name')?.effectiveValue ?? '',
      suggestions: { Title: 'Alice’s Adventures in Wonderland', Author: 'Lewis Carroll' },
      detected: [
        { token: 'Title', value: 'Alice’s Adventures in Wonderland', source: 'the title page', confidence: 'high' },
        { token: 'Author', value: 'Lewis Carroll', source: 'the byline', confidence: 'high' },
      ],
    }),
    saveCreditsProjectValues: async (values) => {
      creditValues = wireClone(values);
      return wireClone(creditValues);
    },
    creditsPreview: async (body) => renderMockCredits(body, resolveMockCreditValues(creditValues, mockNarratorGlobal())),
    creditsChapterAnnouncements: async (body) => {
      await manuscriptReady;
      const tokens = resolveMockCreditValues(creditValues, mockNarratorGlobal());
      return chapters
        .filter((chapter) => (chapter.contentKind ?? 'narration') === 'narration')
        .map((chapter): CreditsAnnouncement => ({
          chapterId: chapter.id,
          chapter: chapter.title,
          result: renderMockCredits(body, { ...tokens, Chapter: chapter.title, 'Chapter Title': chapter.subtitle ?? '' }),
        }));
    },
    creditsRetailSample: async () => {
      await manuscriptReady;
      return readRetailSample();
    },
    saveCreditsRetailSample: async (startParagraphId, endParagraphId) => {
      await manuscriptReady;
      readRetailSample();
      if (!startParagraphId && !endParagraphId) {
        retailSample = undefined;
        return { sample: null, problem: '' };
      }
      const sample = measureMockRetailSample(paragraphs, startParagraphId, endParagraphId);
      retailSample = { startParagraphId, endParagraphId };
      return { sample, problem: '' };
    },
    creditsStatuses: async () => wireClone(creditsStatuses),
    setCreditsStatus: async (kind, status) => {
      creditsStatuses = { ...creditsStatuses, [kind]: status };
      return wireClone(creditsStatuses);
    },
    dawCatalogList: async () => wireClone(DAW_CATALOG),
    dawCatalogOpenDownloadPage: async (id) => {
      if (!DAW_CATALOG.some((entry) => entry.id === id)) throw new Error(`Unknown DAW catalog entry "${id}"`);
      // The mock has no real browser to open; it only proves the call reached a known id (Vitest's "no navigation
      // without a click" success metric is exercised at the component level, not here).
    },
    tracksDiscover: async () => wireClone(tracksDiscovery),
    tracksSelect: async (path) => {
      tracksDiscovery = { ...tracksDiscovery, selected: path };
      return wireClone(tracksDiscovery);
    },
    tracksList: async () => wireClone(WIRE_TRACKS_PROJECT),
    chapterTrackMapList: async () => ({ documentId: mockDocumentId, mappings: wireClone(chapterTrackMappings) }),
    chapterTrackMapConfirm: async (trackGuid, chapterId) => {
      await manuscriptReady;
      const chapter = chapters.find((candidate) => candidate.id === chapterId);
      if (!chapter) throw new Error('that chapter is not part of the current manuscript');
      const mapping: TrackMapping = { trackGuid, chapterId, chapterTitle: chapter.title, confirmedAt: new Date().toISOString() };
      chapterTrackMappings = [...chapterTrackMappings.filter((existing) => existing.trackGuid !== trackGuid), mapping];
      return wireClone(mapping);
    },
    chapterTrackMapClear: async (trackGuid) => {
      chapterTrackMappings = chapterTrackMappings.filter((existing) => existing.trackGuid !== trackGuid);
      return { documentId: mockDocumentId, mappings: wireClone(chapterTrackMappings) };
    },
    chapterTrackSet: async (chapterId, trackGuid) => {
      await manuscriptReady;
      const chapter = chapters.find((candidate) => candidate.id === chapterId);
      if (!chapter) throw new Error('that chapter is not part of the current manuscript');
      if (!trackGuid) throw new Error('choose a track before linking a chapter');
      const displaced = chapterTrackMappings.find((existing) => existing.trackGuid === trackGuid && existing.chapterId !== chapterId) ?? null;
      const link: TrackMapping = { trackGuid, chapterId, chapterTitle: chapter.title, confirmedAt: new Date().toISOString() };
      chapterTrackMappings = [...chapterTrackMappings.filter((existing) => existing.trackGuid !== trackGuid && existing.chapterId !== chapterId), link];
      return wireClone({ documentId: mockDocumentId, link, displaced, mappings: chapterTrackMappings });
    },
    chapterTrackUnlink: async (chapterId) => {
      await manuscriptReady;
      if (!chapters.some((candidate) => candidate.id === chapterId)) throw new Error('that chapter is not part of the current manuscript');
      chapterTrackMappings = chapterTrackMappings.filter((existing) => existing.chapterId !== chapterId);
      return { documentId: mockDocumentId, mappings: wireClone(chapterTrackMappings) };
    },
    chapterTrackLinks: async () => {
      await manuscriptReady;
      const state = tracksDiscovery.candidates.length === 0 ? 'none' : tracksDiscovery.selected ? 'ready' : 'choose';
      return wireClone(mockChapterTrackLinks(chapters, WIRE_TRACKS_PROJECT, chapterTrackMappings, state));
    },
    chapterTrackMatch: async (chapterId) => {
      await manuscriptReady;
      return wireClone(mockChapterTrackMatch(chapterId, chapters, WIRE_TRACKS_PROJECT, chapterTrackMappings));
    },
    chapterSuggestion: async () => {
      await manuscriptReady;
      return wireClone(mockChapterSuggestion(chapters, WIRE_TRACKS_PROJECT, chapterTrackMappings, initial.armedTracks ?? []));
    },
    ...takeReviewScan,
    ...takeComparison,
    ...measurement,
    ...diagnostics,
    takeReviewCreateTake: async (request) => ({
      targetItemGuid: request.targetItemGuid,
      newTakeGuid: '{99999999-0000-4000-8000-000000000099}',
    }),
    subscribeNotices: (onNotice) => {
      const text = initial.notice;
      if (!text) return () => {};
      const timer = setTimeout(() => onNotice(text), 0);
      return () => clearTimeout(timer);
    },
    subscribeJobEnded: (onEnded) => {
      jobEndListeners.add(onEnded);
      return () => void jobEndListeners.delete(onEnded);
    },
    updateStatus: async () => wireClone(mockUpdateStatus()),
    updateCheck: async () => {
      // A check that works records the time; one that cannot reach GitHub says so again.
      if (!updateStatus.failure && !updateStatus.development) updateStatus = { ...updateStatus, lastChecked: MOCK_CHECKED_AT };
      return wireClone(mockUpdateStatus());
    },
    updateDownload: async () => {
      const available = updateStatus.available;
      if (!available) throw new Error('There is no newer release to download.');
      const total = available.size;
      updateJob = {
        id: 'mock-update',
        version: available.version,
        phase: 'downloading',
        message: `Downloading Narration Utils ${available.version}…`,
        percent: 0,
        bytesDone: 0,
        bytesTotal: total,
        error: '',
      };
      if (initial.update === 'downloading') {
        // Stays here, so the dialog can be looked at: real bytes over real bytes, a little under half.
        updateJob = { ...updateJob, percent: 40, bytesDone: Math.floor(total * 0.4) };
        return wireClone(updateJob);
      }
      clearInterval(updateJobTimer);
      updateJobTimer = setInterval(() => {
        const current = updateJob;
        if (!current || current.phase === 'cancelled') return clearInterval(updateJobTimer);
        if (current.phase === 'downloading') {
          const bytesDone = Math.min(total, current.bytesDone + Math.ceil(total / 5));
          if (initial.update === 'download-fails' && bytesDone >= total * 0.4) {
            const failure = 'The checksum in the release and GitHub’s own record of the file disagree, so the update was not used.';
            updateJob = { ...current, phase: 'error', bytesDone, percent: Math.floor((bytesDone / total) * 100), message: failure, error: failure };
            return clearInterval(updateJobTimer);
          }
          updateJob =
            bytesDone >= total
              ? { ...current, bytesDone, percent: 100, phase: 'verifying', message: 'Checking the download against the release’s checksum…' }
              : { ...current, bytesDone, percent: Math.floor((bytesDone / total) * 100) };
        } else if (current.phase === 'verifying') {
          updateJob = { ...current, phase: 'unpacking', message: 'Unpacking the program…' };
        } else if (current.phase === 'unpacking') {
          updateJob = { ...current, phase: 'ready', message: `Version ${current.version} is downloaded and checked.` };
          clearInterval(updateJobTimer);
        }
      }, 300);
      return wireClone(updateJob);
    },
    updateInstall: async (jobId) => {
      if (!updateJob || updateJob.id !== jobId || updateJob.phase !== 'ready') throw new Error('The update is not downloaded yet.');
      if (initial.update === 'install-refused') {
        throw new Error(
          'Narration Utils is busy, so the update was not installed. Finish or stop what is running (an import, a Story Bible build, a download, a comparison or a teleprompter session), then try again.',
        );
      }
      updateJob = { ...updateJob, phase: 'installing', message: `Installing version ${updateJob.version}. Narration Utils restarts in a moment.` };
      return wireClone(updateJob);
    },
    updateShowDownload: async () => undefined,
    updateJobState: async (jobId) => {
      if (!updateJob || updateJob.id !== jobId) throw new Error('unknown update job');
      return wireClone(updateJob);
    },
    updateJobCancel: async (jobId) => {
      if (!updateJob || updateJob.id !== jobId) throw new Error('unknown update job');
      clearInterval(updateJobTimer);
      updateJob = { ...updateJob, phase: 'cancelled', message: 'The update download was cancelled.' };
      return wireClone(updateJob);
    },
    updateOpenNotes: async () => undefined,
    subscribeUpdate: (onStatus) => {
      if (initial.update !== 'found') return () => {};
      const timer = setTimeout(() => onStatus(wireClone(updateStatus)), 0);
      return () => clearTimeout(timer);
    },
    subscribeLiveUpdateHealth: (onDegraded) => {
      if (!initial.liveUpdatesDegraded) return () => {};
      const timer = setTimeout(onDegraded, 0);
      return () => clearTimeout(timer);
    },
    ...teleprompter,
    ...coverage,
    ...stages,
    ...findings,
    mediaUrl: (sourceFile) => mockAudioSource() ?? sourceFile,
  };
  const api = initial.invalidPayload ? { ...base, ...invalidPayloadOverrides(initial.invalidPayload, base) } : base;
  return { ...api, ...overrides };
}
