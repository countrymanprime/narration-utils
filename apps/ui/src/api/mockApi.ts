// Browser/mock API. It deliberately uses the same literal fixture data
// everywhere so visual review never silently exercises placeholder
// content instead of the screen we are trying to match.
//
// Each feature area's bindings live in their own file under mockHost/ (the state they share is mockHost/state.ts);
// this file only puts them together, with the per-feature mocks beside it (teleprompterMock.ts, coverageMock.ts, ...).
import type { NarrationApi } from '../types';
import { WIRE_FINDINGS, WIRE_TELEPROMPTER_DEVICES, WIRE_TRACKS_PROJECT } from './mockFixtures';
import { mockChapterTrackMatch } from './chapterTrackMatchMock';
import { createTeleprompterMock } from './teleprompterMock';
import { createCoverageMock } from './coverageMock';
import { createWorkspaceMock } from './workspaceMock';
import { createPreviewMock } from './previewMock';
import { createStagesMock } from './stagesMock';
import { createFindingsMock } from './findingsMock';
import { createTakeReviewScanMock } from './takeReviewMock';
import { createTakeComparisonMock } from './takeComparisonMock';
import { createMeasureMock } from './measureMock';
import { createDeliveryProfilesMock } from './deliveryProfilesMock';
import { createDiagnosticsMock } from './diagnosticsMock';
import { createEditingMock } from './editingMock';
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
import { createSystemMock, invalidPayloadOverrides } from './mockHost/system';

export { applyMixedManuscriptMock } from './mockHost/manuscript';
export type { MockUpdateSeed } from './mockHost/update';

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
  const workspace = createWorkspaceMock({
    chapters: () => s.chapters,
    paragraphs: () => s.paragraphs,
    coverageResult: peekCoverage,
    project: WIRE_TRACKS_PROJECT,
    mappings: () => s.chapterTrackMappings,
  });
  const preview = createPreviewMock({ chapters: () => s.chapters, paragraphs: () => s.paragraphs }, initial.preview);
  const stages = createStagesMock({
    ready: manuscriptReady,
    chapters: () => s.chapters.map(withMeasurement),
    setStatus: (chapterId, status) => {
      s.chapters = s.chapters.map((chapter) => (chapter.id === chapterId ? { ...chapter, status } : chapter));
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
  const { current: deliveryProfile, ...deliveryProfiles } = createDeliveryProfilesMock(initial.deliveryProfile);
  const { peekDiagnostics, ...diagnostics } = createDiagnosticsMock(endJob, measurePicked, initial.diagnostics);
  const editing = createEditingMock(initial.editing);
  const measurement = createMeasureMock(endJob, initial.measure, measurePicked, deliveryProfile, peekDiagnostics);
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
    ...assets.bindings,
    ...proofing.bindings,
    ...reaperActions.bindings,
    ...project.bindings,
    ...credits.bindings,
    ...chapterTracks.bindings,
    ...takeReviewScan,
    ...takeComparison,
    ...measurement,
    ...deliveryProfiles,
    ...diagnostics,
    ...editing,
    // Reads the same findings store FindingsReview decides against (apps/desktop/internal/editing/scan.go's
    // Candidates), not editingMock's own state: a candidate is seeded like any other finding (`initial.findings`,
    // editingCandidateFor in mockFixtures.ts), so Accept/Dismiss/Defer on it go through the real review binding.
    editingCandidates: async (chapterId) => (await findings.findingsList({ analyzer: 'editing', chapterId })).findings,
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
    ...findings,
  };
  const api = initial.invalidPayload ? { ...base, ...invalidPayloadOverrides(initial.invalidPayload, base) } : base;
  return { ...api, ...overrides };
}
