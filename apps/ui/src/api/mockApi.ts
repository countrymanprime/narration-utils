// Browser/mock API. It deliberately uses the same literal fixture data
// everywhere so visual review never silently exercises placeholder
// content instead of the screen we are trying to match.
//
// Each feature area's bindings live in their own file under mockHost/ (the state they share is mockHost/state.ts);
// this file only puts them together, with the per-feature mocks beside it (teleprompterMock.ts, coverageMock.ts, ...).
import type { Finding, NarrationApi } from '../types';
import { WIRE_FINDINGS, WIRE_TELEPROMPTER_DEVICES, WIRE_TRACKS_PROJECT } from './mockFixtures';
import { mockChapterTrackMatch } from './chapterTrackMatchMock';
import { createTeleprompterMock } from './teleprompterMock';
import { createCoverageMock } from './coverageMock';
import { createWorkspaceMock, mockMisreadFindingSource } from './workspaceMock';
import { createPreviewMock } from './previewMock';
import { createProductionMock } from './productionMock';
import { createStagesMock } from './stagesMock';
import { createProofingRenderMock } from './proofingRenderMock';
import { createDawMock } from './dawMock';
import { createProvidersMock } from './providersMock';
import { createMasteringMock } from './masteringMock';
import { createFindingsMock } from './findingsMock';
import { createTakeReviewScanMock } from './takeReviewMock';
import { createTakeComparisonMock } from './takeComparisonMock';
import { createMeasureMock } from './measureMock';
import { createRenderEncodeMasterMock } from './renderEncodeMasterMock';
import { DELIVERY_REVIEW_ANALYZER, mockDeliveryReviewFindings, resavingAfterProfileChange } from './deliveryReviewMock';
import { createDeliveryProfilesMock } from './deliveryProfilesMock';
import { createDiagnosticsMock } from './diagnosticsMock';
import { createEditingMock } from './editingMock';
import { createCleanupActionMock } from './cleanupActionMock';
import { createPrepMarkupMock } from './prepMarkupMock';
import { buildPrepCompletenessSummaryMock } from './prepCompletenessMock';
import { createMockState, type MockApiSeed } from './mockHost/state';
import { createUpdateMock } from './mockHost/update';
import { createProjectMock } from './mockHost/project';
import { createSettingsMock } from './mockHost/settings';
import { createManuscriptMock } from './mockHost/manuscript';
import { createCreditsMock } from './mockHost/credits';
import { createAssetsMock } from './mockHost/assets';
import { createProofingMock } from './mockHost/proofing';
import { createReaperActionsMock } from './mockHost/reaperActions';
import { createChapterTracksMock } from './mockHost/chapterTracks';
import { createStoryBibleMock } from './mockHost/storyBible';
import { createCharacterMock } from './mockHost/character';
import { createSystemMock, invalidPayloadOverrides } from './mockHost/system';
import { createPronunciationLookupMock } from './mockHost/pronunciationLookup';
import { createPronunciationOnlineMock } from './mockHost/pronunciationOnline';

export { applyMixedManuscriptMock } from './mockHost/manuscript';
export type { MockUpdateSeed } from './mockHost/update';

// The engine chip's 'builtin' state (stage-navigation-and-page-replacement.prd.md Phase 1, Q7) has no host field yet
// - nothing selects it until native recording builds a recorder - so it is a URL flag read directly rather than a
// NarrationApi binding, the same way `?mockEngine=builtin` reaches App.tsx in both the mock and the real client.
export function mockEngineFromLocation(): 'daw' | 'builtin' {
  return new URLSearchParams(window.location.search).get('mockEngine') === 'builtin' ? 'builtin' : 'daw';
}

export function createMockApi(
  overrides: Partial<NarrationApi> = {},
  // manuscriptCandidate boots a project with no imported manuscript but a
  // manuscript file waiting in its folder (Home offers to import it, ADR-0019).
  // teleprompter boots with a session already part-way through the first chapter.
  initial: MockApiSeed = {},
): NarrationApi {
  const s = createMockState(initial);
  const { endJob } = s;
  const update = createUpdateMock(initial);
  const project = createProjectMock(initial);
  const settings = createSettingsMock(() => base.bootstrap());
  const manuscript = createManuscriptMock(s, initial, { withMeasurement: (chapter) => withMeasurement(chapter) });
  const { manuscriptReady } = manuscript;
  const credits = createCreditsMock(s, initial, { settings: settings.settings, manuscriptReady });
  const assets = createAssetsMock(initial);
  const proofing = createProofingMock(s, assets);
  const reaperActions = createReaperActionsMock(initial, project.projectFolder);
  const chapterTracks = createChapterTracksMock(s, initial, {
    manuscriptReady,
    dawFileLinked: project.dawFileLinked,
    peekCoverage: (chapterId) => peekCoverage(chapterId),
  });
  const storyBible = createStoryBibleMock(s, initial, manuscriptReady, assets);
  const character = createCharacterMock(s);
  const teleprompter = createTeleprompterMock({
    ready: manuscriptReady,
    chapters: () => s.chapters,
    paragraphs: () => s.paragraphs,
    creditsText: credits.mockCreditsText,
    assetRequired: assets.teleprompterAssetRequired,
    trackMatch: (chapterId) => mockChapterTrackMatch(chapterId, s.chapters, WIRE_TRACKS_PROJECT, s.chapterTrackMappings),
    tracksProject: WIRE_TRACKS_PROJECT,
    seed: initial.teleprompter,
    devices: initial.teleprompterDevices ?? WIRE_TELEPROMPTER_DEVICES,
    ...(initial.teleprompterLevel === undefined ? {} : { level: initial.teleprompterLevel }),
    ...(initial.reaperState ? { reaper: initial.reaperState } : {}),
    ...(initial.reaperInput ? { reaperInput: initial.reaperInput } : {}),
    resume: initial.resume,
  });
  const {
    withMeasurement,
    peekResult: peekCoverage,
    ...coverage
  } = createCoverageMock({
    chapters: () => s.chapters,
    assetRequired: assets.whisperAssetRequired,
    // A finished check changes its chapter's status row, so chaptersync:state goes out again (auto-sync Phase 6).
    endJob: (event) => {
      endJob(event);
      chapterTracks.publishChapterSync(chapterTracks.mockChapterSyncState(null));
    },
    seed: initial.coverage,
  });
  // workspaceLooping mirrors findingNavigation.loopingID for a workspace loop (bindings_workspace.go): set by
  // workspaceLoop, read by findingsReaperStatus and cleared by findingsStopLoop below, so the workspace's own loop
  // is remembered the same way a finding's is (one app loop at a time, whichever page started it).
  const workspaceLooping: { current: string | undefined } = { current: undefined };
  const workspaceDeps = {
    chapters: () => s.chapters,
    paragraphs: () => s.paragraphs,
    coverageResult: peekCoverage,
    project: WIRE_TRACKS_PROJECT,
    mappings: () => s.chapterTrackMappings,
    reaper: initial.reaper,
    looping: workspaceLooping,
  };
  const workspace = createWorkspaceMock(workspaceDeps);
  const preview = createPreviewMock({ chapters: () => s.chapters, paragraphs: () => s.paragraphs }, initial.preview);
  const daw = createDawMock(initial.daw);
  const providers = createProvidersMock(initial.providers);
  const mastering = createMasteringMock(initial.mastering);
  const stages = createStagesMock({
    ready: manuscriptReady,
    chapters: () => s.chapters.map(withMeasurement),
    setStatus: (chapterId, status) => {
      s.chapters = s.chapters.map((chapter) => (chapter.id === chapterId ? { ...chapter, status } : chapter));
    },
    seed: initial.stages,
  });
  // A transcript_discrepancy finding for chapter-1's own deterministic mock misread (edit-and-proof-workspace.prd.md
  // Phase 4): built from the same position workspaceMock.ts already timed it at, so this finding and the workspace's
  // check-derived misread flag are the same event, merged by overlayFindings into one reviewable flag, exactly as
  // mockups/edit-and-proof-workspace/02-flag-detail-open.webp shows. Computed fresh on every findings read
  // (FindingsMockOptions.lazySeed), not once at boot: chapter-1 usually has no track link yet when this mock is
  // built (the narrator, or the visual suite's own driver, confirms one in the audio engine panel after the app has already
  // started), so a one-off boot-time computation would see no live item and never find this finding a home.
  const workspaceOverlayFinding = (): Finding[] => {
    const source = mockMisreadFindingSource(workspaceDeps, 'chapter-1');
    if (!source) return [];
    return [
      {
        schema_version: 1,
        id: 'workspace-overlay-chapter-1',
        analyzer: 'transcript-compare',
        project: { path: WIRE_TRACKS_PROJECT.path },
        source: { file: WIRE_TRACKS_PROJECT.tracks[0]?.items[0]?.sourceFile, item_guid: source.itemGuid },
        time_range: { start: source.start, end: source.end, source_start: source.start, source_end: source.end },
        manuscript: { chapter_id: 'chapter-1', chapter_title: s.chapters.find((candidate) => candidate.id === 'chapter-1')?.title, recorded: source.heard },
        category: 'transcript_discrepancy',
        severity: 'warning',
        confidence: 0.82,
        confidence_reason: 'compare.py measured a clear pause at this discrepancy’s audio boundary — stronger secondary evidence, not proof of a misread.',
        evidence_version: 'sha256:workspace-overlay-chapter-1',
        review: { status: 'unreviewed' },
      },
    ];
  };
  const production = createProductionMock({
    chapters: manuscript.bindings.manuscriptChapters,
    recommendations: stages.stageRecommendations,
    seed: initial.production,
  });
  const { saveAnalyzerFindings, saveFinding, saveFileFindings, ...findings } = createFindingsMock(initial.findings ?? WIRE_FINDINGS, {
    rerunAfterFirstList: initial.findingsRerun,
    reaper: initial.reaper,
    // Only the default seed demonstrates the overlay; a caller supplying its own findings (most tests) opts out, as
    // it already does for WIRE_FINDINGS itself.
    ...(initial.findings ? {} : { lazySeed: workspaceOverlayFinding }),
  });
  const takeReviewScan = createTakeReviewScanMock(saveAnalyzerFindings, endJob, initial.takeReviewScanHold);
  const takeComparison = createTakeComparisonMock({ get: findings.findingsGet, save: saveFinding }, endJob, initial.takeComparisonHold);
  const measurePicked = new Set<string>();
  const { recordMeasurement: recordRenderMeasurement, ...proofingRender } = createProofingRenderMock({
    ready: manuscriptReady,
    chapters: () => s.chapters,
    picked: measurePicked,
    seed: initial.proofingRender,
  });
  const { current: deliveryProfile, ...deliveryProfiles } = createDeliveryProfilesMock(initial.deliveryProfile);
  const { peekDiagnostics, ...diagnostics } = createDiagnosticsMock(endJob, measurePicked, initial.diagnostics);
  const editing = createEditingMock(initial.editing);
  const cleanupAction = createCleanupActionMock(
    async (chapterId) => (await findings.findingsList({ analyzer: 'editing', chapterId })).findings,
    initial.cleanupAction,
  );
  const prepMarkup = createPrepMarkupMock(
    manuscriptReady,
    () => s.chapters,
    () => s.paragraphs,
    initial.prepMarkup,
  );
  const { resaveReview, ...measurement } = createMeasureMock(endJob, initial.measure, measurePicked, deliveryProfile, peekDiagnostics, (job) => {
    const review = mockDeliveryReviewFindings(job);
    saveFileFindings(DELIVERY_REVIEW_ANALYZER, review.files, review.findings);
    recordRenderMeasurement(job.files);
  });
  const renderEncodeMaster = createRenderEncodeMasterMock(endJob, initial.renderExport, deliveryProfile);
  const system = createSystemMock(s, initial, {
    version: update.version,
    project,
    transcript: proofing.transcript,
    dictionaryState: assets.dictionaryState,
  });
  const base: NarrationApi = {
    ...system.bindings,
    ...manuscript.bindings,
    ...settings.bindings,
    ...storyBible.bindings,
    ...character.bindings,
    ...assets.bindings,
    ...proofing.bindings,
    ...reaperActions.bindings,
    ...project.bindings,
    ...credits.bindings,
    ...chapterTracks.bindings,
    ...takeReviewScan,
    ...takeComparison,
    ...measurement,
    ...renderEncodeMaster,
    ...resavingAfterProfileChange(deliveryProfiles, resaveReview),
    ...diagnostics,
    ...editing,
    // Reads the same findings store FindingsReview decides against (apps/desktop/internal/editing/scan.go's
    // Candidates), not editingMock's own state: a candidate is seeded like any other finding (`initial.findings`,
    // editingCandidateFor in mockFixtures.ts), so Accept/Dismiss/Defer on it go through the real review binding.
    editingCandidates: async (chapterId) => (await findings.findingsList({ analyzer: 'editing', chapterId })).findings,
    ...cleanupAction,
    ...prepMarkup,
    // prep-depth.prd.md Phase 7: read the same two calls the real host reads (Phase 3's queries, Phase 5's markup per
    // chapter), never a third mock store.
    prepCompletenessSummary: async () => {
      const queries = await storyBible.bindings.guidePronunciationQueries();
      const staleSpansByChapterId = new Map<string, number>();
      for (const chapter of s.chapters) {
        const { spans } = await prepMarkup.prepMarkupList(chapter.id);
        staleSpansByChapterId.set(chapter.id, spans.filter((span) => span.stale).length);
      }
      return buildPrepCompletenessSummaryMock(s.chapters, queries, staleSpansByChapterId);
    },
    takeReviewCreateTake: async (request) => ({
      targetItemGuid: request.targetItemGuid,
      newTakeGuid: '{99999999-0000-4000-8000-000000000099}',
    }),
    ...update.bindings,
    ...teleprompter,
    ...coverage,
    ...workspace,
    ...preview,
    ...stages,
    ...proofingRender,
    ...production,
    ...findings,
    // Merge the workspace's own loop into the shared REAPER status/stop, after ...findings so these win: one app
    // loop at a time, whichever page started it, exactly as the real host's findingNavigation does.
    findingsReaperStatus: async () => {
      const status = await findings.findingsReaperStatus();
      return workspaceLooping.current && status.connection === 'connected' ? { ...status, loopingFindingId: workspaceLooping.current } : status;
    },
    findingsStopLoop: async () => {
      if (workspaceLooping.current === undefined) return findings.findingsStopLoop();
      workspaceLooping.current = undefined;
      return { outcome: 'stopped', restored: 1, kept: 0 };
    },
    ...daw,
    ...providers,
    ...mastering,
    ...createPronunciationLookupMock(),
    ...createPronunciationOnlineMock(),
  };
  const api = initial.invalidPayload ? { ...base, ...invalidPayloadOverrides(initial.invalidPayload, base) } : base;
  return { ...api, ...overrides };
}
