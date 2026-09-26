import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { DESKTOP_HOST_API_VERSION } from '../hostApi';
import { createMockApi } from './mockApi';
import type { ProjectStateState } from './contracts/projectstate';
import { WIRE_TAKE_REVIEW_FINDINGS, WIRE_TRACKS_PROJECT, WIRE_TRANSCRIPT } from './mockFixtures';
import { WIRE_TAKE_COMPARISON_FINDING } from './takeComparisonMock';
import { MOCK_MEASURE_PATHS } from './measureMock';
import { judgeMock } from './coverageMock';
import { MOCK_REAPER_INPUT_SEEDS, MOCK_REAPER_SEEDS, mockLastReading } from './teleprompterMock';
import { deliveryQcEvidenceSchema, deliveryReportExportSchema, measureJobSchema, measurePickResultSchema } from './schemas/measure';
import { deliveryProfileSchema, deliveryProfilesStateSchema } from './schemas/deliveryProfiles';
import { MOCK_ACX, evaluateMockFile, mockCustomProfile } from './deliveryProfilesMock';
import { diagnosticsJobSchema } from './schemas/diagnostics';
import {
  bookmarkSchema,
  chapterKindResultSchema,
  chapterSchema,
  chaptersSchema,
  fileSelectionSchema,
  noteSchema,
  notesSchema,
  paragraphsSchema,
  readerSchema,
  readerStateSchema,
  searchHitsSchema,
  workJobSchema,
} from './schemas/manuscript';
import { chapterSyncPreviewSchema, chapterSyncStateSchema } from './schemas/chapterSync';
import { assetCatalogSchema, assetInstallJobSchema, assetVerifyResultSchema } from './schemas/assets';
import { settingsForScopeSchema } from './schemas/settings';
import {
  takeComparisonEvidenceSchema,
  takeComparisonJobSchema,
  takeReviewCreateTakeResultSchema,
  takeReviewEvidenceSchema,
  takeReviewScanJobSchema,
} from './schemas/takeReview';
import { COVERAGE_EVALUATOR_REASONS, COVERAGE_REFUSAL_REASONS, coverageResultSchema, coverageStartResultSchema, coverageStateSchema } from './schemas/coverage';
import { editingCandidatesSchema, editingStartResultSchema, editingStateSchema } from './schemas/editing';
import { STAGE_REFUSAL_REASONS, STAGE_UNKNOWN_CAUSES, stageDecisionResultSchema, stageRecommendationsSchema } from './schemas/stages';
import { findingMarkerSchema, findingNavigationSchema, findingSchema, findingsPageSchema, findingsSummarySchema, reaperStatusSchema } from './schemas/findings';
import { tracksDiscoverySchema, tracksProjectSchema } from './schemas/tracks';
import {
  chaptersForTracksSchema,
  chapterSuggestionSchema,
  chapterRegionPlanSchema,
  chapterRegionsCreatedSchema,
  chapterTrackLinksSchema,
  chapterTrackMappingSchema,
  chapterTrackMatchSchema,
  chapterTrackSetSchema,
  trackMappingSchema,
} from './schemas/chapterTrackMap';
import { ttsCatalogSchema, ttsInstallJobSchema } from './schemas/tts';
import { updateJobSchema, updateStatusSchema } from './schemas/update';
import { startResultSchema, whisperCatalogSchema, whisperInstallJobSchema } from './schemas/whisper';
import { dawLaunchResultSchema, dawLinkResultSchema, projectFolderSelectionSchema, projectSwitchResultSchema, recentProjectsSchema } from './schemas/project';
import {
  creditsAnnouncementsSchema,
  creditsProjectValuesResultSchema,
  creditsSetupStateSchema,
  creditsRenderResultSchema,
  creditsStatusesSchema,
  creditTemplateSchema,
  creditTemplatesSchema,
  retailSampleAnswerSchema,
} from './schemas/credits';
import { dawCatalogListSchema } from './schemas/dawCatalog';
import { guideBuildResultSchema, guideCreatedSchema, guideEntitiesSchema, guidePreviewSchema } from './schemas/storyBible';
import { bootstrapSchema, copyDiagnosticsResultSchema, jobEndedSchema, noticeSchema, projectAttachStateSchema, readySchema } from './schemas/system';
import {
  readAloudReaperStateSchema,
  teleprompterReaperInputSchema,
  teleprompterDevicesResultSchema,
  teleprompterEventSchema,
  teleprompterFlagFindingsSchema,
  teleprompterReadingSchema,
  teleprompterLocatedSchema,
  teleprompterLocateResultSchema,
  teleprompterStartResultSchema,
  teleprompterStateSchema,
} from './schemas/teleprompter';
import { equivalenceSchema, hintSuggestionsSchema, hintsSchema, lastCompletedSchema, transcriptStateSchema } from './schemas/transcript';
import { lineIdentityStartResultSchema, lineIdentityStateSchema } from './schemas/lineidentity';
import { pickupsImportResultSchema, pickupsStartResultSchema, pickupsStateSchema } from './schemas/pickups';
import { renderConfigStartResultSchema, renderConfigStateSchema, renderConfigSuggestedFolderSchema } from './schemas/renderconfig';
import { cleanupToolsStartResultSchema, cleanupToolsStateSchema } from './schemas/cleanuptools';
import { projectStateChangedSchema, projectStateStartResultSchema, projectStateStateSchema } from './schemas/projectstate';
import { retakeLanesListSchema, retakeLanesStartResultSchema, retakeLanesStateSchema } from './schemas/retakelanes';
import { chapterTagsEmbedResultSchema, chapterTagsPreviewSchema } from './schemas/chaptertags';
import { dictionaryLookupResultSchema } from './schemas/dictionary';
import { unknownKeys } from './schemas/strictness';
import { parseWire, type WireContext } from './wire/parseWire';
import { WireError } from './wire/WireError';
import { creditsRows } from '../components/teleprompter/readerModel';

// ADR 0069, rule 4: the fixtures are the contract. Every payload the Go host and the Python sidecars write to
// tests/fixtures/contracts/ is validated here by the same schemas the app runs, and so is every answer the mock client gives;
// both are also checked strictly, so a key the schema does not declare fails here even though the app itself would ignore it.
const GOLDEN_DIR = fileURLToPath(new URL('../../../../tests/fixtures/contracts/', import.meta.url));
const ctx = (payload: string): WireContext => ({ boundary: 'contract.test', payload });

/** Validates `value`, and fails on any key the schema does not declare. */
function expectMatches(schema: z.ZodType, value: unknown, payload: string): void {
  parseWire(schema, value, ctx(payload));
  expect(unknownKeys(schema, value), `${payload} has keys its schema does not declare`).toEqual([]);
}

// One row per committed file: which schema owns it. A new file with no row fails the first test below.
const GOLDEN: Record<string, z.ZodType> = {
  'bootstrap-manuscript.json': bootstrapSchema,
  'bootstrap-candidate.json': bootstrapSchema,
  'bootstrap-standalone.json': bootstrapSchema,
  'transcript-idle.json': transcriptStateSchema,
  'transcript-success.json': transcriptStateSchema,
  'teleprompter-state-idle.json': teleprompterStateSchema,
  'teleprompter-state-running.json': teleprompterStateSchema,
  'teleprompter-events.json': teleprompterEventSchema.array(),
  'teleprompter-credits-script.json': teleprompterEventSchema,
  'teleprompter-devices.json': teleprompterDevicesResultSchema,
  'teleprompter-start-asset-required-whisper.json': teleprompterStartResultSchema,
  'teleprompter-start-asset-required-moonshine.json': teleprompterStartResultSchema,
  // The sidecar's own `locate` line (locate.py), which the host checks and carries as `located`.
  'teleprompter-locate.json': teleprompterLocatedSchema.extend({ type: z.literal('locate') }),
  'teleprompter-locate-found.json': teleprompterLocateResultSchema,
  'teleprompter-locate-no-track.json': teleprompterLocateResultSchema,
  'teleprompter-locate-no-recording.json': teleprompterLocateResultSchema,
  'teleprompter-locate-source-missing.json': teleprompterLocateResultSchema,
  'teleprompter-locate-agree.json': teleprompterLocateResultSchema,
  'teleprompter-locate-disagree.json': teleprompterLocateResultSchema,
  'teleprompter-locate-complete.json': teleprompterLocateResultSchema,
  'teleprompter-locate-prompter-only.json': teleprompterLocateResultSchema,
  'teleprompter-save-flags.json': teleprompterFlagFindingsSchema,
  // The per-chapter reading file the host writes at session end and reads back (ADR 0205).
  'teleprompter-reading.json': teleprompterReadingSchema,
  'teleprompter-level.json': teleprompterEventSchema.array(),
  'teleprompter-meter-stopped.json': teleprompterEventSchema.array(),
  'read-aloud-reaper-states.json': z.record(z.string(), readAloudReaperStateSchema),
  'teleprompter-reaper-inputs.json': z.record(z.string(), teleprompterReaperInputSchema),
  'manuscript-import-selected.json': workJobSchema,
  'manuscript-import-preview.json': workJobSchema,
  'manuscript-import-preview-repaired.json': workJobSchema,
  'manuscript-import-preview-text-subtitle.json': workJobSchema,
  'manuscript-import-success.json': workJobSchema,
  'manuscript-chapters.json': chaptersSchema,
  'manuscript-chapter-status.json': chapterSchema,
  'manuscript-chapter-kind-removed.json': chapterKindResultSchema,
  'manuscript-paragraphs.json': paragraphsSchema,
  'manuscript-search.json': searchHitsSchema,
  'manuscript-note.json': noteSchema,
  'manuscript-notes.json': notesSchema,
  'manuscript-notes-empty.json': notesSchema,
  'manuscript-bookmark.json': bookmarkSchema,
  'manuscript-reader-state.json': readerStateSchema,
  'manuscript-reader-state-empty.json': readerStateSchema,
  'manuscript-reader.json': readerSchema,
  'guide-entities-sidecar.json': guideEntitiesSchema,
  'guide-entities.json': guideEntitiesSchema,
  'guide-entities-legacy.json': guideEntitiesSchema,
  'guide-entities-empty.json': guideEntitiesSchema,
  'guide-build-idle.json': workJobSchema,
  'guide-build-starting.json': workJobSchema,
  'guide-build-failed.json': workJobSchema,
  'guide-build-started.json': guideBuildResultSchema,
  'guide-build-asset-required.json': guideBuildResultSchema,
  'guide-preview-asset-required.json': guidePreviewSchema,
  'system-lookup-found.json': dictionaryLookupResultSchema,
  'system-lookup-asset-required.json': dictionaryLookupResultSchema,
  'system-copy-diagnostics.json': copyDiagnosticsResultSchema,
  'project-recents.json': recentProjectsSchema,
  'project-recents-empty.json': recentProjectsSchema,
  'project-switch-attached.json': projectSwitchResultSchema,
  'project-switch-refused.json': projectSwitchResultSchema,
  'daw-link-selected.json': dawLinkResultSchema,
  'daw-link-folder-mismatch.json': dawLinkResultSchema,
  'daw-link-cancelled.json': dawLinkResultSchema,
  'daw-launch.json': dawLaunchResultSchema,
  'credits-templates.json': creditTemplatesSchema,
  'credits-project-values-empty.json': creditsProjectValuesResultSchema,
  'credits-setup-state-needed.json': creditsSetupStateSchema,
  'credits-setup-state-dismissed.json': creditsSetupStateSchema,
  'credits-preview-unresolved.json': creditsRenderResultSchema,
  'credits-chapter-announcements.json': creditsAnnouncementsSchema,
  'credits-retail-sample.json': retailSampleAnswerSchema,
  'credits-retail-sample-none.json': retailSampleAnswerSchema,
  'credits-retail-sample-stale.json': retailSampleAnswerSchema,
  'credits-status-empty.json': creditsStatusesSchema,
  'credits-status-set.json': creditsStatusesSchema,
  'system-notice.json': noticeSchema,
  'job-ended-success.json': jobEndedSchema,
  'job-ended-error.json': jobEndedSchema,
  'tts-catalog.json': ttsCatalogSchema,
  'tts-install-downloading.json': ttsInstallJobSchema,
  'tts-install-success.json': ttsInstallJobSchema,
  'tts-install-error.json': ttsInstallJobSchema,
  'tts-install-cancelled.json': ttsInstallJobSchema,
  'asset-install-downloading.json': assetInstallJobSchema,
  'assets-list.json': assetCatalogSchema,
  'assets-verify.json': assetVerifyResultSchema,
  'whisper-catalog.json': whisperCatalogSchema,
  'whisper-install-downloading.json': whisperInstallJobSchema,
  'tts-install-verifying.json': ttsInstallJobSchema,
  'whisper-install-success.json': whisperInstallJobSchema,
  'transcript-start-asset-required.json': startResultSchema,
  'transcript-start-started.json': startResultSchema,
  'settings-global.json': settingsForScopeSchema,
  'settings-project.json': settingsForScopeSchema,
  'update-status-unchecked.json': updateStatusSchema,
  'update-status-available.json': updateStatusSchema,
  'update-status-check-failed.json': updateStatusSchema,
  'update-status-development.json': updateStatusSchema,
  'update-status-downloaded.json': updateStatusSchema,
  'update-job-downloading.json': updateJobSchema,
  'update-job-verifying.json': updateJobSchema,
  'update-job-ready.json': updateJobSchema,
  'update-job-installing.json': updateJobSchema,
  'update-job-error.json': updateJobSchema,
  'update-job-cancelled.json': updateJobSchema,
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
  'line-identity-idle.json': lineIdentityStateSchema,
  'line-identity-read-success.json': lineIdentityStateSchema,
  'pickups-idle.json': pickupsStateSchema,
  'pickups-import-success.json': pickupsStateSchema,
  'render-config-idle.json': renderConfigStateSchema,
  'render-config-success.json': renderConfigStateSchema,
  'cleanup-tools-idle.json': cleanupToolsStateSchema,
  'cleanup-tools-launched.json': cleanupToolsStateSchema,
  'project-state-idle.json': projectStateStateSchema,
  'project-state-checked.json': projectStateStateSchema,
  'project-state-changed-since.json': projectStateChangedSchema,
  'retake-lanes-list.json': retakeLanesListSchema,
  'retake-lanes-idle.json': retakeLanesStateSchema,
  'retake-lanes-picked.json': retakeLanesStateSchema,
  'chapter-tags-preview-idle.json': chapterTagsPreviewSchema,
  'chapter-tags-preview-ready.json': chapterTagsPreviewSchema,
  'chapter-tags-embed-success.json': chapterTagsEmbedResultSchema,
  'findings-list-take-review.json': findingsPageSchema,
  'takereview-scan-idle.json': takeReviewScanJobSchema,
  'takereview-scan-running.json': takeReviewScanJobSchema,
  'takereview-scan-success.json': takeReviewScanJobSchema,
  'takereview-scan-cancelled.json': takeReviewScanJobSchema,
  'takereview-scan-error.json': takeReviewScanJobSchema,
  'takereview-create-take.json': takeReviewCreateTakeResultSchema,
  'manuscript-chapters-measured.json': chaptersSchema,
  'manuscript-chapters-recorded.json': chaptersSchema,
  'coverage-result-current.json': coverageResultSchema,
  'coverage-result-stale.json': coverageResultSchema,
  'coverage-result-never.json': coverageResultSchema,
  'coverage-result-unmapped.json': coverageResultSchema,
  'coverage-start-started.json': coverageStartResultSchema,
  'coverage-start-refused.json': coverageStartResultSchema,
  'coverage-state-idle.json': coverageStateSchema,
  'editing-state-idle.json': editingStateSchema,
  'editing-start-refused-unmapped.json': editingStartResultSchema,
  'editing-candidates-empty.json': editingCandidatesSchema,
  'coverage-state-complete.json': coverageStateSchema,
  // Not a payload: the reason words the host can send, which the schema's lists must equal (the test below).
  'coverage-reasons.json': z.object({ refusal: z.array(z.string()), evaluator: z.array(z.string()) }),
  'stages-recommendations-unknown.json': stageRecommendationsSchema,
  'stages-recommendations-recommended.json': stageRecommendationsSchema,
  'stages-recommendations-dismissed.json': stageRecommendationsSchema,
  'stages-recommendations-contradiction.json': stageRecommendationsSchema,
  'stages-decision-confirmed.json': stageDecisionResultSchema,
  'stages-decision-refused.json': stageDecisionResultSchema,
  // Not payloads: the cause and refusal words the host can send, which the schema's lists must equal (the test below).
  'stages-causes.json': z.array(z.string()),
  'stages-refusal-reasons.json': z.array(z.string()),
  'findings-list-take-comparison.json': findingsPageSchema,
  'takecomparison-idle.json': takeComparisonJobSchema,
  'takecomparison-running.json': takeComparisonJobSchema,
  'takecomparison-success.json': takeComparisonJobSchema,
  'takecomparison-cancelled.json': takeComparisonJobSchema,
  'takecomparison-error.json': takeComparisonJobSchema,
  'measure-pick.json': measurePickResultSchema,
  'measure-pick-cancelled.json': measurePickResultSchema,
  'measure-idle.json': measureJobSchema,
  'measure-running.json': measureJobSchema,
  'measure-success.json': measureJobSchema,
  'measure-mp3.json': measureJobSchema,
  'measure-cancelled.json': measureJobSchema,
  'measure-error.json': measureJobSchema,
  'delivery-report-export.json': deliveryReportExportSchema,
  'delivery-profiles.json': deliveryProfilesStateSchema,
  'delivery-profiles-no-project.json': deliveryProfilesStateSchema,
  'delivery-profile-saved.json': deliveryProfileSchema,
  'diagnostics-idle.json': diagnosticsJobSchema,
  'diagnostics-running.json': diagnosticsJobSchema,
  'diagnostics-success.json': diagnosticsJobSchema,
  'diagnostics-cancelled.json': diagnosticsJobSchema,
  'diagnostics-error.json': diagnosticsJobSchema,
  // compare.py --take-divergence's results file, pinned by its pytest suite and read by the Go host's parser
  // (internal/takecompare), never by the UI: the host turns it into take_comparison evidence, checked above.
  'take-divergence-results.json': z.object({ lines: z.array(z.string()) }),
  'findings-list.json': findingsPageSchema,
  'findings-review.json': findingSchema,
  'findings-summary.json': findingsSummarySchema,
  'findings-reaper-status-looping.json': reaperStatusSchema,
  'findings-reaper-status-not-running.json': reaperStatusSchema,
  'findings-reaper-status-standalone.json': reaperStatusSchema,
  'findings-go-to.json': findingNavigationSchema,
  'findings-go-to-read.json': findingNavigationSchema,
  'findings-loop-read.json': findingNavigationSchema,
  'findings-loop.json': findingNavigationSchema,
  'findings-stop-loop.json': findingNavigationSchema,
  'findings-navigation-stale.json': findingNavigationSchema,
  'findings-navigation-recording.json': findingNavigationSchema,
  'findings-navigation-no-item.json': findingNavigationSchema,
  'findings-navigation-not-running.json': findingNavigationSchema,
  'findings-add-marker.json': findingMarkerSchema,
  'findings-add-marker-existing.json': findingMarkerSchema,
  'findings-add-marker-not-accepted.json': findingMarkerSchema,
  'findings-add-marker-stale.json': findingMarkerSchema,
};

const readGolden = (file: string): unknown => JSON.parse(readFileSync(`${GOLDEN_DIR}${file}`, 'utf8'));

describe('golden payloads written by the Go host and the Python sidecars', () => {
  it('every committed file has a schema, and every schema row has a file', () => {
    const committed = readdirSync(GOLDEN_DIR)
      .filter((name) => name.endsWith('.json'))
      .sort();
    expect(committed).toEqual(Object.keys(GOLDEN).sort());
  });

  it.each(Object.entries(GOLDEN))('%s matches its schema and declares nothing the schema lacks', (file, schema) => {
    expectMatches(schema, readGolden(file), file);
  });

  it('the golden Bootstrap carries the API version this UI is built for', () => {
    expect(parseWire(bootstrapSchema, readGolden('bootstrap-manuscript.json'), ctx('bootstrap')).apiVersion).toBe(DESKTOP_HOST_API_VERSION);
  });

  it('the coverage reason lists are the ones the host declares', () => {
    const declared = z.object({ refusal: z.array(z.string()), evaluator: z.array(z.string()) }).parse(readGolden('coverage-reasons.json'));
    expect([...COVERAGE_REFUSAL_REASONS]).toEqual(declared.refusal);
    expect([...COVERAGE_EVALUATOR_REASONS]).toEqual(declared.evaluator);
  });

  it('a coverage region keeps its bounds, and a missing bound reads as absent (ADR 0168)', () => {
    const current = parseWire(coverageResultSchema, readGolden('coverage-result-current.json'), ctx('coverage result'));
    const [tail] = current.result?.regions ?? [];
    expect(tail.before).toEqual({ itemIndex: 1, itemGuid: '{ITEM-B}', sourceTime: 0.3 });
    expect(tail.after).toBeUndefined();
    // A result stored before the sidecar reported bounds has neither key.
    const golden = z
      .looseObject({ result: z.looseObject({ regions: z.array(z.record(z.string(), z.unknown())) }) })
      .parse(readGolden('coverage-result-current.json'));
    const regions = golden.result.regions.map(({ before: _before, after: _after, ...rest }) => rest);
    const older = { ...golden, result: { ...golden.result, regions } };
    const [oldTail] = parseWire(coverageResultSchema, older, ctx('coverage result')).result?.regions ?? [];
    expect([oldTail.before, oldTail.after]).toEqual([undefined, undefined]);
  });

  it("a coverage result carries the host's judgement, and the mock judges its reports by the same rule (ADR 0204)", () => {
    for (const name of ['coverage-result-current.json', 'coverage-result-stale.json']) {
      const golden = parseWire(coverageResultSchema, readGolden(name), ctx('coverage result'));
      expect(golden.judgement).toBeDefined();
      expect(golden.result && judgeMock(golden.result, golden.judgement?.thresholds)).toEqual(golden.judgement);
    }
    for (const name of ['coverage-result-never.json', 'coverage-result-unmapped.json']) {
      expect(parseWire(coverageResultSchema, readGolden(name), ctx('coverage result')).judgement).toBeUndefined();
    }
  });

  it('the mock last reading passes the reading schema, and a read past the last word does not', () => {
    expectMatches(teleprompterReadingSchema, mockLastReading('c-0001', 812, 900), 'mock teleprompter reading');
    const golden = z.looseObject({}).parse(readGolden('teleprompter-reading.json'));
    expect(() => parseWire(teleprompterReadingSchema, { ...golden, read: 5, tokens: 4 }, ctx('teleprompter reading'))).toThrow();
  });

  it('the mock meter sends a level, refuses while reading and ends with meter_stopped, all passing the event schema', async () => {
    const api = createMockApi({}, { teleprompterLevel: -18 });
    const events: unknown[] = [];
    api.subscribeTeleprompterEvent((event) => events.push(event));
    await api.teleprompterMeterStart('Microphone Array (Realtek(R) Audio)');
    await api.teleprompterMeterStop();
    expect(events).toEqual([
      { type: 'level', peak: -9, rms: -18 },
      { type: 'meter_stopped', error: null },
    ]);
    events.forEach((event) => expectMatches(teleprompterEventSchema, event, 'mock meter event'));
  });

  it('the mock pauses only a running session, and its paused state passes the state schema', async () => {
    const api = createMockApi({}, { teleprompter: 'listening' });
    const states: unknown[] = [];
    api.subscribeTeleprompterState((state) => states.push(state));
    await api.teleprompterState();
    await api.teleprompterPause(true);
    expect(await api.teleprompterState()).toMatchObject({ phase: 'running', paused: true, message: 'Paused.' });
    await api.teleprompterPause(false);
    expect(await api.teleprompterState()).toMatchObject({ phase: 'running', paused: false });
    states.forEach((state) => expectMatches(teleprompterStateSchema, state, 'mock paused state'));
    await api.teleprompterStop();
    await expect(api.teleprompterPause(true)).rejects.toThrow('no teleprompter session is running');
  });

  it("every mock REAPER state passes the schema and says what the host's golden says for the same case", async () => {
    const golden = z.record(z.string(), readAloudReaperStateSchema).parse(readGolden('read-aloud-reaper-states.json'));
    for (const seed of MOCK_REAPER_SEEDS) {
      const api = createMockApi({}, { reaperState: seed });
      const [chapter] = await api.manuscriptChapters();
      const state = await api.readAloudReaperState(chapter.id);
      expectMatches(readAloudReaperStateSchema, state, `mock reaper state ${seed}`);
      const host = golden[seed === 'unavailable' ? 'experimental_off' : seed];
      if (seed !== 'unavailable') expect([state.status, state.reason]).toEqual([host.status, host.reason]);
    }
  });

  it("every mock REAPER input answer passes the schema, preselects only a listed microphone, and matches the host's golden", async () => {
    const golden = z.record(z.string(), teleprompterReaperInputSchema).parse(readGolden('teleprompter-reaper-inputs.json'));
    for (const seed of MOCK_REAPER_INPUT_SEEDS) {
      const api = createMockApi({}, { reaperInput: seed });
      const input = await api.teleprompterReaperInput();
      expectMatches(teleprompterReaperInputSchema, input, `mock reaper input ${seed}`);
      expect([input.status, input.reason]).toEqual([golden[seed].status, golden[seed].reason]);
      const listed = (await api.teleprompterDevices()).devices.map((device) => device.name);
      if (input.device !== undefined) expect(listed).toContain(input.device);
    }
    expect(() => parseWire(teleprompterReaperInputSchema, { status: 'no_match', device: 'X', message: '', candidates: [] }, ctx('reaper input'))).toThrow();
  });

  it('the stage cause and refusal lists are the ones the host declares', () => {
    expect([...STAGE_UNKNOWN_CAUSES]).toEqual(z.array(z.string()).parse(readGolden('stages-causes.json')));
    expect([...STAGE_REFUSAL_REASONS]).toEqual(z.array(z.string()).parse(readGolden('stages-refusal-reasons.json')));
  });

  it('recordedFraction is only on the chapter the coverage measured', () => {
    const chapters = parseWire(chaptersSchema, readGolden('manuscript-chapters-measured.json'), ctx('chapters'));
    expect(chapters.map((chapter) => chapter.recordedFraction)).toEqual([0.75, ...chapters.slice(1).map(() => undefined)]);
    const unmeasured = parseWire(chaptersSchema, readGolden('manuscript-chapters.json'), ctx('chapters'));
    expect(unmeasured.every((chapter) => chapter.recordedFraction === undefined)).toBe(true);
  });

  it('recordedSeconds is only on a chapter with a linked track, and the others say why', () => {
    const chapters = parseWire(chaptersSchema, readGolden('manuscript-chapters-recorded.json'), ctx('chapters'));
    expect(chapters.map((chapter) => chapter.recordedSeconds)).toEqual([2520.5, ...chapters.slice(1).map(() => undefined)]);
    expect(chapters.map((chapter) => chapter.recordedUnavailable)).toEqual([undefined, 'unlinked', ...chapters.slice(2).map(() => undefined)]);
  });

  it('the golden completed run keeps its rows and marker states through the schema', () => {
    const state = parseWire(transcriptStateSchema, readGolden('transcript-success.json'), ctx('transcript'));
    expect(state.rows.map((row) => row.markerState)).toEqual(['pending', 'existing']);
    expect(state.runId).toBe('1789000000000000');
  });
});

describe('answers of the mock client (it must pass the schemas the real host answers are held to)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('ready and the default bootstrap', async () => {
    const api = createMockApi();
    expectMatches(readySchema, await api.ready(), 'mock ready');
    expectMatches(bootstrapSchema, await api.bootstrap(), 'mock bootstrap');
  });

  it.each([
    ['a project with no manuscript', { noManuscript: true }],
    ['a project offering a manuscript file', { manuscriptCandidate: { path: 'C:/Projects/Alice/manuscript.docx', name: 'manuscript.docx' } }],
    ['a standalone launch with no project', { projectFolder: '' }],
  ])('bootstrap for %s', async (_name, initial) => {
    expectMatches(bootstrapSchema, await createMockApi({}, initial).bootstrap(), 'mock bootstrap');
  });

  it('the fixture transcript state', () => {
    expectMatches(transcriptStateSchema, WIRE_TRANSCRIPT, 'WIRE_TRANSCRIPT');
  });

  it('the transcript state through a whole comparison run, including marker export', async () => {
    vi.useFakeTimers();
    const api = createMockApi();
    const seen: unknown[] = [];
    api.subscribeTranscript((state) => seen.push(structuredClone(state)));
    await expect(api.transcriptStart({ model: 'small', chunk: '60', workers: '1', hints: '' })).resolves.toEqual({ status: 'started' });
    await vi.advanceTimersByTimeAsync(60_000);
    await api.transcriptExportMarkers();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(seen.length).toBeGreaterThan(3);
    for (const state of seen) expectMatches(transcriptStateSchema, state, 'mock transcript state');
    expect(new Set(seen.map((state) => (state as { phase: string }).phase)).size).toBeGreaterThan(2);
  });

  it('the teleprompter state and events through a session, from idle to stopped', async () => {
    vi.useFakeTimers();
    const api = createMockApi();
    const events: unknown[] = [];
    const states: unknown[] = [];
    api.subscribeTeleprompterEvent((event) => events.push(event));
    api.subscribeTeleprompterState((state) => states.push(state));
    expectMatches(teleprompterStateSchema, await api.teleprompterState(), 'mock teleprompter idle');
    const chapter = (await api.manuscriptChapters())[0];
    await api.teleprompterStart({ chapter: chapter?.id ?? '', device: 'Microphone' });
    await vi.advanceTimersByTimeAsync(120_000);
    await api.teleprompterStop();
    expect(new Set(events.map((event) => (event as { type: string }).type))).toEqual(new Set(['script', 'level', 'partial', 'position', 'flag']));
    for (const event of events) expectMatches(teleprompterEventSchema, event, 'mock teleprompter event');
    for (const state of states) expectMatches(teleprompterStateSchema, state, 'mock teleprompter state');
  });

  it.each(['listening', 'waiting', 'done'] as const)('a teleprompter session the host kept running (%s)', async (seed) => {
    const api = createMockApi({}, { teleprompter: seed });
    const state = await api.teleprompterState();
    expect(state.position?.status).toBe(seed);
    expectMatches(teleprompterStateSchema, state, `mock teleprompter ${seed}`);
  });

  it('a teleprompter session the host kept running with suspected flags raised (flagged)', async () => {
    const api = createMockApi({}, { teleprompter: 'flagged' });
    const events: unknown[] = [];
    api.subscribeTeleprompterEvent((event) => events.push(event));
    const state = await api.teleprompterState();
    expectMatches(teleprompterStateSchema, state, 'mock teleprompter flagged');
    expect(state.position?.status).toBe('listening');
    await vi.waitFor(() => expect(events.length).toBeGreaterThan(0));
    for (const event of events) expectMatches(teleprompterEventSchema, event, 'mock teleprompter seeded flag');
    expect(new Set(events.map((event) => (event as { kind: string }).kind))).toEqual(new Set(['misread', 'skipped', 'restart', 'extra']));
  });

  it('the teleprompter device list', async () => {
    const api = createMockApi();
    expectMatches(teleprompterDevicesResultSchema, await api.teleprompterDevices(), 'mock teleprompter devices');
    const empty = createMockApi({}, { teleprompterDevices: [] });
    expectMatches(teleprompterDevicesResultSchema, await empty.teleprompterDevices(), 'mock teleprompter devices, none found');
  });

  it('teleprompterSeek moves a running session to the requested word, reported as a restart jump', async () => {
    const api = createMockApi();
    const events: unknown[] = [];
    api.subscribeTeleprompterEvent((event) => events.push(event));
    const chapter = (await api.manuscriptChapters())[0];
    await api.teleprompterStart({ chapter: chapter?.id ?? '', device: 'Microphone' });

    await api.teleprompterSeek(3);

    const seek = events.at(-1);
    expectMatches(teleprompterEventSchema, seek, 'mock teleprompter seek event');
    expect(seek).toMatchObject({ type: 'position', read: 3, committed: 3, jump: 'restart' });
  });

  it('the TeleprompterLocate answers, one per status the mock project reaches', async () => {
    const api = createMockApi();
    const chapters = await api.manuscriptChapters();
    const found = await api.teleprompterLocate(chapters[0].id);
    expectMatches(teleprompterLocateResultSchema, found, 'mock teleprompter locate, found');
    expect(found).toMatchObject({ status: 'found', tail: { to: 612.4 } });
    if (found.status === 'asset_required' || !found.located?.sentence) throw new Error('expected a located sentence');
    expect(found.located.sentence.start).toBeLessThanOrEqual(found.located.last ?? -1);
    expect(found.located.sentence.end).toBeGreaterThan(found.located.last ?? Infinity);

    const missing = await api.teleprompterLocate(chapters[1].id);
    expectMatches(teleprompterLocateResultSchema, missing, 'mock teleprompter locate, source missing');
    expect(missing.status).toBe('source_missing');

    const last = chapters[chapters.length - 1].id;
    const noTrack = await api.teleprompterLocate(last);
    expectMatches(teleprompterLocateResultSchema, noTrack, 'mock teleprompter locate, no track');
    expect(noTrack.status).toBe('no_track');

    const picked = await api.teleprompterLocate(last, { trackGuid: '{0E4D1D7F-D039-674D-87E6-719376DE95EC}' });
    expect(picked.status).toBe('found');
    await expect(api.teleprompterLocate(last, { trackGuid: '{00000000-0000-4000-8000-000000000000}' })).rejects.toThrow(/not in the selected/);
    await expect(api.teleprompterLocate('not-a-real-chapter')).rejects.toThrow();
  });

  // `?mockResume=` (main.tsx) reaches every resume card state on the first chapter (teleprompter-manuscript-integration.prd.md
  // Phase 10); each answer is still one the real host could send.
  it.each([
    ['low_confidence', 'low_confidence'],
    ['not_found', 'not_found'],
    ['ambiguous', 'no_track'],
    ['none', 'no_track'],
    ['no_recording', 'no_recording'],
    ['source_missing', 'source_missing'],
    ['source_unsupported', 'source_unsupported'],
  ] as const)('the ?mockResume=%s seed answers TeleprompterLocate with %s', async (resume, status) => {
    const api = createMockApi({}, { resume });
    const chapters = await api.manuscriptChapters();

    const result = await api.teleprompterLocate(chapters[0].id);

    expectMatches(teleprompterLocateResultSchema, result, `mock teleprompter locate, ${resume} seed`);
    expect(result.status).toBe(status);
  });

  it('the ambiguous seed offers the tied tracks, and reads the one the narrator picks', async () => {
    const api = createMockApi({}, { resume: 'ambiguous' });
    const chapters = await api.manuscriptChapters();

    const offered = await api.teleprompterLocate(chapters[0].id);
    if (offered.status === 'asset_required') throw new Error('expected a track match');
    expect(offered.match.status).toBe('ambiguous');
    expect(offered.match.candidates.length).toBeGreaterThan(1);

    const picked = await api.teleprompterLocate(chapters[0].id, { trackGuid: offered.match.candidates[0].trackGuid });
    expectMatches(teleprompterLocateResultSchema, picked, 'mock teleprompter locate, ambiguous seed after a pick');
    expect(picked.status).toBe('found');
  });

  it('the error seed rejects TeleprompterLocate, as a failed read of the .rpp or the sidecar does', async () => {
    const api = createMockApi({}, { resume: 'error' });
    const chapters = await api.manuscriptChapters();

    await expect(api.teleprompterLocate(chapters[0].id)).rejects.toThrow(/could not read/);
  });

  it('TeleprompterLocate asks for the model before transcribing a readable track', async () => {
    const api = createMockApi({}, { assets: 'missing' });
    const chapters = await api.manuscriptChapters();

    const required = await api.teleprompterLocate(chapters[0].id);

    expectMatches(teleprompterLocateResultSchema, required, 'mock teleprompter locate, asset required');
    expect(required.status).toBe('asset_required');
  });

  it('teleprompterSaveFlags answers one suspected finding per flag, and a dismissal is kept', async () => {
    const api = createMockApi();
    const chapter = (await api.manuscriptChapters())[0];
    const paragraph = (await api.manuscriptParagraphs(chapter?.id ?? ''))[0];
    const base = { paragraphId: paragraph?.id ?? '', scriptStart: 0, scriptEnd: 1, dismissed: false };
    const flags = [
      { ...base, kind: 'misread' as const, wordStart: 0, wordEnd: 1, heard: 'hello', dismissed: true },
      { ...base, kind: 'extra' as const, wordStart: 1, wordEnd: 2, heard: 'um' },
      { ...base, kind: 'skipped' as const, wordStart: 2, wordEnd: 3, heard: '' },
      { ...base, kind: 'restart' as const, wordStart: 0, wordEnd: 3, heard: 'the first words' },
    ];
    const saved = await api.teleprompterSaveFlags(chapter?.id ?? '', flags);
    expectMatches(teleprompterFlagFindingsSchema, saved, 'mock teleprompter saved flags');
    expect(saved.map((finding) => finding.review.status)).toEqual(['dismissed', 'unreviewed', 'unreviewed', 'unreviewed']);
    const again = await api.teleprompterSaveFlags(
      chapter?.id ?? '',
      flags.map((flag) => ({ ...flag, dismissed: false })),
    );
    expect(again[0].review.status).toBe('dismissed');
    await expect(
      api.teleprompterSaveFlags(chapter?.id ?? '', [{ ...base, kind: 'misread', paragraphId: 'nope', wordStart: 0, wordEnd: 1, heard: '' }]),
    ).rejects.toThrow(/nope/);
  });

  it('teleprompterSeek rejects when no session is running', async () => {
    const api = createMockApi();

    await expect(api.teleprompterSeek(3)).rejects.toThrow(/no teleprompter session/);
  });

  it('the project-attach event', () => {
    const attached: unknown[] = [];
    const api = createMockApi();
    api.subscribeProjectAttach((state) => attached.push(state));
    void api.switchProject('C:/Projects/Other', 'Other');
    expect(attached).toHaveLength(1);
    expectMatches(projectAttachStateSchema, attached[0], 'mock system:attached');
  });
});

describe('answers of the mock client for the manuscript, Story Bible and project bindings', () => {
  it('the reader, its chapters, paragraphs, notes, search and saved state', async () => {
    const api = createMockApi();
    const chapters = await api.manuscriptChapters();
    expectMatches(chaptersSchema, chapters, 'mock chapters');
    expectMatches(readerSchema, await api.manuscriptReader(), 'mock reader');
    expectMatches(readerStateSchema, await api.readerState(), 'mock reader state');
    expectMatches(paragraphsSchema, await api.manuscriptParagraphs(chapters[0]?.id ?? ''), 'mock paragraphs');
    expectMatches(searchHitsSchema, await api.manuscriptSearch('alice'), 'mock search');
    expectMatches(notesSchema, await api.noteList(), 'mock notes');
    expectMatches(
      readerStateSchema,
      await api.readerStateSave({ activeChapter: chapters[0]?.id, activeSourceLine: 3, expandedChapters: [] }),
      'mock saved state',
    );
    expectMatches(chapterSchema, await api.manuscriptSetChapterStatus(chapters[0]?.id ?? '', 'recording'), 'mock chapter status');
  });

  // daw-chapter-track-auto-sync.prd.md Phases 3, 4 and 6: consent, the first sync and its batch, Undo, chaptersync:state,
  // unsaved edits, the Sync activity and each chapter's status.
  it('chapter sync answers and events', async () => {
    const quiet = await createMockApi().chapterSyncState();
    expectMatches(chapterSyncStateSchema, quiet, 'mock chapter sync, synced before');
    expect(quiet).toMatchObject({ consent: 'on', ask: false, batch: null });

    const api = createMockApi({}, { chapterSync: 'ask' });
    const seen: unknown[] = [];
    api.subscribeChapterSync((state) => seen.push(state));
    const asking = await api.chapterSyncState();
    expectMatches(chapterSyncStateSchema, asking, 'mock chapter sync, asking');
    expect(asking).toMatchObject({ consent: 'undecided', ask: true });
    const preview = await api.chapterSyncPreview();
    expectMatches(chapterSyncPreviewSchema, preview, 'mock chapter sync preview');
    expect(preview.autoLink.length).toBeGreaterThan(0);
    const synced = await api.chapterSyncSetEnabled(true);
    expectMatches(chapterSyncStateSchema, synced, 'mock chapter sync, synced');
    expect(synced.batch?.linked.map((link) => link.trackGuid)).toEqual(preview.autoLink.map((link) => link.trackGuid));
    const undone = await api.chapterSyncUndo(preview.autoLink[0].trackGuid);
    expectMatches(chapterSyncStateSchema, undone, 'mock chapter sync, undone');
    expect((await api.chapterSyncPreview()).autoLink.map((link) => link.trackGuid)).not.toContain(preview.autoLink[0].trackGuid);
    expect(synced.activity[0]).toEqual(synced.batch);
    for (const state of seen) expectMatches(chapterSyncStateSchema, state, 'mock chaptersync:state');
    expect(seen.length).toBeGreaterThanOrEqual(2);

    // Phase 4: REAPER holds unsaved edits, and the Sync activity keeps a row from a save in REAPER.
    const unsaved = await createMockApi({}, { chapterSync: 'unsaved' }).chapterSyncState();
    expectMatches(chapterSyncStateSchema, unsaved, 'mock chapter sync, unsaved edits');
    expect(unsaved).toMatchObject({ consent: 'on', unsavedEdits: true, batch: null });
    expect(unsaved.activity.map((row) => row.trigger)).toEqual(['watch']);

    // Phase 6: a status row per narration chapter, the recording check's own answer, with no Check press.
    expect(quiet.chapters.length).toBeGreaterThan(0);
    const staleApi = createMockApi({}, { coverage: { stale: [quiet.chapters[0].chapterId] } });
    const staleState = await staleApi.chapterSyncState();
    expectMatches(chapterSyncStateSchema, staleState, 'mock chapter sync, a stale row');
    expect(staleState.chapters[0]).toMatchObject({ freshness: 'stale', reasons: ['item_trimmed'] });

    // Phase 8: a chapter's pickup track, changed since its last scan.
    const pickups = await createMockApi({}, { chapterSync: 'pickups' }).chapterSyncState();
    expectMatches(chapterSyncStateSchema, pickups, 'mock chapter sync, pickups changed');
    expect(pickups.chapters.filter((row) => row.pickupsChanged)).toHaveLength(1);
  });

  // chapter-track-link-control.prd.md Phase 3: Remove from recording clears the chapter's links, and Restore brings it back.
  it('a chapter removed from recording and restored', async () => {
    const api = createMockApi();
    const [first] = await api.manuscriptChapters();
    const tracks = await api.chapterTrackLinks();
    const guid = tracks.tracks[0]?.guid ?? '';
    await api.chapterTrackSet(first.id, guid);
    const removed = await api.manuscriptSetChapterKind(first.id, 'reference');
    expectMatches(chapterKindResultSchema, removed, 'mock chapter removed');
    expect(removed).toMatchObject({ previousKind: 'narration', chapter: { contentKind: 'reference', removedFromRecording: true } });
    expect(removed.clearedLinks.map((link) => link.trackGuid)).toEqual([guid]);
    const restored = await api.manuscriptSetChapterKind(first.id, 'narration');
    expectMatches(chapterKindResultSchema, restored, 'mock chapter restored');
    expect(restored.chapter.removedFromRecording).toBeUndefined();
    expect(restored.clearedLinks).toEqual([]);
    await expect(api.manuscriptSetChapterKind('no-such-chapter', 'reference')).rejects.toThrow('unknown manuscript chapter');
  });

  it('a created note and bookmark', async () => {
    const api = createMockApi();
    const chapter = (await api.manuscriptChapters())[0];
    const paragraph = (await api.manuscriptParagraphs(chapter?.id ?? ''))[0];
    expectMatches(noteSchema, await api.noteCreate(chapter?.id ?? '', paragraph?.id ?? '', 'A note', 0, 4, 'Alic'), 'mock note');
    expectMatches(
      bookmarkSchema,
      await api.readerBookmarkCreate({
        kind: 'line',
        chapter: chapter?.title ?? '',
        chapterId: chapter?.id,
        paragraphId: paragraph?.id,
        paragraph: paragraph?.index,
      }),
      'mock bookmark',
    );
  });

  it('the manuscript import jobs from file selection to a committed import', async () => {
    const api = createMockApi();
    const selection = await api.selectManuscript();
    expectMatches(fileSelectionSchema, selection, 'mock file selection');
    const jobId = selection.jobId ?? '';
    expectMatches(workJobSchema, await api.manuscriptImportState(jobId), 'mock import state');
    expectMatches(workJobSchema, await api.manuscriptImportPreview(jobId, { markdownHeadingLevel: 1 }), 'mock import preview');
    expectMatches(workJobSchema, await api.manuscriptImportCommit(jobId, { confirmedReset: true }), 'mock import commit');
  });

  it.each(['docx', 'markdown', 'repaired', 'text'] as const)(
    'the %s import preview the review dialog is built on, sections of every kind and character suggestions',
    async (kind) => {
      const api = createMockApi({}, { importPreview: kind });
      const jobId = (await api.selectManuscript()).jobId ?? '';
      const job = await api.manuscriptImportPreview(jobId, { markdownHeadingLevel: 1 });
      expectMatches(workJobSchema, job, `mock ${kind} import preview`);
      expect(job.preview?.format).toBe({ docx: 'docx', markdown: 'markdown', repaired: 'docx', text: 'txt' }[kind]);
      // Every subtitle says where its line goes when it is turned off, as the host's does (a plain-text line returns to the text).
      const subtitled = job.preview?.sections?.filter((section) => section.subtitle) ?? [];
      expect(subtitled.length).toBeGreaterThan(0);
      for (const section of subtitled) expect(section.subtitleOff).toBe(kind === 'text' ? 'body' : 'title');
      expect(job.preview?.notices !== undefined).toBe(kind === 'repaired');
      expect(new Set(job.preview?.sections?.map((section) => section.contentKind))).toEqual(new Set(['narration', 'opening', 'reference']));
      expect(job.preview?.characterCandidates).toHaveLength(3);
      expectMatches(
        workJobSchema,
        await api.manuscriptImportCommit(jobId, { confirmedReset: false, selection: { subtitleOverrides: { [subtitled[0]?.id ?? '']: false } } }),
        `mock ${kind} import commit`,
      );
    },
  );

  it('the Story Bible entities, build job, created id and preview answers', async () => {
    const api = createMockApi();
    expectMatches(guideEntitiesSchema, await api.guideEntities(), 'mock entities');
    expectMatches(workJobSchema, await api.guideBuildState(), 'mock guide state');
    expectMatches(guideBuildResultSchema, await api.guideBuild(), 'mock guide build');
    expectMatches(guideBuildResultSchema, await api.guideBuild({ rulesOnly: true }), 'mock guide build, rules-only');
    expectMatches(guideBuildResultSchema, await createMockApi({}, { assets: 'downloading' }).guideBuild(), 'mock guide build, asking for the language model');
    expectMatches(guideCreatedSchema, { id: await api.guideCreate('New', 'Character', []) }, 'mock guide create');
    const entity = (await api.guideEntities())[0];
    expectMatches(guidePreviewSchema, await api.guidePreview(entity?.id ?? ''), 'mock preview');
  });

  it('the dictionary lookup answers: a word it has, one it does not, and the first-use gate', async () => {
    const api = createMockApi();
    const found = await api.systemLookup('“Curious,”');
    expectMatches(dictionaryLookupResultSchema, found, 'mock lookup');
    expect(found.status === 'ok' && found.query === 'curious' && found.entries.length).toBe(1);
    expectMatches(dictionaryLookupResultSchema, await api.systemLookup('zorblax'), 'mock lookup of a word it does not have');
    expectMatches(
      dictionaryLookupResultSchema,
      await createMockApi({}, { dictionary: 'missing' }).systemLookup('curious'),
      'mock lookup, asking for the dictionary',
    );
    await expect(api.systemLookup('two words')).rejects.toThrow(/single word/);
  });

  it('copy diagnostics answers the saved path', async () => {
    const api = createMockApi();
    expectMatches(copyDiagnosticsResultSchema, await api.systemCopyDiagnostics('last_run'), 'mock copy diagnostics');
  });

  it('the project picker answers', async () => {
    const api = createMockApi({}, { projectFolder: '' });
    expectMatches(recentProjectsSchema, await api.projectRecents(), 'mock recents');
    expectMatches(recentProjectsSchema, await api.removeRecentProject('C:/Projects/Voltage-and-the-Undercroft'), 'mock recents after remove');
    expectMatches(projectFolderSelectionSchema, await api.selectProjectFolder(), 'mock folder selection');
    expectMatches(projectSwitchResultSchema, await api.switchProject('C:/Projects/Other', 'Other'), 'mock switch');
    expectMatches(projectSwitchResultSchema, await api.createProject('C:/Projects/New', 'New'), 'mock create');
  });

  it('the DAW link binding answers, linked and refused on a folder mismatch', async () => {
    expectMatches(dawLinkResultSchema, await createMockApi().linkDawFile(), 'mock link');
    expectMatches(dawLinkResultSchema, await createMockApi({}, { dawLinkMismatch: true }).linkDawFile(), 'mock link, folder mismatch');
  });

  it('the DAW launch binding answers (Phase 8)', async () => {
    expectMatches(dawLaunchResultSchema, await createMockApi().launchDaw(), 'mock launch');
  });

  it('the credits template library, project values and preview answers (audiobook-credits-templates.prd.md, Phase 1)', async () => {
    const api = createMockApi();
    const templates = await api.creditsTemplates();
    expectMatches(creditTemplatesSchema, templates, 'mock credit templates');
    expect(templates.length).toBeGreaterThan(0);
    const created = await api.saveCreditsTemplate('', 'opening', 'My opening', '[Title], by [Author].');
    expectMatches(creditTemplateSchema, created, 'mock saved credit template');
    const updated = await api.saveCreditsTemplate(created.id, 'opening', 'My opening (edited)', '[Title].');
    expect(updated.id).toBe(created.id);
    const duplicated = await api.duplicateCreditsTemplate(templates[0].id);
    expectMatches(creditTemplateSchema, duplicated, 'mock duplicated credit template');
    expect(duplicated.id).not.toBe(templates[0].id);
    await api.deleteCreditsTemplate(created.id);
    expect((await api.creditsTemplates()).some((template) => template.id === created.id)).toBe(false);

    const values = await api.creditsProjectValues();
    expectMatches(creditsProjectValuesResultSchema, values, 'mock credits project values');
    const saved = await api.saveCreditsProjectValues({ title: 'Neon', author: 'A. Writer' });
    expectMatches(creditsProjectValuesResultSchema.shape.values, saved, 'mock saved credits project values');
    const preview = await api.creditsPreview('[Title], written by [Author], narrated by [Narrator].');
    expectMatches(creditsRenderResultSchema, preview, 'mock credits preview');
    expect(preview.text).toBe('Neon, written by A. Writer, narrated by [Narrator].');
    expect(preview.unresolved).toEqual(['Narrator']);
  });

  // credits-token-setup-and-front-matter-detection.prd.md Phase 2: the prompt asks, "Not now", and a save that only fills.
  it('the credits setup prompt answers', async () => {
    const quiet = await createMockApi().creditsSetupState();
    expectMatches(creditsSetupStateSchema, quiet, 'mock credits setup, answered before');
    expect(quiet).toMatchObject({ needed: false, banner: false, dismissed: 'project' });

    const api = createMockApi({}, { creditsSetup: true });
    const asked = await api.creditsSetupState();
    expectMatches(creditsSetupStateSchema, asked, 'mock credits setup, asking');
    expect(asked.needed).toBe(true);
    expect(asked.fields.map((field) => field.token)).toEqual(['Title', 'Author', 'Narrator']);
    expect(asked.fields[0].candidate?.value).toBe('Alice’s Adventures in Wonderland');
    const notNow = await api.creditsSetupDismiss('session');
    expectMatches(creditsSetupStateSchema, notNow, 'mock credits setup, not now');
    expect(notNow).toMatchObject({ needed: false, banner: true, dismissed: 'session' });
    await api.saveCreditsProjectValues({ title: 'My Own Title' });
    const saved = await api.creditsSetupSave({ title: 'Alice', author: 'Lewis Carroll', narrator: 'Ada Finch' });
    expectMatches(creditsSetupStateSchema, saved, 'mock credits setup, saved');
    expect(saved).toMatchObject({ needed: false, banner: false, fields: [] });
    expect((await api.creditsProjectValues()).values.title).toBe('My Own Title');
  });

  it('the chapter announcements and retail sample answers (audiobook-credits-templates.prd.md, Phase 5)', async () => {
    const api = createMockApi();
    const announcements = await api.creditsChapterAnnouncements('[Chapter]{: [Chapter Title]}.');
    expectMatches(creditsAnnouncementsSchema, announcements, 'mock chapter announcements');
    expect(announcements[0].result.text).toBe('Chapter 1: Down the Rabbit-Hole.');

    expectMatches(retailSampleAnswerSchema, await api.creditsRetailSample(), 'mock retail sample, none');
    const chapter = (await api.manuscriptChapters())[1];
    const [first, , third] = chapter.paragraphIds ?? [];
    const saved = await api.saveCreditsRetailSample(first.id, third.id);
    expectMatches(retailSampleAnswerSchema, saved, 'mock saved retail sample');
    expect(saved.sample).toMatchObject({ startChapterId: chapter.id, startLine: 1, endLine: 3 });
    expect(await api.creditsRetailSample()).toEqual(saved);
    await expect(api.saveCreditsRetailSample(first.id, 'p-9999')).rejects.toThrow(/pick the range again/);
    expectMatches(retailSampleAnswerSchema, await api.saveCreditsRetailSample('', ''), 'mock cleared retail sample');
  });

  it('the credits row statuses (credits-in-chapter-table.prd.md, Phase 1)', async () => {
    const api = createMockApi();
    expectMatches(creditsStatusesSchema, await api.creditsStatuses(), 'mock credits statuses, empty');
    expect(await api.creditsStatuses()).toEqual({});

    const afterOpening = await api.setCreditsStatus('opening', 'finalized');
    expectMatches(creditsStatusesSchema, afterOpening, 'mock credits statuses, opening set');
    expect(afterOpening).toEqual({ opening: 'finalized' });

    const afterClosing = await api.setCreditsStatus('closing', 'recording');
    expectMatches(creditsStatusesSchema, afterClosing, 'mock credits statuses, both set');
    expect(afterClosing).toEqual({ opening: 'finalized', closing: 'recording' });
    expect(await api.creditsStatuses()).toEqual(afterClosing);
  });

  it('the DAW catalog list and open-download-page answers, detected and not detected (Phase 2)', async () => {
    const detected = await createMockApi().dawCatalogList();
    expectMatches(dawCatalogListSchema, detected, 'mock catalog, detected');
    expect(detected[0]?.installed).toBe(true);
    const notDetected = await createMockApi({}, { dawCatalogInstalled: false }).dawCatalogList();
    expectMatches(dawCatalogListSchema, notDetected, 'mock catalog, not detected');
    expect(notDetected[0]?.installed).toBe(false);
    expect(notDetected[0]?.path).toBeUndefined();
    await expect(createMockApi().dawCatalogOpenDownloadPage('reaper')).resolves.toBeUndefined();
    await expect(createMockApi().dawCatalogOpenDownloadPage('not-a-real-daw')).rejects.toThrow(/Unknown DAW catalog entry/);
  });
});

describe('answers of the mock client for the settings, voice, model, transcript and tracks bindings', () => {
  it('the Settings fields of both scopes, and a saved setting', async () => {
    const api = createMockApi();
    expectMatches(settingsForScopeSchema, await api.settingsForScope('global'), 'mock global settings');
    expectMatches(settingsForScopeSchema, await api.settingsForScope('project'), 'mock project settings');
    expectMatches(bootstrapSchema, await api.saveSettings('General', 'global', { log_verbosity: 'verbose' }), 'mock saved settings');
  });

  it('the voice and model catalogs and their install jobs', async () => {
    const api = createMockApi();
    expectMatches(ttsCatalogSchema, await api.ttsCatalog(), 'mock voice catalog');
    const voice = (await api.ttsCatalog()).voices[0]?.id ?? '';
    const started = await api.ttsInstall(voice);
    for (const job of [
      started,
      await api.ttsInstallState(started.id),
      await api.ttsInstallState(started.id),
      await api.ttsInstallState(started.id),
      await api.ttsInstallCancel(started.id),
    ]) {
      expectMatches(ttsInstallJobSchema, job, 'mock voice install job');
    }
    expectMatches(whisperCatalogSchema, await api.whisperCatalog(), 'mock model catalog');
    const model = (await api.whisperCatalog()).models[0]?.id ?? '';
    const running = await api.whisperInstall(model);
    for (const job of [
      running,
      await api.whisperInstallState(running.id),
      await api.whisperInstallState(running.id),
      await api.whisperInstallState(running.id),
    ]) {
      expectMatches(whisperInstallJobSchema, job, 'mock model install job');
    }
  });

  it('the list of every approved asset, its install job and a verify', async () => {
    const api = createMockApi();
    const catalog = await api.assetsList();
    expectMatches(assetCatalogSchema, catalog, 'mock asset list');
    expect(catalog.assets.map((asset) => asset.kind)).toEqual(['tts', 'whisper', 'spacy', 'dictionary']);
    const voice = catalog.assets[0];
    const started = await api.assetsInstall(voice.kind, voice.id);
    for (const job of [started, await api.assetsInstallState(started.id), await api.assetsInstallState(started.id), await api.assetsInstallState(started.id)]) {
      expectMatches(assetInstallJobSchema, job, 'mock asset install job');
    }
    expect((await api.assetsList()).assets[0].installState).toBe('installed');
    expectMatches(assetInstallJobSchema, await api.assetsInstallCancel(started.id), 'mock asset install cancel');
    expectMatches(assetVerifyResultSchema, await api.assetsVerify(voice.kind, voice.id), 'mock asset verify');
    await api.assetsRemove(voice.kind, voice.id);
    expect((await api.assetsList()).assets[0].installState).toBe('not_installed');
    await expect(api.assetsInstall('moonshine', 'x')).rejects.toThrow(/not in the approved catalog/);
  });

  it('the first-use gates for a model that is not installed, and a start that goes ahead', async () => {
    const api = createMockApi();
    const model = (await api.whisperCatalog()).models[0]?.id ?? '';
    expectMatches(startResultSchema, await api.transcriptStart({ model, chunk: '60', workers: '1', hints: '' }), 'mock transcript start');
    await api.whisperRemove(model);
    const gate = await api.transcriptStart({ model, chunk: '60', workers: '1', hints: '' });
    expect(gate.status).toBe('asset_required');
    expectMatches(startResultSchema, gate, 'mock transcript first-use gate');
    const chapter = (await api.manuscriptChapters())[0]?.id ?? '';
    expectMatches(teleprompterStartResultSchema, await api.teleprompterStart({ chapter, device: 'Microphone' }), 'mock teleprompter start');
  });

  it.each(['whisper', 'moonshine'] as const)('the teleprompter first-use gate names the engine whose model is missing (%s)', async (engine) => {
    const api = createMockApi({}, { assets: 'missing' });
    const chapter = (await api.manuscriptChapters())[0]?.id ?? '';
    const gate = await api.teleprompterStart({ chapter, device: 'Microphone', engine });
    expectMatches(teleprompterStartResultSchema, gate, `mock teleprompter first-use gate (${engine})`);
    expect(gate.status === 'asset_required' && gate.engine).toBe(engine);
  });

  it('the last completed run, the hints and the equivalence answer', async () => {
    const api = createMockApi();
    expectMatches(lastCompletedSchema, (await api.transcriptLastCompleted()) ?? null, 'mock last completed run');
    expectMatches(hintSuggestionsSchema, await api.transcriptSuggestHints(), 'mock hint suggestions');
    expectMatches(hintsSchema, await api.transcriptHints(), 'mock hints');
    expectMatches(equivalenceSchema, { message: await api.transcriptAddEquivalence('row-1') }, 'mock equivalence');
  });

  it.each(['available', 'found', 'failed', 'current', 'development', undefined] as const)('the update status the mock host answers (%s)', async (seed) => {
    const api = createMockApi({}, seed ? { update: seed } : {});
    expectMatches(updateStatusSchema, await api.updateStatus(), 'mock update status');
    expectMatches(updateStatusSchema, await api.updateCheck(), 'mock update check');
  });

  it.each(['downloading', 'available', 'download-fails'] as const)('the update download the mock host reports (%s)', async (seed) => {
    vi.useFakeTimers();
    const api = createMockApi({}, { update: seed });
    const started = await api.updateDownload();
    expectMatches(updateJobSchema, started, 'mock update download');
    for (let step = 0; step < 12; step++) {
      await vi.advanceTimersByTimeAsync(300);
      expectMatches(updateJobSchema, await api.updateJobState(started.id), 'mock update job');
    }
    expectMatches(updateJobSchema, await api.updateJobCancel(started.id), 'mock update job cancelled');
  });

  it('the update event the mock host sends when a background check found a release', async () => {
    vi.useFakeTimers();
    const seen: unknown[] = [];
    createMockApi({}, { update: 'found' }).subscribeUpdate((status) => seen.push(status));
    await vi.advanceTimersByTimeAsync(10);
    expect(seen).toHaveLength(1);
    expectMatches(updateStatusSchema, seen[0], 'mock update:status');
  });

  it('the Tracks answers', async () => {
    const api = createMockApi();
    expectMatches(tracksDiscoverySchema, await api.tracksDiscover(), 'mock tracks discovery');
    expectMatches(tracksProjectSchema, await api.tracksList(), 'mock tracks project');
    const several = createMockApi({}, { tracksCandidates: ['C:/A/A.rpp', 'C:/A/B.rpp'] });
    expectMatches(tracksDiscoverySchema, await several.tracksSelect('C:/A/B.rpp'), 'mock tracks selection');
    expectMatches(tracksDiscoverySchema, await createMockApi({}, { tracksCandidates: [] }).tracksDiscover(), 'mock tracks discovery, none found');
  });

  it('the ChapterTrackMap answers', async () => {
    const api = createMockApi();
    const empty = await api.chapterTrackMapList();
    expectMatches(chapterTrackMappingSchema, empty, 'mock chapter-track map, none confirmed');
    expect(empty.mappings).toHaveLength(0);

    const chapters = await api.manuscriptChapters();
    const confirmed = await api.chapterTrackMapConfirm('{0E4D1D7F-D039-674D-87E6-719376DE95EC}', chapters[0].id);
    expectMatches(trackMappingSchema, confirmed, 'mock chapter-track map confirmation');
    expect(confirmed.chapterTitle).toBe(chapters[0].title);

    const listed = await api.chapterTrackMapList();
    expectMatches(chapterTrackMappingSchema, listed, 'mock chapter-track map, one confirmed');
    expect(listed.mappings).toHaveLength(1);

    const cleared = await api.chapterTrackMapClear(confirmed.trackGuid);
    expectMatches(chapterTrackMappingSchema, cleared, 'mock chapter-track map after clear');
    expect(cleared.mappings).toHaveLength(0);

    await expect(api.chapterTrackMapConfirm('{0E4D1D7F-D039-674D-87E6-719376DE95EC}', 'not-a-real-chapter')).rejects.toThrow();
  });

  it('the ChapterTrackSet, ChapterTrackUnlink and ChapterTrackLinks answers', async () => {
    const api = createMockApi();
    const chapters = await api.manuscriptChapters();
    const ready = await api.chapterTrackLinks();
    expectMatches(chapterTrackLinksSchema, ready, 'mock chapter track links, ready');
    expect(ready.project).toBe('ready');
    expect(ready.tracks.length).toBeGreaterThan(0);

    const [first, second] = WIRE_TRACKS_PROJECT.tracks;
    await api.chapterTrackSet(chapters[0].id, first.guid);
    const moved = await api.chapterTrackSet(chapters[1].id, first.guid);
    expectMatches(chapterTrackSetSchema, moved, 'mock chapter track set, displacing a link');
    expect(moved.displaced?.chapterId).toBe(chapters[0].id);
    const relinked = await api.chapterTrackSet(chapters[1].id, second.guid);
    expect(relinked.displaced).toBeNull();
    expect(relinked.mappings.filter((mapping) => mapping.chapterId === chapters[1].id)).toHaveLength(1);

    const unlinked = await api.chapterTrackUnlink(chapters[1].id);
    expectMatches(chapterTrackMappingSchema, unlinked, 'mock chapter track unlink');
    expect(unlinked.mappings).toHaveLength(0);
    await expect(api.chapterTrackSet('not-a-real-chapter', first.guid)).rejects.toThrow();

    const noProject = await createMockApi({}, { tracksCandidates: [] }).chapterTrackLinks();
    expectMatches(chapterTrackLinksSchema, noProject, 'mock chapter track links, no project');
    expect(noProject.project).toBe('none');
    expect(noProject.tracks).toHaveLength(0);
  });

  it('the ChapterRegionsPreview and ChapterRegionsCreate answers', async () => {
    const api = createMockApi();
    const chapters = await api.manuscriptChapters();
    const [first] = WIRE_TRACKS_PROJECT.tracks;
    await api.chapterTrackSet(chapters[0].id, first.guid);
    const plan = await api.chapterRegionsPreview(first.guid, first.guid);
    expectMatches(chapterRegionPlanSchema, plan, 'mock chapter regions preview');
    expect(plan.rows.map((row) => row.kind)).toEqual(['opening', 'chapter', 'closing']);
    expect(plan.skipped.length).toBeGreaterThan(0);
    const created = await api.chapterRegionsCreate(first.guid, '', false);
    expectMatches(chapterRegionsCreatedSchema, created, 'mock chapter regions created');
    expect(created.sent).toBe(2);

    const noProject = createMockApi({}, { tracksCandidates: [] });
    expectMatches(chapterRegionPlanSchema, await noProject.chapterRegionsPreview('', ''), 'mock chapter regions, no project');
    await expect(noProject.chapterRegionsCreate('', '', false)).rejects.toThrow();
  });

  it('the chapter list carries recorded seconds only for a chapter with a linked track', async () => {
    const api = createMockApi();
    const chapters = await api.manuscriptChapters();
    expectMatches(chaptersSchema, chapters, 'mock chapters, nothing linked');
    expect(chapters.every((chapter) => chapter.recordedUnavailable === 'unlinked' && chapter.recordedSeconds === undefined)).toBe(true);

    const [first] = WIRE_TRACKS_PROJECT.tracks;
    await api.chapterTrackSet(chapters[0].id, first.guid);
    const linked = await api.manuscriptChapters();
    expectMatches(chaptersSchema, linked, 'mock chapters, one linked');
    expect(linked[0].recordedSeconds).toBeGreaterThan(0);
    expect(linked[0].recordedUnavailable).toBeUndefined();
  });

  it('the ChapterTrackMatch answers', async () => {
    const api = createMockApi();
    const chapters = await api.manuscriptChapters();
    const matched = await api.chapterTrackMatch(chapters[0].id);
    expectMatches(chapterTrackMatchSchema, matched, 'mock chapter-track match, matched by name');
    expect(matched.status).toBe('matched');
    expect(matched.recordedEnd).not.toBeNull();

    const last = chapters[chapters.length - 1].id;
    const unmatched = await api.chapterTrackMatch(last);
    expectMatches(chapterTrackMatchSchema, unmatched, 'mock chapter-track match, no track');
    expect(unmatched.status).toBe('none');
    expect(unmatched.track).toBeNull();

    await api.chapterTrackMapConfirm('{DA2D209F-D10F-5E46-93E7-098D96499ED0}', last);
    const confirmed = await api.chapterTrackMatch(last);
    expectMatches(chapterTrackMatchSchema, confirmed, 'mock chapter-track match, confirmed');
    expect(confirmed.status).toBe('confirmed');

    await expect(api.chapterTrackMatch('not-a-real-chapter')).rejects.toThrow();
  });

  it('the ChapterSuggestion answers', async () => {
    const none = await createMockApi().chapterSuggestion();
    expectMatches(chapterSuggestionSchema, none, 'mock chapter suggestion, nothing armed');
    expect(none.basis).toBe('none');

    const [chapter1, chapter2] = WIRE_TRACKS_PROJECT.tracks;
    const matched = await createMockApi({}, { armedTracks: [chapter2.guid] }).chapterSuggestion();
    expectMatches(chapterSuggestionSchema, matched, 'mock chapter suggestion, armed track matched');
    expect(matched.status).toBe('matched');
    expect(matched.chapter?.chapterTitle).toBe('Chapter 2');

    const ambiguous = await createMockApi({}, { armedTracks: [chapter1.guid, chapter2.guid] }).chapterSuggestion();
    expectMatches(chapterSuggestionSchema, ambiguous, 'mock chapter suggestion, two armed tracks');
    expect(ambiguous.status).toBe('ambiguous');
    expect(ambiguous.chapter).toBeNull();

    const linkedApi = createMockApi({}, { armedTracks: [chapter2.guid] });
    const chapters = await linkedApi.manuscriptChapters();
    await linkedApi.chapterTrackMapConfirm(chapter2.guid, chapters[4].id);
    const confirmed = await linkedApi.chapterSuggestion();
    expectMatches(chapterSuggestionSchema, confirmed, 'mock chapter suggestion, confirmed link');
    expect(confirmed.status).toBe('confirmed');
    expect(confirmed.chapter?.chapterId).toBe(chapters[4].id);
  });

  it('the ChaptersForTracks answers', async () => {
    const api = createMockApi();
    const [track1] = WIRE_TRACKS_PROJECT.tracks;
    const [item1] = track1.items;
    const result = await api.chaptersForTracks([track1.guid, item1.guid, item1.takeGuid, 'not-a-real-guid']);
    expectMatches(chaptersForTracksSchema, result, 'mock chapters for tracks');

    expect(result.tracks[track1.guid].status).toBe('matched');
    expect(result.tracks[track1.guid].chapter?.chapterTitle).toBe('Chapter 1');
    // The item and its active take resolve through the same track as the track GUID itself.
    expect(result.tracks[item1.guid]).toEqual(result.tracks[track1.guid]);
    expect(result.tracks[item1.takeGuid]).toEqual(result.tracks[track1.guid]);

    expect(result.tracks['not-a-real-guid'].status).toBe('');
    expect(result.tracks['not-a-real-guid'].error).toBeTruthy();
  });

  it('the line-identity state through a stamp and a read run, and its seeded states', async () => {
    vi.useFakeTimers();
    const api = createMockApi();
    const seen: unknown[] = [];
    api.subscribeLineIdentity((state) => seen.push(structuredClone(state)));
    expectMatches(
      lineIdentityStartResultSchema,
      await api.lineIdentityStamp([{ itemGuid: '{A}', lineId: 'c-0001', text: 'Chapter One' }], false),
      'mock stamp start',
    );
    await vi.advanceTimersByTimeAsync(300);
    expectMatches(lineIdentityStartResultSchema, await api.lineIdentityRead(), 'mock read start');
    await vi.advanceTimersByTimeAsync(300);
    expect(seen.length).toBeGreaterThan(3);
    for (const state of seen) expectMatches(lineIdentityStateSchema, state, 'mock lineidentity:state');
    expectMatches(lineIdentityStateSchema, await api.lineIdentityState(), 'mock line-identity state');
    for (const seed of ['success', 'conflict', 'error'] as const) {
      expectMatches(lineIdentityStateSchema, await createMockApi({}, { lineIdentity: seed }).lineIdentityState(), `mock line-identity seed ${seed}`);
    }
  });

  it('lineIdentityStamp refuses an empty row list, the way the Go service does', async () => {
    await expect(createMockApi().lineIdentityStamp([], false)).rejects.toThrow(/select at least one item/);
  });

  it('the pickups state through import, export, next, resolve and count, and its seeded states', async () => {
    vi.useFakeTimers();
    const api = createMockApi();
    const seen: unknown[] = [];
    api.subscribePickups((state) => seen.push(structuredClone(state)));
    const imported = await api.pickupsImport('start,note,tag\n1.5,Mispronounced,narrator\n9.25,Second pickup,\n');
    expectMatches(pickupsImportResultSchema, imported, 'mock import start');
    expect(imported.rowErrors).toEqual([]);
    await vi.advanceTimersByTimeAsync(300);
    expectMatches(pickupsStartResultSchema, await api.pickupsNext(), 'mock next start');
    await vi.advanceTimersByTimeAsync(300);
    expectMatches(pickupsStartResultSchema, await api.pickupsResolve(1.5), 'mock resolve start');
    await vi.advanceTimersByTimeAsync(300);
    expectMatches(pickupsStartResultSchema, await api.pickupsExport(), 'mock export start');
    await vi.advanceTimersByTimeAsync(300);
    expectMatches(pickupsStartResultSchema, await api.pickupsCount(), 'mock count start');
    await vi.advanceTimersByTimeAsync(300);
    expect(seen.length).toBeGreaterThan(5);
    for (const state of seen) expectMatches(pickupsStateSchema, state, 'mock pickups:state');
    expectMatches(pickupsStateSchema, await api.pickupsState(), 'mock pickups state');
    for (const seed of ['import-success', 'next-success', 'export-success', 'error'] as const) {
      expectMatches(pickupsStateSchema, await createMockApi({}, { pickups: seed }).pickupsState(), `mock pickups seed ${seed}`);
    }
  });

  it('pickupsImport reports every unusable row and throws when none are usable', async () => {
    const api = createMockApi();
    await expect(api.pickupsImport('not-a-number,First\n')).rejects.toThrow(/no valid pickups/);
    const result = await api.pickupsImport('1.5,Good row\nnot-a-number,Bad row\n');
    expect(result.rowErrors).toEqual(['line 2: could not parse this row']);
  });

  it('the render-config state through a configure run, and its seeded states', async () => {
    vi.useFakeTimers();
    const api = createMockApi();
    const seen: unknown[] = [];
    api.subscribeRenderConfig((state) => seen.push(structuredClone(state)));
    expectMatches(renderConfigSuggestedFolderSchema, await api.renderConfigSuggestFolder(), 'mock suggested folder');
    expectMatches(renderConfigStartResultSchema, await api.renderConfigConfigure('C:/Books/Alice/renders'), 'mock configure start');
    await vi.advanceTimersByTimeAsync(300);
    expect(seen.length).toBeGreaterThan(1);
    for (const state of seen) expectMatches(renderConfigStateSchema, state, 'mock renderconfig:state');
    expectMatches(renderConfigStateSchema, await api.renderConfigState(), 'mock render-config state');
    for (const seed of ['success', 'no-regions', 'error'] as const) {
      expectMatches(renderConfigStateSchema, await createMockApi({}, { renderConfig: seed }).renderConfigState(), `mock render-config seed ${seed}`);
    }
  });

  it('renderConfigConfigure refuses an empty folder, the way the Go service does', async () => {
    await expect(createMockApi().renderConfigConfigure('   ')).rejects.toThrow(/output folder is required/);
  });

  it('the cleanup-tools state through a launch, and its seeded states', async () => {
    vi.useFakeTimers();
    const api = createMockApi();
    const seen: unknown[] = [];
    api.subscribeCleanupTools((state) => seen.push(structuredClone(state)));
    expectMatches(cleanupToolsStartResultSchema, await api.cleanupToolsLaunch('repair_pops_clicks'), 'mock cleanup launch start');
    await vi.advanceTimersByTimeAsync(300);
    expect(seen.length).toBeGreaterThan(2);
    for (const state of seen) expectMatches(cleanupToolsStateSchema, state, 'mock cleanuptools:state');
    expectMatches(cleanupToolsStateSchema, await api.cleanupToolsState(), 'mock cleanup-tools state');
    for (const seed of ['launched', 'error'] as const) {
      expectMatches(cleanupToolsStateSchema, await createMockApi({}, { cleanupTools: seed }).cleanupToolsState(), `mock cleanup-tools seed ${seed}`);
    }
  });

  it('the retake-lane list and state through a pick, and their seeded states', async () => {
    vi.useFakeTimers();
    const api = createMockApi();
    const seen: unknown[] = [];
    api.subscribeRetakeLanes((state) => seen.push(structuredClone(state)));
    const list = await api.retakeLanesList();
    expectMatches(retakeLanesListSchema, list, 'mock retake-lanes list');
    const [line] = list.lines;
    expectMatches(retakeLanesStartResultSchema, await api.retakeLanesPick(line.lineId, line.retakes[1].itemGuid), 'mock retake-lane pick start');
    await vi.advanceTimersByTimeAsync(300);
    expect(seen.length).toBeGreaterThan(2);
    for (const state of seen) expectMatches(retakeLanesStateSchema, state, 'mock retakelanes:state');
    expectMatches(retakeLanesStateSchema, await api.retakeLanesState(), 'mock retake-lanes state');
    for (const seed of ['picked', 'error', 'none'] as const) {
      const seeded = createMockApi({}, { retakeLanes: seed });
      expectMatches(retakeLanesStateSchema, await seeded.retakeLanesState(), `mock retake-lanes seed ${seed}`);
      expectMatches(retakeLanesListSchema, await seeded.retakeLanesList(), `mock retake-lanes list seed ${seed}`);
    }
  });

  it('retakeLanesPick refuses a retake the list does not hold, the way the Go service does', async () => {
    const api = createMockApi();
    const [line] = (await api.retakeLanesList()).lines;
    await expect(api.retakeLanesPick('line-000099', line.retakes[0].itemGuid)).rejects.toThrow(/not on a fixed-lane track/);
  });

  it('the project-state check against the last comparison baseline (follow-through Phase 13)', async () => {
    vi.useFakeTimers();
    try {
      const api = createMockApi();
      const seen: ProjectStateState[] = [];
      api.subscribeProjectState((state) => seen.push(structuredClone(state)));
      expectMatches(projectStateStartResultSchema, await api.projectStateCheck(), 'mock project-state check start');
      await vi.advanceTimersByTimeAsync(200);
      for (const state of seen) expectMatches(projectStateStateSchema, state, 'mock projectstate:state');
      const checked = await api.projectStateState();
      expectMatches(projectStateStateSchema, checked, 'mock project-state state');
      const baseline = (await api.transcriptLastCompleted())?.projectChangeCount;
      expect(baseline).toBe(41);
      const changed = await api.projectStateChangedSince(checked.changeCount ?? 0, baseline ?? 0);
      expectMatches(projectStateChangedSchema, changed, 'mock project-state changed since');
      expect(changed.changed).toBe(true);
      await expect(createMockApi({}, { projectState: 'error' }).projectStateCheck()).rejects.toThrow();
    } finally {
      vi.useRealTimers();
    }
  });

  it('cleanupToolsLaunch refuses a tool off the allow-list, the way the Go service does', async () => {
    await expect(createMockApi().cleanupToolsLaunch('40209' as never)).rejects.toThrow(/unknown cleanup tool/);
  });

  it('chapterTagsPreview and its seeded states', async () => {
    expectMatches(chapterTagsPreviewSchema, await createMockApi().chapterTagsPreview(), 'mock chapter-tags preview idle');
    for (const seed of ['ready', 'not-rendered'] as const) {
      expectMatches(chapterTagsPreviewSchema, await createMockApi({}, { chapterTags: seed }).chapterTagsPreview(), `mock chapter-tags preview seed ${seed}`);
    }
  });

  it('chapterTagsEmbed writes a tagged copy, refuses a blank destination, and can be seeded to error', async () => {
    const api = createMockApi({}, { chapterTags: 'ready' });
    expectMatches(chapterTagsEmbedResultSchema, await api.chapterTagsEmbed('C:/Books/Alice/renders/Alice.mp3'), 'mock chapter-tags embed success');
    await expect(api.chapterTagsEmbed('   ')).rejects.toThrow(/choose the MP3 file/);
    await expect(
      createMockApi({}, { chapterTags: 'ready', chapterTagsEmbedAlwaysErrors: true }).chapterTagsEmbed('C:/Books/Alice/renders/Alice.mp3'),
    ).rejects.toThrow();
  });

  it('the take-review scan job answers, and the reads of every finding it saves', async () => {
    const api = createMockApi();
    expectMatches(takeReviewScanJobSchema, await api.takeReviewScanState(), 'mock take-review scan, idle');
    const started = await api.takeReviewScanStart({ chapterTrackName: 'Chapter 1' });
    expectMatches(takeReviewScanJobSchema, started, 'mock take-review scan, started');
    let job = started;
    while (job.phase === 'running') {
      job = await api.takeReviewScanState();
      expectMatches(takeReviewScanJobSchema, job, `mock take-review scan, ${job.phase} at ${job.percent}%`);
    }
    expect(job).toMatchObject({ phase: 'success', found: 2 });
    const { findings } = await api.findingsList({ analyzer: 'take-review' });
    expect(findings).toHaveLength(2);
    for (const finding of findings) expectMatches(takeReviewEvidenceSchema, finding.evidence, `mock take-review evidence of ${finding.id}`);
    await api.takeReviewScanStart({ chapterTrackName: 'Chapter 2' });
    expectMatches(takeReviewScanJobSchema, await api.takeReviewScanCancel(), 'mock take-review scan, cancelled');
    await expect(api.takeReviewScanStart({ chapterTrackName: '' })).rejects.toThrow(/choose a track/);
  });

  it('the evidence of the take comparison the host pins, and of the mock fixture', () => {
    const pinned = findingsPageSchema.parse(readGolden('findings-list-take-comparison.json'));
    expect(pinned.findings).toHaveLength(1);
    for (const finding of [...pinned.findings, WIRE_TAKE_COMPARISON_FINDING]) {
      expectMatches(takeComparisonEvidenceSchema, finding.evidence, `take-comparison evidence of ${finding.id}`);
    }
  });

  it('the take comparison job answers, and the comparison it saves', async () => {
    const api = createMockApi({}, { findings: WIRE_TAKE_REVIEW_FINDINGS });
    expectMatches(takeComparisonJobSchema, await api.takeComparisonState(), 'mock take comparison, idle');
    let job = await api.takeComparisonStart(WIRE_TAKE_REVIEW_FINDINGS[0].id);
    expectMatches(takeComparisonJobSchema, job, 'mock take comparison, started');
    await expect(api.takeComparisonStart(WIRE_TAKE_REVIEW_FINDINGS[0].id)).rejects.toThrow(/already running/);
    while (job.phase === 'running') {
      job = await api.takeComparisonState();
      expectMatches(takeComparisonJobSchema, job, `mock take comparison, ${job.phase} at ${job.percent}%`);
    }
    expect(job.phase).toBe('success');
    const saved = await api.findingsGet(job.comparisonId ?? '');
    expectMatches(takeComparisonEvidenceSchema, saved.evidence, 'mock take comparison evidence');
    await api.takeComparisonStart(WIRE_TAKE_REVIEW_FINDINGS[1].id);
    expectMatches(takeComparisonJobSchema, await api.takeComparisonCancel(), 'mock take comparison, cancelled');
    await expect(api.takeComparisonStart('missing')).rejects.toThrow(/not in the review list/);
  });

  it('the measurement job answers, with every file measured, unavailable or refused', async () => {
    const api = createMockApi();
    expectMatches(measureJobSchema, await api.measureState(), 'mock measurement, idle');
    await expect(api.measureAnalyze(MOCK_MEASURE_PATHS)).rejects.toThrow(/not chosen in the file picker/);
    const picked = await api.measurePickFiles();
    expectMatches(measurePickResultSchema, picked, 'mock measurement picker');
    await expect(api.measureAnalyze([])).rejects.toThrow(/at least one file/);
    let job = await api.measureAnalyze(picked.paths);
    expectMatches(measureJobSchema, job, 'mock measurement, started');
    await expect(api.measureAnalyze(picked.paths)).rejects.toThrow(/already running/);
    let percent = job.percent;
    while (job.phase === 'running') {
      job = await api.measureState();
      expectMatches(measureJobSchema, job, `mock measurement, ${job.phase} at ${job.percent}%`);
      expect(job.percent).toBeGreaterThanOrEqual(percent);
      percent = job.percent;
    }
    expect(job.phase).toBe('success');
    expect(job.files.map((file) => file.status)).toEqual(['measured', 'measured', 'failed']);
    expect(job.files[1].report?.integrated_lufs).toBeNull();
    const pinned = measureJobSchema.parse(readGolden('measure-success.json'));
    expect(job.message).toBe(pinned.message);
    await api.measureAnalyze(picked.paths);
    await api.measureState();
    const cancelled = await api.measureCancel();
    expectMatches(measureJobSchema, cancelled, 'mock measurement, cancelled');
    expect(cancelled.files.map((file) => file.status)).toEqual(['cancelled', 'cancelled', 'cancelled']);
  });

  it('an MP3 is judged on its container, and the mock judges it as the host pins', () => {
    const pinned = measureJobSchema.parse(readGolden('measure-mp3.json'));
    expect(pinned.profile).not.toBeNull();
    for (const file of pinned.files) {
      expect(file.report?.mp3).toBeDefined();
      const mock = evaluateMockFile(file.report!, file.path, pinned.profile!);
      expect(mock.rules).toEqual(file.rules);
      expect(mock.findings.map((finding) => deliveryQcEvidenceSchema.parse(finding.evidence))).toEqual(
        file.findings.map((finding) => deliveryQcEvidenceSchema.parse(finding.evidence)),
      );
    }
    expect(pinned.files.map((file) => file.rules.find((rule) => rule.ruleId === 'acx.format')?.violation)).toEqual([undefined, 'not_cbr']);
  });

  it("a measurement is judged by the host against the project's profile, rule by rule, in the shape the host pins", async () => {
    const pinned = measureJobSchema.parse(readGolden('measure-success.json'));
    const pinnedFindings = pinned.files.flatMap((file) => file.findings);
    expect(pinnedFindings.map((finding) => deliveryQcEvidenceSchema.parse(finding.evidence).rule)).toEqual([
      'acx.sample_rate',
      'acx.rms',
      'acx.peak',
      'acx.noise_floor',
      'acx.room_tone_head',
      'acx.room_tone_tail',
    ]);
    const api = createMockApi();
    const picked = await api.measurePickFiles();
    let job = await api.measureAnalyze(picked.paths);
    while (job.phase === 'running') job = await api.measureState();
    expectMatches(measureJobSchema, job, 'mock measurement, judged');
    const shape = (files: typeof job.files) =>
      files.map((file) => [
        file.rules.map((rule) => [rule.ruleId, rule.status, rule.violation]),
        file.findings.map((finding) => [
          finding.severity,
          deliveryQcEvidenceSchema.parse(finding.evidence).rule,
          deliveryQcEvidenceSchema.parse(finding.evidence).violation,
        ]),
      ]);
    expect(shape(job.files)).toEqual(shape(pinned.files));
    expect(job.bookRules).toEqual(pinned.bookRules);
    expect(job.profile).toEqual(pinned.profile);
    const copy = await api.deliveryDuplicateProfile('acx', '2026-09');
    await api.deliverySelectProfile('project', copy.id, '');
    expect((await api.measureState()).profile?.id).toBe(copy.id);
  });

  it('the delivery profiles answer as the host pins them, and refuse the way the host does', async () => {
    const pinned = deliveryProfilesStateSchema.parse(readGolden('delivery-profiles.json'));
    expect(pinned.profiles[0]).toEqual(MOCK_ACX);
    const api = createMockApi();
    const state = await api.deliveryProfiles();
    expectMatches(deliveryProfilesStateSchema, state, 'mock delivery profiles');
    expect(state).toMatchObject({ globalDefault: pinned.globalDefault, projectProfile: 'acx@2026-09', projectChoice: null });
    const copy = await api.deliveryDuplicateProfile('acx', '2026-09');
    expectMatches(deliveryProfileSchema, copy, 'mock duplicate');
    expect(copy).toMatchObject({ builtIn: false, revision: 1, basedOn: 'acx@2026-09', name: 'ACX (September 2026) copy' });
    const rules = copy.rules.map((rule) => ({
      id: rule.id,
      off: rule.id === 'acx.room_tone_head',
      min: rule.min,
      max: rule.id === 'acx.peak' ? -3.5 : rule.max,
    }));
    const saved = await api.deliverySaveProfile({ id: copy.id, name: 'My ACX, tighter peak', rules });
    expectMatches(deliveryProfileSchema, saved, 'mock saved profile');
    const pinnedSaved = deliveryProfileSchema.parse(readGolden('delivery-profile-saved.json'));
    expect({ ...saved, id: pinnedSaved.id }).toEqual({ ...pinnedSaved, revision: 2 });
    await expect(api.deliverySaveProfile({ id: 'acx', name: 'ACX', rules: [] })).rejects.toThrow(/built-in/);
    await expect(api.deliverySaveProfile({ id: copy.id, name: 'x', rules: rules.slice(1) })).rejects.toThrow(/cannot add or drop/);
    const chosen = await api.deliverySelectProfile('project', copy.id, '');
    expect(chosen.projectProfile).toBe(`${copy.id}@r2`);
    await expect(api.deliverySelectProfile('project', 'missing', '')).rejects.toThrow(/no delivery profile/);
    const deleted = await api.deliveryDeleteProfile(copy.id);
    expectMatches(deliveryProfilesStateSchema, deleted, 'mock after delete');
    expect(deleted.notice).toMatch(/no longer there/);
    await expect(api.deliveryDeleteProfile('acx')).rejects.toThrow(/built-in/);
    expect((await createMockApi({}, { deliveryProfile: 'custom' }).deliveryProfiles()).projectProfile).toBe(`${mockCustomProfile().id}@r3`);
  });

  it('the report export answers what it wrote, and refuses the way the host does', async () => {
    const pinned = deliveryReportExportSchema.parse(readGolden('delivery-report-export.json'));
    const api = createMockApi();
    await expect(api.deliveryExportReport(false)).rejects.toThrow(/nothing has been measured or checked/);
    const picked = await api.measurePickFiles();
    let job = await api.measureAnalyze(picked.paths);
    await expect(api.deliveryExportReport(false)).rejects.toThrow(/wait for the measurement/);
    while (job.phase === 'running') job = await api.measureState();
    const written = await api.deliveryExportReport(false);
    expectMatches(deliveryReportExportSchema, written, 'mock report export');
    expect(written).toMatchObject({ folder: pinned.folder, htmlFile: pinned.htmlFile, files: 3, findings: 6, openFindings: 6, pathsIncluded: false });
    const again = await api.deliveryExportReport(true);
    expect(again.htmlFile).toBe('delivery-report-20260923-140000Z-2.html');
    expect(again.pathsIncluded).toBe(true);
  });

  it('the diagnostics job answers over the picked files, with the findings and thresholds the host pins', async () => {
    const api = createMockApi();
    const idle = await api.diagnosticsState();
    expectMatches(diagnosticsJobSchema, idle, 'mock diagnostics, idle');
    const pinnedIdle = diagnosticsJobSchema.parse(readGolden('diagnostics-idle.json'));
    expect(idle.thresholds).toEqual(pinnedIdle.thresholds);
    await expect(api.diagnosticsAnalyze(MOCK_MEASURE_PATHS, 'processed_render')).rejects.toThrow(/not chosen in the file picker/);
    const picked = await api.measurePickFiles();
    await expect(api.diagnosticsAnalyze(picked.paths, 'master' as never)).rejects.toThrow(/raw recordings or processed renders/);
    await expect(api.diagnosticsAnalyze([], 'processed_render')).rejects.toThrow(/at least one file/);
    let job = await api.diagnosticsAnalyze(picked.paths, 'processed_render');
    expectMatches(diagnosticsJobSchema, job, 'mock diagnostics, started');
    await expect(api.diagnosticsAnalyze(picked.paths, 'processed_render')).rejects.toThrow(/already running/);
    let percent = job.percent;
    while (job.phase === 'running') {
      job = await api.diagnosticsState();
      expectMatches(diagnosticsJobSchema, job, `mock diagnostics, ${job.phase} at ${job.percent}%`);
      expect(job.percent).toBeGreaterThanOrEqual(percent);
      percent = job.percent;
    }
    const pinned = diagnosticsJobSchema.parse(readGolden('diagnostics-success.json'));
    expect(job.message).toBe(pinned.message);
    expect(job.files.map((file) => file.status)).toEqual(pinned.files.map((file) => file.status));
    expect(job.files[0].findings).toEqual(pinned.files[0].findings.map((finding) => ({ ...finding, source: { file: MOCK_MEASURE_PATHS[0] } })));
    expect(job.files[1].findings).toEqual([]);
    const raw = await api.diagnosticsAnalyze(picked.paths, 'raw_recording');
    expect(raw.sourceKind).toBe('raw_recording');
    const cancelled = await api.diagnosticsCancel();
    expectMatches(diagnosticsJobSchema, cancelled, 'mock diagnostics, cancelled');
    expect(cancelled.files.map((file) => file.status)).toEqual(['cancelled', 'cancelled', 'cancelled']);
  });

  it('the evidence of every take-review finding the host pins, and of the mock fixture', () => {
    const pinned = findingsPageSchema.parse(readGolden('findings-list-take-review.json'));
    for (const finding of [...pinned.findings, ...WIRE_TAKE_REVIEW_FINDINGS]) {
      expectMatches(takeReviewEvidenceSchema, finding.evidence, `take-review evidence of ${finding.id}`);
    }
  });

  it('the answers for going to and looping one read of a take-review finding', async () => {
    const api = createMockApi();
    await api.takeReviewScanStart({ chapterTrackName: 'Chapter 1' });
    while ((await api.takeReviewScanState()).phase === 'running');
    const [finding] = (await api.findingsList({ analyzer: 'take-review' })).findings;
    expectMatches(findingNavigationSchema, await api.findingsGoToRead(finding.id, 1), 'mock go to read');
    expectMatches(findingNavigationSchema, await api.findingsLoopRead(finding.id, 1), 'mock loop read');
    for (const reaper of ['standalone', 'stale'] as const) {
      const refusing = createMockApi({}, { reaper, findings: WIRE_TAKE_REVIEW_FINDINGS });
      expectMatches(findingNavigationSchema, await refusing.findingsGoToRead(WIRE_TAKE_REVIEW_FINDINGS[0].id, 0), `mock ${reaper} go to read`);
    }
  });

  it('the review bindings answers', async () => {
    const api = createMockApi();
    const page = await api.findingsList({ includeNotInLatestRun: true });
    expectMatches(findingsPageSchema, page, 'mock findings list');
    expect(page.total).toBe(page.findings.length);
    expect(page.findings.length).toBeGreaterThan(0);
    const shown = page.findings[0];
    expectMatches(findingSchema, await api.findingsGet(shown.id), 'mock findings get');
    const reviewed = await api.findingsReview({ id: shown.id, evidenceVersion: shown.evidence_version ?? '', status: 'deferred', note: 'Check tomorrow.' });
    expectMatches(findingSchema, reviewed, 'mock findings review');
    expectMatches(findingsSummarySchema, await api.findingsSummary(), 'mock findings summary');
    const empty = createMockApi({}, { findings: [] });
    expectMatches(findingsPageSchema, await empty.findingsList({}), 'mock findings list, empty queue');
    expectMatches(findingsSummarySchema, await empty.findingsSummary(), 'mock findings summary, empty queue');
  });

  it('the review REAPER bindings answers, every outcome and refusal', async () => {
    const api = createMockApi();
    const { findings } = await api.findingsList({ includeNotInLatestRun: true });
    const placed = findings.find((finding) => finding.source.item_guid && finding.time_range?.source_start !== undefined);
    const older = findings.find((finding) => finding.analyzer === 'transcript-compare' && !finding.source.item_guid);
    if (!placed || !older) throw new Error('the mock findings lost the finding with an item or the one from an older comparison');
    const answers: Array<[string, Promise<unknown>]> = [
      ['go to', api.findingsGoTo(placed.id)],
      ['loop', api.findingsLoop(placed.id)],
      ['status while looping', api.findingsReaperStatus()],
      ['stop', api.findingsStopLoop()],
      ['no item', api.findingsGoTo(older.id)],
    ];
    for (const reaper of ['standalone', 'not-running', 'stale', 'recording', 'outdated'] as const) {
      const refusing = createMockApi({}, { reaper });
      answers.push([`${reaper} status`, refusing.findingsReaperStatus()], [`${reaper} go to`, refusing.findingsGoTo(placed.id)]);
      answers.push([`${reaper} loop`, refusing.findingsLoop(placed.id)], [`${reaper} stop`, refusing.findingsStopLoop()]);
    }
    for (const [name, answer] of answers) {
      const value = await answer;
      const schema = name.endsWith('status') || name === 'status while looping' ? reaperStatusSchema : findingNavigationSchema;
      expectMatches(schema, value, `mock ${name}`);
    }
  });

  it('the approved marker answers, every outcome and refusal', async () => {
    const api = createMockApi();
    const { findings } = await api.findingsList({ includeNotInLatestRun: true });
    const placed = findings.find((finding) => finding.source.item_guid && finding.time_range?.source_start !== undefined);
    if (!placed) throw new Error('the mock findings lost the finding with an item');
    const accept = { id: placed.id, evidenceVersion: placed.evidence_version ?? '', status: 'accepted', note: '' } as const;
    const answers: Array<[string, unknown]> = [['not accepted', await api.findingsAddMarker(placed.id)]];
    await api.findingsReview(accept);
    answers.push(['added', await api.findingsAddMarker(placed.id)], ['existing', await api.findingsAddMarker(placed.id)]);
    for (const reaper of ['standalone', 'not-running', 'stale', 'recording', 'outdated'] as const) {
      const refusing = createMockApi({}, { reaper });
      await refusing.findingsReview(accept);
      answers.push([reaper, await refusing.findingsAddMarker(placed.id)]);
    }
    for (const [name, answer] of answers) expectMatches(findingMarkerSchema, answer, `mock add marker, ${name}`);
  });

  it('the take-creation answer', async () => {
    const api = createMockApi();
    const result = await api.takeReviewCreateTake({
      findingId: 'finding-1',
      targetItemGuid: '{AAAAAAAA-0000-4000-8000-000000000001}',
      candidateItemGuid: '',
      sourceFile: 'C:/Projects/Alice/media/chapter1-take2.wav',
      sourceRangeStart: 0,
      sourceRangeEnd: 3,
    });
    expectMatches(takeReviewCreateTakeResultSchema, result, 'mock take creation');
    expect(result.targetItemGuid).toBe('{AAAAAAAA-0000-4000-8000-000000000001}');
  });

  it('the recording coverage answers: a current, a never and a stale result, a check to its end, and every refusal', async () => {
    const api = createMockApi();
    const chapters = await api.manuscriptChapters();
    const measured = chapters.find((chapter) => chapter.recordedFraction !== undefined);
    if (!measured) throw new Error('the mock chapters carry a measured recordedFraction');
    const current = await api.coverageResult(measured.id);
    expectMatches(coverageResultSchema, current, 'mock coverage result, current');
    expect(current.state).toBe('current');
    expect(current.recordedFraction).toBe(measured.recordedFraction);
    const unknown = await api.coverageResult('no-such-chapter');
    expectMatches(coverageResultSchema, unknown, 'mock coverage result, never');
    expect(unknown).toMatchObject({ state: 'never', reasons: ['chapter_not_found'] });
    expectMatches(coverageStateSchema, await api.coverageState(), 'mock coverage state, idle');

    const staleApi = createMockApi({}, { coverage: { stale: [measured.id] } });
    const stale = await staleApi.coverageResult(measured.id);
    expectMatches(coverageResultSchema, stale, 'mock coverage result, stale');
    expect(stale.state).toBe('stale');
    expect(stale.recordedFraction).toBeUndefined();
    const staleChapter = (await staleApi.manuscriptChapters()).find((chapter) => chapter.id === measured.id);
    expect(staleChapter?.recordedFraction).toBeUndefined();

    vi.useFakeTimers();
    try {
      const states: unknown[] = [];
      const ended: string[] = [];
      api.subscribeCoverage((state) => states.push(state));
      api.subscribeJobEnded((event) => ended.push(`${event.kind}:${event.outcome}`));
      const started = await api.coverageStart(measured.id);
      expectMatches(coverageStartResultSchema, started, 'mock coverage start');
      expect(started.status).toBe('started');
      const busy = await api.coverageStart(measured.id);
      expectMatches(coverageStartResultSchema, busy, 'mock coverage start, busy');
      expect(busy).toMatchObject({ status: 'refused', reason: 'busy' });
      await vi.runAllTimersAsync();
      states.forEach((state, index) => expectMatches(coverageStateSchema, state, `mock coverage:state ${index}`));
      expect(await api.coverageState()).toMatchObject({ phase: 'complete', percent: 100 });
      expect(ended).toEqual(['recording_coverage:success']);
    } finally {
      vi.useRealTimers();
    }

    for (const reason of COVERAGE_REFUSAL_REASONS) {
      const refused = await createMockApi({}, { coverage: { refusal: reason } }).coverageStart(measured.id);
      expectMatches(coverageStartResultSchema, refused, `mock coverage start, refused ${reason}`);
      expect(refused).toMatchObject({ status: 'refused', reason });
    }
    const gated = await createMockApi({}, { assets: 'missing' }).coverageStart(measured.id);
    expectMatches(coverageStartResultSchema, gated, 'mock coverage start, model not installed');
    expect(gated.status).toBe('asset_required');
  });

  it('the stage recommendations: every verdict, every unknown cause, a confirmation, the notice, and every refusal', async () => {
    const api = createMockApi(
      {},
      {
        stages: {
          recording: { 'chapter-4': 'met', 'chapter-5': 'met', 'chapter-7': 'not_met' },
          dismissed: ['chapter-5'],
          confirmed: ['chapter-7', 'chapter-8'],
        },
      },
    );
    await api.manuscriptSetChapterStatus('chapter-11', 'recording');
    const chapters = await api.manuscriptChapters();
    const answer = await api.stageRecommendations();
    expectMatches(stageRecommendationsSchema, answer, 'mock stage recommendations');
    expect(answer.chapters.map((chapter) => chapter.chapterId)).toEqual(chapters.map((chapter) => chapter.id));
    const byId = new Map(answer.chapters.map((chapter) => [chapter.chapterId, chapter]));
    expect(new Set(answer.chapters.map((chapter) => chapter.verdict))).toEqual(new Set(['recommended', 'not_ready', 'unknown', 'dismissed', 'none']));
    expect(byId.get('chapter-1')).toMatchObject({ verdict: 'none', noneReason: 'stage_not_evaluated' });
    expect(byId.get('chapter-9')).toMatchObject({ verdict: 'none', noneReason: 'no_required_signals' });
    expect(byId.get('chapter-6')).toMatchObject({ verdict: 'not_ready' });
    expect(byId.get('chapter-11')).toMatchObject({ verdict: 'unknown', causes: ['never_analyzed'] });
    for (const cause of STAGE_UNKNOWN_CAUSES) {
      const unknown = await createMockApi({}, { stages: { recording: { 'chapter-4': { unknown: cause } } } }).stageRecommendations();
      expectMatches(stageRecommendationsSchema, unknown, `mock stage recommendations, ${cause}`);
      expect(unknown.chapters.find((chapter) => chapter.chapterId === 'chapter-4')).toMatchObject({ verdict: 'unknown', causes: [cause] });
    }
    expect(byId.get('chapter-7')).toMatchObject({ confirmation: { from: 'recording', evidenceChanged: true }, contradiction: { revertTo: 'recording' } });
    expect(byId.get('chapter-8')?.confirmation?.evidenceChanged).toBe(true);
    expect(byId.get('chapter-8')?.contradiction).toBeUndefined();

    const recommended = byId.get('chapter-4');
    if (!recommended?.target || !recommended.basisKey) throw new Error('chapter-4 is recommended');
    const changed = await api.stageConfirm('chapter-4', recommended.target, 'not-the-key');
    expectMatches(stageDecisionResultSchema, changed, 'mock stage confirm, basis changed');
    expect(changed).toMatchObject({ status: 'refused', reason: 'basis_changed' });
    const notRecommended = await api.stageConfirm('chapter-6', 'editing', byId.get('chapter-6')?.basisKey ?? '');
    expect(notRecommended).toMatchObject({ status: 'refused', reason: 'not_recommended' });
    const confirmed = await api.stageConfirm('chapter-4', recommended.target, recommended.basisKey);
    expectMatches(stageDecisionResultSchema, confirmed, 'mock stage confirm');
    expect(confirmed).toMatchObject({ status: 'ok', chapter: { from: 'editing', confirmation: { from: 'recording', evidenceChanged: false } } });
    expect((await api.manuscriptChapters()).find((chapter) => chapter.id === 'chapter-4')?.status).toBe('editing');
    const reverted = await api.stageRevert('chapter-4');
    expectMatches(stageDecisionResultSchema, reverted, 'mock stage revert');
    expect(reverted).toMatchObject({ status: 'ok', chapter: { from: 'recording', verdict: 'recommended' } });
    const nothing = await api.stageRevert('chapter-4');
    expectMatches(stageDecisionResultSchema, nothing, 'mock stage revert, nothing to revert');
    expect(nothing).toMatchObject({ status: 'refused', reason: 'nothing_to_revert' });
    const dismissed = await api.stageDismiss('chapter-4', recommended.target, recommended.basisKey);
    expectMatches(stageDecisionResultSchema, dismissed, 'mock stage dismiss');
    expect(dismissed).toMatchObject({ status: 'ok', chapter: { verdict: 'dismissed' } });
    await expect(api.stageRevert('no-such-chapter')).rejects.toThrow('not a narration chapter');
  });

  it('every method of the API is either checked in this file, void, or not a request', () => {
    // A new binding fails this until it has a schema and a row above (ADR 0069). The list of what is checked is kept by hand.
    const CHECKED = [
      'ready',
      'bootstrap',
      'systemLookup',
      'systemCopyDiagnostics',
      'saveSettings',
      'settingsForScope',
      'selectManuscript',
      'manuscriptBeginImport',
      'manuscriptImportState',
      'manuscriptImportPreview',
      'manuscriptImportCommit',
      'manuscriptChapters',
      'manuscriptParagraphs',
      'manuscriptSearch',
      'manuscriptSetChapterStatus',
      'manuscriptSetChapterKind',
      'noteList',
      'noteCreate',
      'manuscriptReader',
      'readerState',
      'readerStateSave',
      'readerBookmarkCreate',
      'guideBuild',
      'guideBuildState',
      'guideEntities',
      'guideCreate',
      'guidePreview',
      'assetsList',
      'assetsInstall',
      'assetsInstallState',
      'assetsInstallCancel',
      'assetsVerify',
      'ttsCatalog',
      'ttsInstall',
      'ttsInstallState',
      'ttsInstallCancel',
      'whisperCatalog',
      'whisperInstall',
      'whisperInstallState',
      'whisperInstallCancel',
      'transcriptStart',
      'transcriptLastCompleted',
      'transcriptAddEquivalence',
      'transcriptSuggestHints',
      'transcriptHints',
      'projectRecents',
      'selectProjectFolder',
      'switchProject',
      'createProject',
      'removeRecentProject',
      'linkDawFile',
      'launchDaw',
      'dawCatalogList',
      'tracksDiscover',
      'tracksSelect',
      'tracksList',
      'chapterTrackMapList',
      'chapterTrackMapConfirm',
      'chapterTrackMapClear',
      'chapterTrackSet',
      'chapterTrackUnlink',
      'chapterSyncState',
      'chapterSyncPreview',
      'chapterSyncSetEnabled',
      'chapterSyncUndo',
      'chapterTrackLinks',
      'chapterRegionsPreview',
      'chapterRegionsCreate',
      'chapterTrackMatch',
      'chapterSuggestion',
      'chaptersForTracks',
      'lineIdentityStamp',
      'lineIdentityRead',
      'lineIdentityState',
      'pickupsImport',
      'pickupsExport',
      'pickupsNext',
      'pickupsResolve',
      'pickupsCount',
      'pickupsState',
      'renderConfigConfigure',
      'renderConfigSuggestFolder',
      'renderConfigState',
      'cleanupToolsLaunch',
      'cleanupToolsState',
      'projectStateCheck',
      'projectStateChangedSince',
      'projectStateState',
      'retakeLanesList',
      'retakeLanesPick',
      'retakeLanesState',
      'chapterTagsPreview',
      'chapterTagsEmbed',
      'takeReviewScanStart',
      'takeReviewScanState',
      'takeReviewScanCancel',
      'takeReviewCreateTake',
      'coverageStart',
      'coverageState',
      'coverageResult',
      'stageRecommendations',
      'stageConfirm',
      'stageDismiss',
      'stageRevert',
      'takeComparisonStart',
      'takeComparisonState',
      'takeComparisonCancel',
      'measurePickFiles',
      'measureAnalyze',
      'measureState',
      'measureCancel',
      'deliveryExportReport',
      'deliveryProfiles',
      'deliverySelectProfile',
      'deliveryDuplicateProfile',
      'deliverySaveProfile',
      'deliveryDeleteProfile',
      'diagnosticsAnalyze',
      'diagnosticsState',
      'diagnosticsCancel',
      'editingStart',
      'editingState',
      'editingCandidates',
      'findingsList',
      'findingsGet',
      'findingsReview',
      'findingsSummary',
      'findingsReaperStatus',
      'findingsGoTo',
      'findingsLoop',
      'findingsGoToRead',
      'findingsLoopRead',
      'findingsStopLoop',
      'findingsAddMarker',
      'teleprompterStart',
      'teleprompterState',
      'teleprompterDevices',
      'teleprompterLocate',
      'teleprompterSaveFlags',
      'readAloudReaperState',
      'teleprompterReaperInput',
      'updateStatus',
      'updateCheck',
      'updateDownload',
      'updateJobState',
      'updateJobCancel',
      'updateInstall',
      'creditsTemplates',
      'saveCreditsTemplate',
      'duplicateCreditsTemplate',
      'creditsProjectValues',
      'saveCreditsProjectValues',
      'creditsSetupState',
      'creditsSetupDismiss',
      'creditsSetupSave',
      'creditsPreview',
      'creditsChapterAnnouncements',
      'creditsRetailSample',
      'saveCreditsRetailSample',
      'creditsStatuses',
      'setCreditsStatus',
    ];
    const VOID = [
      'manuscriptImportCancel',
      'clearProjectData',
      'readerBookmarkDelete',
      'noteDelete',
      'guideEdit',
      'guideSetLocked',
      'guideRescan',
      'guidePronounce',
      'guideMerge',
      'guideDelete',
      'guideRelate',
      'guideUnrelate',
      'ttsRemove',
      'whisperRemove',
      'assetsRemove',
      'transcriptCancel',
      'coverageCancel',
      'editingCancel',
      'transcriptReset',
      'transcriptJump',
      'transcriptExportMarkers',
      'transcriptSaveHints',
      'teleprompterStop',
      'teleprompterMeterStart',
      'teleprompterMeterStop',
      'teleprompterPause',
      'dawCatalogOpenDownloadPage',
      'teleprompterSeek',
      'reportClientDiagnostic',
      'systemNotify',
      'systemOpenLogFolder',
      'updateOpenNotes',
      'updateShowDownload',
      'deleteCreditsTemplate',
    ];
    const NOT_A_REQUEST = [
      'mediaUrl',
      'subscribeProjectAttach',
      'subscribeLiveUpdateHealth',
      'subscribeNotices',
      'subscribeJobEnded',
      'subscribeTranscript',
      'subscribeCoverage',
      'subscribeTeleprompterEvent',
      'subscribeTeleprompterState',
      'subscribeUpdate',
      'subscribeLineIdentity',
      'subscribePickups',
      'subscribeChapterSync',
      'subscribeRenderConfig',
      'subscribeCleanupTools',
      'subscribeProjectState',
      'subscribeRetakeLanes',
    ];
    expect([...CHECKED, ...VOID, ...NOT_A_REQUEST].sort()).toEqual(Object.keys(createMockApi()).sort());
  });
});

describe('one deliberately broken sample per boundary fails with a specific message', () => {
  const failure = (schema: z.ZodType, value: unknown, payload: string): WireError => {
    try {
      parseWire(schema, value, ctx(payload));
    } catch (error) {
      if (error instanceof WireError) return error;
    }
    throw new Error(`${payload} was accepted`);
  };

  it('a binding result (Bootstrap with a numeric project name)', () => {
    const broken = { ...(readGolden('bootstrap-manuscript.json') as object), projectName: 42 };
    expect(failure(bootstrapSchema, broken, 'Bootstrap').details()).toMatch(
      /Bootstrap did not match its schema: projectName: Invalid input: expected string, received number/,
    );
  });

  it('a live event (a position with a text read index)', () => {
    const position = (readGolden('teleprompter-events.json') as Array<{ type: string }>).find((event) => event.type === 'position');
    expect(failure(teleprompterEventSchema, { ...position, read: 'four' }, 'teleprompter:event').issues.map((issue) => issue.path)).toEqual(['read']);
  });

  it('a live event (a flag of a kind the UI does not know)', () => {
    const flags = (readGolden('teleprompter-events.json') as Array<{ type: string; kind?: string }>).filter((event) => event.type === 'flag');
    expect(new Set(flags.map((flag) => flag.kind))).toEqual(new Set(['misread', 'extra', 'skipped', 'restart']));
    expect(failure(teleprompterEventSchema, { ...flags[0], kind: 'mumbled' }, 'teleprompter:event').issues.map((issue) => issue.path)).toEqual(['kind']);
  });

  it('a state snapshot (a transcript phase the UI does not know)', () => {
    const broken = { ...(readGolden('transcript-idle.json') as object), phase: 'paused' };
    expect(failure(transcriptStateSchema, broken, 'transcript:state').issues[0]?.path).toBe('phase');
  });
});

// The sidecar's credits script (chapter_script.text_script, ADR 0150) and the reader's `creditsRows` split the same text the
// same way: every span of the golden lands on a line of the text the Python test built it from, with every word tracked.
describe('the credits script the sidecar sends', () => {
  it('lays over the reader rows of the same text with no drift', () => {
    const text = 'You have been listening to Alice, written by Lewis Carroll,\nnarrated by Ada Finch.\n\nThe End.';
    const script = parseWire(teleprompterEventSchema, readGolden('teleprompter-credits-script.json'), ctx('teleprompter:event'));
    if (script.type !== 'script') throw new Error('the golden is not a script event');

    const rows = creditsRows('closing', text, script);

    expect(rows.map((row) => [row.key, row.start, row.words?.length])).toEqual(script.spans.map((span) => [span.id, span.start, span.count]));
  });
});
