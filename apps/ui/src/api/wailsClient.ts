import { parseWire, parseWireJson, type WireContext } from './wire/parseWire';
import { isWireError, WireError } from './wire/WireError';
import { createLiveHealth } from './wire/liveHealth';
import type { InferOutput, StandardSchemaV1 } from './wire/standardSchema';
import { voidResult } from './schemas/base';
import {
  chaptersSchema,
  fileSelectionSchema,
  notesSchema,
  chapterKindResultSchema,
  chapterSchema,
  paragraphsSchema,
  readerSchema,
  readerStateSchema,
  searchHitsSchema,
  workJobSchema,
} from './schemas/manuscript';
import {
  dawLaunchResultSchema,
  dawLinkResultSchema,
  projectDefaultLocationSchema,
  projectFolderSelectionSchema,
  projectSwitchResultSchema,
  recentProjectsSchema,
} from './schemas/project';
import {
  creditsAnnouncementsSchema,
  creditsProjectValuesResultSchema,
  creditsRecordedLengthsSchema,
  creditsSetupStateSchema,
  creditsRenderResultSchema,
  creditsStatusesSchema,
  creditTemplateSchema,
  creditTemplatesSchema,
  retailSampleAnswerSchema,
} from './schemas/credits';
import { dawCatalogListSchema } from './schemas/dawCatalog';
import {
  dawBackupsFileSchema,
  dawCapabilitiesSchema,
  dawChoiceSchema,
  dawFxRangeCompareSchema,
  dawFxRangeSettingsSchema,
  dawLastActionSchema,
  dawMonitorLevelSchema,
  dawProjectStateSchema,
  dawResultSchema,
  dawTransportSchema,
} from './schemas/daw';
import { providerCapabilitiesSchema } from './schemas/providers';
import { pronunciationCandidateSchema, pronunciationSourcesSchema } from './schemas/pronunciationSources';
import { takeEvidenceResultSchema } from './schemas/takeEvidence';
import { pronunciationOnlineKeyStatusSchema, pronunciationOnlineResultSchema } from './schemas/pronunciationOnline';
import { masteringProvidersSchema } from './schemas/mastering';
import { recorderDevicesResultSchema, recorderLevelSchema, recorderStateSchema } from './schemas/recording';
import { chapterSyncPreviewSchema, chapterSyncStateSchema } from './schemas/chapterSync';
import {
  guideBuildResultSchema,
  guideCreatedSchema,
  guideDialogueCuesSchema,
  guideEntitiesSchema,
  guideMergeResultSchema,
  guidePreviewSchema,
  guideTypesSchema,
} from './schemas/storyBible';
import { approvedCharacterReferencesSchema, characterRegionsSchema, characterReferenceSchema } from './schemas/character';
import { seriesListSchema, seriesSchema, seriesVoiceBibleSchema } from './schemas/series';
import { settingsForScopeSchema } from './schemas/settings';
import { tracksDiscoverySchema, tracksProjectSchema } from './schemas/tracks';
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
  trackSelectResultSchema,
} from './schemas/chapterTrackMap';
import { takeComparisonJobSchema, takeReviewCreateTakeResultSchema, takeReviewScanJobSchema } from './schemas/takeReview';
import { deliveryReportExportSchema, measureJobSchema, measurePickResultSchema } from './schemas/measure';
import { deliveryProfileSchema, deliveryProfilesStateSchema } from './schemas/deliveryProfiles';
import { diagnosticsJobSchema } from './schemas/diagnostics';
import { coverageStartOptions } from './coverageOptions';
import { coverageEnginesSchema, coverageGapReviewsSchema, coverageResultSchema, coverageStartResultSchema, coverageStateSchema } from './schemas/coverage';
import { editingCandidatesSchema, editingSourceChoiceSchema, editingStartResultSchema, editingStateSchema } from './schemas/editing';
import {
  workspaceAlignmentResultSchema,
  workspaceFXChainsResultSchema,
  workspacePeaksResultSchema,
  workspaceTakesResultSchema,
  workspaceUseTakeResultSchema,
} from './schemas/workspace';
import { pinnedPreviewSchema, previewResultSchema } from './schemas/preview';
import { stageDecisionResultSchema, stageRecommendationsSchema } from './schemas/stages';
import { proofingChooseRenderResultSchema, proofingRenderSchema } from './schemas/proofingRender';
import {
  productionBurndownSchema,
  productionOverviewSchema,
  productionPlanSchema,
  productionReportExportSchema,
  productionReportPreviewSchema,
  productionStartResultSchema,
  productionStopResultSchema,
} from './schemas/production';
import { workspaceSnapResultSchema } from './schemas/workspaceSnap';
import { findingMarkerSchema, findingNavigationSchema, findingSchema, findingsPageSchema, findingsSummarySchema, reaperStatusSchema } from './schemas/findings';
import { assetCatalogSchema, assetInstallJobSchema, assetVerifyResultSchema } from './schemas/assets';
import { ttsCatalogSchema, ttsInstallJobSchema } from './schemas/tts';
import { updateJobSchema, updateStatusSchema } from './schemas/update';
import { startResultSchema, whisperCatalogSchema, whisperInstallJobSchema } from './schemas/whisper';
import {
  bootstrapSchema,
  copyDiagnosticsResultSchema,
  jobEndedSchema,
  noticeSchema,
  projectAttachStateSchema,
  readySchema,
  windowZoomSchema,
} from './schemas/system';
import {
  TELEPROMPTER_EVENT_TYPES,
  readAloudReaperStateSchema,
  readAloudRecordingSchema,
  teleprompterReaperInputSchema,
  teleprompterDevicesResultSchema,
  teleprompterEventSchema,
  teleprompterFlagFindingsSchema,
  teleprompterLocateResultSchema,
  teleprompterPunchResultSchema,
  teleprompterResumeFollowEventSchema,
  teleprompterResumeFollowSchema,
  teleprompterStartResultSchema,
  teleprompterStateSchema,
} from './schemas/teleprompter';
import type { TeleprompterStartOptions } from './contracts/teleprompter';
import { equivalenceSchema, hintSuggestionsSchema, hintsSchema, lastCompletedSchema, transcriptStateSchema } from './schemas/transcript';
import { lineIdentityStartResultSchema, lineIdentityStateSchema } from './schemas/lineidentity';
import { pickupListSchema, pickupsImportResultSchema, pickupsStartResultSchema, pickupsStateSchema } from './schemas/pickups';
import { renderConfigStartResultSchema, renderConfigStateSchema, renderConfigSuggestedFolderSchema } from './schemas/renderconfig';
import { chapterTagsEmbedResultSchema, chapterTagsPreviewSchema } from './schemas/chaptertags';
import { cleanupToolsStartResultSchema, cleanupToolsStateSchema } from './schemas/cleanuptools';
import { bookmarkSchema as spotBookmarkSchema, bookmarksSchema } from './schemas/bookmarks';
import { passageMapSchema } from './schemas/passageMap';
import { acceptedWordsChangeSchema, acceptedWordsSchema } from './schemas/editLog';
import { markSchema, markThreadDeletedSchema, marksSchema } from './schemas/marks';
import { scriptPrepChapterSchema, scriptPrepSchema, scriptWordSchema } from './schemas/scriptPrep';
import {
  extractionDecisionSchema,
  extractionImportPlanSchema,
  extractionImportPromptSchema,
  extractionImportResultSchema,
  extractionImportUndoneSchema,
  extractionScanJobSchema,
  extractionSourcesSchema,
  extractionSuggestionsSchema,
} from './schemas/extraction';
import { editCutsChangeSchema, editCutsSchema } from './schemas/editCuts';
import { wordFxChangeSchema, wordFxListSchema } from './schemas/wordFx';
import { retryModeAnswerSchema, stackChangeSchema, stackListSchema } from './schemas/editStacks';
import { levelMatchApplyResultSchema, levelMatchPreviewResultSchema } from './schemas/cleanup';
import { projectStateChangedSchema, projectStateStartResultSchema, projectStateStateSchema } from './schemas/projectstate';
import { dictionaryLookupResultSchema } from './schemas/dictionary';
import { retakeLanesListSchema, retakeLanesStartResultSchema, retakeLanesStateSchema } from './schemas/retakelanes';
import { exportJobSchema, multiPackageJobSchema, packageFolderResultSchema, packageJobSchema } from './schemas/renderEncodeMaster';
import type { NarrationApi } from '../types';
import * as host from '../../wailsjs/github.com/countrymanprime/narration-utils/shell/host';
import { Events } from '@wailsio/runtime';
import { logUi } from './uiLog';

/**
 * A Go method that returns an error rejected with the error's text on Wails v2. Wails v3 rejects with a `RuntimeError` whose `message`
 * is that text, and pages show a rejection with `String(reason)`, which would then read "RuntimeError: ...". `decode` and
 * `decodeObject`, which every binding call goes through, keep v2's contract: the text alone. Any other rejection (an unknown method,
 * a wrong argument, a lost transport) passes through as it is.
 */
function hostErrorText(reason: unknown): unknown {
  return reason instanceof Error && reason.name === 'RuntimeError' ? reason.message : reason;
}

async function hostResult<T>(request: Promise<T>, binding = ''): Promise<T> {
  const started = performance.now();
  try {
    const result = await request;
    if (binding) logUi('ui.call.ok', `${binding} ${Math.round(performance.now() - started)}ms`);
    return result;
  } catch (reason) {
    const text = hostErrorText(reason);
    if (binding) logUi('ui.call.fail', `${binding} ${Math.round(performance.now() - started)}ms: ${String(text)}`);
    throw text;
  }
}

// Matches apps/desktop/media.go's mediaRoute constant.
const mediaRoute = '/media';

// A payload that fails its schema is reported to the host log (kind `wire_invalid`: boundary, payload and failing paths,
// never values) before it is rethrown to whoever asked, so a bad payload leaves a trace even when the caller swallows
// the rejection. Best effort: a missing binding or a failed write must not hide the error being reported.
function reportDiagnostic(kind: string, message: string): void {
  try {
    void host.SystemReportDiagnostic(kind, message).catch(() => {});
  } catch {
    // The host is not there to report to.
  }
}

function reportWireError(error: WireError, prefix = ''): void {
  reportDiagnostic('wire_invalid', `${prefix}${error.details()}`);
}

function checked<T>(check: () => T): T {
  try {
    return check();
  } catch (error) {
    if (isWireError(error)) reportWireError(error);
    throw error;
  }
}

const bindingContext = (payload: string): WireContext => ({ boundary: 'host.binding', payload });

// Live events (failure class "live event"): one counter for the whole client. An event that does not match is dropped
// and counted, and the host log hears about the first few and then one in fifty; a run of them tells the app (`subscribeLiveUpdateHealth`).
const liveHealth = createLiveHealth({
  onDropped: (error, count) => reportWireError(error, `live update ${count} dropped: `),
  onIgnored: (type) => reportDiagnostic('wire_unknown_event', `host.event: ignoring events of the type "${type.slice(0, 40)}", which this UI does not know`),
});

/** Checks one event against its schema; a bad one is dropped and counted, never thrown inside the event callback. */
function liveEvent<S extends StandardSchemaV1>(schema: S, payload: string, value: unknown, onValid: (event: InferOutput<S>) => void): void {
  try {
    onValid(parseWire(schema, value, { boundary: 'host.event', payload }));
  } catch (error) {
    if (!isWireError(error)) throw error;
    liveHealth.dropped(error);
  }
}

function subscribeChecked<S extends StandardSchemaV1>(event: string, schema: S, onValid: (value: InferOutput<S>) => void): () => void {
  return onHostEvent(event, (value) => liveEvent(schema, event, value, onValid));
}

// Wails v3 delivers each event as a WailsEvent; what the host emitted is its `data` (apps/desktop/wailsapp.go emitEvent), which is
// what every subscriber below checks. The name is the host's; the sender (a window name) is not used.
function onHostEvent(event: string, onPayload: (payload: unknown) => void): () => void {
  return Events.On(event, (wailsEvent) => onPayload(wailsEvent.data));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

// The host relays each sidecar line as a JSON value; tolerate the string form too so a transport change cannot silently drop the
// whole stream. A type the UI does not know is a newer sidecar: ignored and named once, not counted as a failure.
function subscribeTeleprompterEvents(onEvent: (event: InferOutput<typeof teleprompterEventSchema>) => void): () => void {
  return onHostEvent('teleprompter:event', (payload) => {
    let value: unknown = payload;
    if (typeof payload === 'string') {
      try {
        value = JSON.parse(payload);
      } catch {
        liveHealth.dropped(new WireError('host.event', 'teleprompter:event', [{ path: '(root)', message: 'not valid JSON' }]));
        return;
      }
    }
    if (isRecord(value) && typeof value.type === 'string' && !TELEPROMPTER_EVENT_TYPES.has(value.type)) {
      liveHealth.ignored(value.type);
      return;
    }
    liveEvent(teleprompterEventSchema, 'teleprompter:event', value, onEvent);
  });
}

/** A Wails string binding: the host sends JSON text, and it is checked against `schema` before anything reads it. */
async function decode<S extends StandardSchemaV1>(schema: S, payload: string, request: Promise<string>): Promise<InferOutput<S>> {
  const text = await hostResult(request, payload);
  return checked(() => parseWireJson(schema, text, bindingContext(payload)));
}

/** `TeleprompterStart` goes to the host as `Record<string, string>` (options.go-style flat map); `startWord` is the one non-string field. */
function toStartOptions({ startWord, ...rest }: TeleprompterStartOptions): Record<string, string> {
  // Either `chapter` or `credits` is set; the other is absent, so dropping undefined keeps the map flat strings.
  const flat = Object.fromEntries(Object.entries(rest).filter((entry): entry is [string, string] => entry[1] !== undefined));
  return startWord === undefined ? flat : { ...flat, startWord: String(startWord) };
}

/** Ready and Bootstrap are the two bindings that return an object, not JSON text. */
async function decodeObject<S extends StandardSchemaV1>(schema: S, payload: string, request: Promise<unknown>): Promise<InferOutput<S>> {
  const value = await hostResult(request, payload);
  return checked(() => parseWire(schema, value, bindingContext(payload)));
}

// This is intentionally an adapter, not a second component-facing API. The
// TypeScript contracts and mock client remain stable while transport moves
// from REST/SSE to Wails' generated Go binding and runtime events.
export const wailsClient: NarrationApi = {
  ready: () => decodeObject(readySchema, 'Ready', host.Ready()),
  bootstrap: () => decodeObject(bootstrapSchema, 'Bootstrap', host.Bootstrap()),
  selectManuscript: () => decode(fileSelectionSchema, 'ManuscriptSelectFile', host.ManuscriptSelectFile()),
  manuscriptBeginImport: (path) => decode(fileSelectionSchema, 'ManuscriptBeginImport', host.ManuscriptBeginImport(path)),
  manuscriptImportState: (jobId) => decode(workJobSchema, 'ManuscriptImportState', host.ManuscriptImportState(jobId)),
  manuscriptImportPreview: (jobId, options) =>
    decode(workJobSchema, 'ManuscriptImportPreview', host.ManuscriptImportPreview(jobId, options.markdownHeadingLevel)),
  manuscriptImportCommit: (jobId, options) =>
    decode(
      workJobSchema,
      'ManuscriptImportCommit',
      host.ManuscriptImportCommit(
        jobId,
        options.confirmedReset,
        options.selection?.sectionKinds ?? {},
        options.selection?.characterCandidateIds ?? [],
        options.selection?.subtitleOverrides ?? {},
      ),
    ),
  manuscriptImportCancel: (jobId) => decode(voidResult, 'ManuscriptImportCancel', host.ManuscriptImportCancel(jobId)),
  saveSettings: (tool, scope, values) => decode(bootstrapSchema, 'SystemSaveSettings', host.SystemSaveSettings(tool, scope, values)),
  settingsForScope: (scope) => decode(settingsForScopeSchema, 'SystemSettingsForScope', host.SystemSettingsForScope(scope)),
  guideBuild: (options) => decode(guideBuildResultSchema, 'GuideBuild', host.GuideBuild(options?.rulesOnly ?? false)),
  guideBuildState: () => decode(workJobSchema, 'GuideBuildState', host.GuideBuildState()),
  clearProjectData: () => decode(voidResult, 'ManuscriptClearProjectData', host.ManuscriptClearProjectData(true)),
  guideEntities: () => decode(guideEntitiesSchema, 'GuideEntities', host.GuideEntities()),
  guideEdit: (id, values) => decode(voidResult, 'GuideEdit', host.GuideEdit(id, values)),
  guideSetLocked: (id, locked) => decode(voidResult, 'GuideSetLocked', host.GuideSetLocked(id, locked)),
  guideRescan: (id) => decode(voidResult, 'GuideRescan', host.GuideRescan(id)),
  guideCreate: (name, category, aliases) => decode(guideCreatedSchema, 'GuideCreate', host.GuideCreate(name, category, aliases)).then((value) => value.id),
  guideMerge: (sourceId, targetId) => decode(guideMergeResultSchema, 'GuideMerge', host.GuideMerge(sourceId, targetId)),
  guideUnmerge: (undoId) => decode(voidResult, 'GuideUnmerge', host.GuideUnmerge(undoId)),
  guideDelete: (id) => decode(voidResult, 'GuideDelete', host.GuideDelete(id)),
  guideRelate: (id, otherId, label) => decode(voidResult, 'GuideRelate', host.GuideRelate(id, otherId, label)),
  guideUnrelate: (id, otherId, label) => decode(voidResult, 'GuideUnrelate', host.GuideUnrelate(id, otherId, label)),
  guidePreview: (id, aliasIndex) => decode(guidePreviewSchema, 'GuidePreview', host.GuidePreview(id, aliasIndex ?? null)),
  guidePronounce: (id, source, aliasIndex) => decode(voidResult, 'GuidePronounce', host.GuidePronounce(id, aliasIndex ?? null, source)),
  guidePronounceUser: (id, ipa, aliasIndex) => decode(voidResult, 'GuidePronounceUser', host.GuidePronounceUser(id, aliasIndex ?? null, ipa)),
  guidePronunciationUseAlternate: (id, aliasIndex) =>
    decode(voidResult, 'GuidePronunciationUseAlternate', host.GuidePronunciationUseAlternate(id, aliasIndex ?? null)),
  guideDialogueCues: () => decode(guideDialogueCuesSchema, 'GuideDialogueCues', host.GuideDialogueCues()),
  guideCorrectCue: (cueId, speakerEntityId) => decode(voidResult, 'GuideCorrectCue', host.GuideCorrectCue(cueId, speakerEntityId)),
  guideMarkReviewed: (id, aliasIndex) => decode(voidResult, 'GuideMarkReviewed', host.GuideMarkReviewed(id, aliasIndex ?? null)),
  guideFlagReview: (id, aliasIndex) => decode(voidResult, 'GuideFlagReview', host.GuideFlagReview(id, aliasIndex ?? null)),
  guideSetSpeakerColor: (id, index) => decode(voidResult, 'GuideSetSpeakerColor', host.GuideSetSpeakerColor(id, index)),
  guideTypes: () => decode(guideTypesSchema, 'GuideTypes', host.GuideTypes()),
  guideTypeAdd: (name) => decode(voidResult, 'GuideTypeAdd', host.GuideTypeAdd(name)),
  guideTypeRename: (name, to) => decode(voidResult, 'GuideTypeRename', host.GuideTypeRename(name, to)),
  guideTypeSetColour: (name, colour) => decode(voidResult, 'GuideTypeSetColour', host.GuideTypeSetColour(name, colour)),
  guideTypeSetSpeaks: (name, speaks) => decode(voidResult, 'GuideTypeSetSpeaks', host.GuideTypeSetSpeaks(name, speaks)),
  guideTypeRemove: (name) => decode(voidResult, 'GuideTypeRemove', host.GuideTypeRemove(name)),
  characterListRegions: () => decode(characterRegionsSchema, 'CharacterListRegions', host.CharacterListRegions()),
  characterApprove: (characterId, regionGuid, note) =>
    decode(characterReferenceSchema, 'CharacterApprove', host.CharacterApprove(characterId, regionGuid, note ?? '')),
  characterRevoke: (id) => decode(voidResult, 'CharacterRevoke', host.CharacterRevoke(id)),
  characterReferences: () => decode(approvedCharacterReferencesSchema, 'CharacterReferences', host.CharacterReferences()),
  characterRemoveVoiceData: () => decode(voidResult, 'CharacterRemoveVoiceData', host.CharacterRemoveVoiceData()),
  seriesVoiceBible: () => decode(seriesVoiceBibleSchema, 'SeriesVoiceBible', host.SeriesVoiceBible()),
  seriesList: () => decode(seriesListSchema, 'SeriesList', host.SeriesList()),
  seriesSave: (id, name, memberProjectPaths) => decode(seriesSchema, 'SeriesSave', host.SeriesSave(id, name, memberProjectPaths)),
  seriesDelete: (id) => decode(voidResult, 'SeriesDelete', host.SeriesDelete(id)),
  ttsCatalog: () => decode(ttsCatalogSchema, 'TtsCatalog', host.TtsCatalog()),
  ttsInstall: (voiceId) => decode(ttsInstallJobSchema, 'TtsInstall', host.TtsInstall(voiceId)),
  ttsInstallState: (jobId) => decode(ttsInstallJobSchema, 'TtsInstallState', host.TtsInstallState(jobId)),
  ttsInstallCancel: (jobId) => decode(ttsInstallJobSchema, 'TtsInstallCancel', host.TtsInstallCancel(jobId)),
  ttsRemove: (voiceId) => decode(voidResult, 'TtsRemove', host.TtsRemove(voiceId)),
  whisperCatalog: () => decode(whisperCatalogSchema, 'WhisperCatalog', host.WhisperCatalog()),
  whisperInstall: (modelId) => decode(whisperInstallJobSchema, 'WhisperInstall', host.WhisperInstall(modelId)),
  whisperInstallState: (jobId) => decode(whisperInstallJobSchema, 'WhisperInstallState', host.WhisperInstallState(jobId)),
  whisperInstallCancel: (jobId) => decode(whisperInstallJobSchema, 'WhisperInstallCancel', host.WhisperInstallCancel(jobId)),
  whisperRemove: (modelId) => decode(voidResult, 'WhisperRemove', host.WhisperRemove(modelId)),
  assetsList: () => decode(assetCatalogSchema, 'AssetsList', host.AssetsList()),
  assetsInstall: (kind, id) => decode(assetInstallJobSchema, 'AssetsInstall', host.AssetsInstall(kind, id)),
  assetsInstallState: (jobId) => decode(assetInstallJobSchema, 'AssetsInstallState', host.AssetsInstallState(jobId)),
  assetsInstallCancel: (jobId) => decode(assetInstallJobSchema, 'AssetsInstallCancel', host.AssetsInstallCancel(jobId)),
  assetsVerify: (kind, id) => decode(assetVerifyResultSchema, 'AssetsVerify', host.AssetsVerify(kind, id)),
  assetsRemove: (kind, id) => decode(voidResult, 'AssetsRemove', host.AssetsRemove(kind, id)),
  transcriptStart: (options) => decode(startResultSchema, 'TranscriptStart', host.TranscriptStart(options)),
  transcriptCancel: () => decode(voidResult, 'TranscriptCancel', host.TranscriptCancel()),
  transcriptReset: () => decode(voidResult, 'TranscriptReset', host.TranscriptReset()),
  transcriptLastCompleted: () => decode(lastCompletedSchema, 'TranscriptLastCompleted', host.TranscriptLastCompleted()),
  transcriptAddEquivalence: (id) => decode(equivalenceSchema, 'TranscriptAddEquivalence', host.TranscriptAddEquivalence(id)).then((value) => value.message),
  transcriptJump: (id) => decode(voidResult, 'TranscriptJump', host.TranscriptJump(id)),
  transcriptExportMarkers: () => decode(voidResult, 'TranscriptExportMarkers', host.TranscriptExportMarkers()),
  transcriptSuggestHints: () => decode(hintSuggestionsSchema, 'TranscriptSuggestHints', host.TranscriptSuggestHints()),
  transcriptHints: () => decode(hintsSchema, 'TranscriptHints', host.TranscriptHints()),
  transcriptSaveHints: (accepted) => decode(voidResult, 'TranscriptSaveHints', host.TranscriptSaveHints(accepted)),
  updateStatus: () => decode(updateStatusSchema, 'UpdateStatus', host.UpdateStatus()),
  updateCheck: () => decode(updateStatusSchema, 'UpdateCheck', host.UpdateCheck()),
  updateDownload: () => decode(updateJobSchema, 'UpdateDownload', host.UpdateDownload()),
  updateJobState: (jobId) => decode(updateJobSchema, 'UpdateJobState', host.UpdateJobState(jobId)),
  updateInstall: (jobId) => decode(updateJobSchema, 'UpdateInstall', host.UpdateInstall(jobId)),
  updateShowDownload: () => decode(voidResult, 'UpdateShowDownload', host.UpdateShowDownload()),
  updateJobCancel: (jobId) => decode(updateJobSchema, 'UpdateJobCancel', host.UpdateJobCancel(jobId)),
  updateOpenNotes: () => decode(voidResult, 'UpdateOpenNotes', host.UpdateOpenNotes()),
  subscribeUpdate: (onStatus) => subscribeChecked('update:status', updateStatusSchema, onStatus),
  reportClientDiagnostic: (kind, message) => decode(voidResult, 'SystemReportDiagnostic', host.SystemReportDiagnostic(kind, message)),
  systemNotify: (kind, title, body) => decode(voidResult, 'SystemNotify', host.SystemNotify(kind, title, body)),
  systemLookup: (word) => decode(dictionaryLookupResultSchema, 'SystemLookup', host.SystemLookup(word)),
  systemOpenLogFolder: () => decode(voidResult, 'SystemOpenLogFolder', host.SystemOpenLogFolder()),
  // Error-only Go bindings (apps/desktop/bindings_companion.go): Wails resolves them with no payload, so there is nothing to
  // check beyond the error `hostResult` already turns into text.
  companionModeEnter: async () => {
    await hostResult(host.CompanionModeEnter());
  },
  companionModeExit: async () => {
    await hostResult(host.CompanionModeExit());
  },
  systemCopyDiagnostics: (scope) => decode(copyDiagnosticsResultSchema, 'SystemCopyDiagnostics', host.SystemCopyDiagnostics(scope)),
  windowZoom: () => decode(windowZoomSchema, 'WindowZoom', host.WindowZoom()),
  windowSetZoom: (factor) => decode(windowZoomSchema, 'WindowSetZoom', host.WindowSetZoom(factor)),
  windowSaveZoom: (level) => decode(voidResult, 'WindowSaveZoom', host.WindowSaveZoom(level)),
  subscribeProjectAttach: (onUpdate) => subscribeChecked('system:attached', projectAttachStateSchema, onUpdate),
  subscribeLiveUpdateHealth: (onDegraded) => liveHealth.subscribe(onDegraded),
  subscribeNotices: (onNotice) => subscribeChecked('system:notice', noticeSchema, (event) => onNotice(event.text)),
  subscribeJobEnded: (onEnded) => subscribeChecked('job:ended', jobEndedSchema, onEnded),
  manuscriptChapters: () => decode(chaptersSchema, 'ManuscriptChapters', host.ManuscriptChapters()),
  manuscriptReader: () => decode(readerSchema, 'ManuscriptReader', host.ManuscriptReader()),
  readerState: () => decode(readerStateSchema, 'ManuscriptReaderState', host.ManuscriptReaderState()),
  manuscriptParagraphs: (chapter) => decode(paragraphsSchema, 'ManuscriptParagraphs', host.ManuscriptParagraphs(chapter)),
  manuscriptSearch: (query) => decode(searchHitsSchema, 'ManuscriptSearch', host.ManuscriptSearch(query)),
  manuscriptSetChapterStatus: (chapter, status) => decode(chapterSchema, 'ManuscriptSetChapterStatus', host.ManuscriptSetChapterStatus(chapter, status)),
  manuscriptSetChapterKind: (chapterId, kind) => decode(chapterKindResultSchema, 'ManuscriptSetChapterKind', host.ManuscriptSetChapterKind(chapterId, kind)),
  noteList: (chapter) => decode(notesSchema, 'ManuscriptNotes', host.ManuscriptNotes(chapter ?? '')),
  bookmarksList: () => decode(bookmarksSchema, 'BookmarksList', host.BookmarksList()),
  bookmarksAdd: (chapterId, paragraphId, offset) => decode(spotBookmarkSchema, 'BookmarksAdd', host.BookmarksAdd(chapterId, paragraphId, offset)),
  bookmarksUpdate: (id, label, note) => decode(spotBookmarkSchema, 'BookmarksUpdate', host.BookmarksUpdate(id, label, note)),
  bookmarksRemove: (id) => decode(bookmarksSchema, 'BookmarksRemove', host.BookmarksRemove(id)),
  passageMapRecordRun: (chapterId, run) => decode(passageMapSchema, 'PassageMapRecordRun', host.PassageMapRecordRun(chapterId, run)),
  passageMapList: (chapterId) => decode(passageMapSchema, 'PassageMapList', host.PassageMapList(chapterId)),
  editingAcceptedList: (chapterId) => decode(acceptedWordsSchema, 'EditingAcceptedList', host.EditingAcceptedList(chapterId)),
  editingAccept: (chapterId, keys) => decode(acceptedWordsChangeSchema, 'EditingAccept', host.EditingAccept(chapterId, keys)),
  editingUnaccept: (chapterId, keys) => decode(acceptedWordsChangeSchema, 'EditingUnaccept', host.EditingUnaccept(chapterId, keys)),
  marksList: () => decode(marksSchema, 'MarksList', host.MarksList()),
  marksAdd: (chapterId, paragraphId, start, end, type, text) => decode(markSchema, 'MarksAdd', host.MarksAdd(chapterId, paragraphId, start, end, type, text)),
  marksRemove: (id) => decode(marksSchema, 'MarksRemove', host.MarksRemove(id)),
  marksSaveTypes: (types, removeUses) => decode(marksSchema, 'MarksSaveTypes', host.MarksSaveTypes(types, removeUses)),
  scriptPrepList: () => decode(scriptPrepSchema, 'ScriptPrepList', host.ScriptPrepList()),
  scriptPrepSetChapter: (chapterId, state) => decode(scriptPrepChapterSchema, 'ScriptPrepSetChapter', host.ScriptPrepSetChapter(chapterId, state)),
  scriptWordFlag: (chapterId, paragraphId, start, end) => decode(scriptWordSchema, 'ScriptWordFlag', host.ScriptWordFlag(chapterId, paragraphId, start, end)),
  scriptWordSay: (word, say, source) => decode(scriptWordSchema, 'ScriptWordSay', host.ScriptWordSay(word, say, source)),
  scriptWordUnflag: (flagId) => decode(scriptWordSchema, 'ScriptWordUnflag', host.ScriptWordUnflag(flagId)),
  extractionList: () => decode(extractionSuggestionsSchema, 'ExtractionList', host.ExtractionList()),
  extractionAccept: (id, text) => decode(extractionDecisionSchema, 'ExtractionAccept', host.ExtractionAccept(id, text ?? null)),
  extractionReject: (id) => decode(extractionDecisionSchema, 'ExtractionReject', host.ExtractionReject(id)),
  extractionReview: (id) => decode(extractionDecisionSchema, 'ExtractionReview', host.ExtractionReview(id)),
  extractionReopen: (id) => decode(extractionDecisionSchema, 'ExtractionReopen', host.ExtractionReopen(id)),
  extractionSources: () => decode(extractionSourcesSchema, 'ExtractionSources', host.ExtractionSources()),
  extractionScan: (sourceIds) => decode(extractionScanJobSchema, 'ExtractionScan', host.ExtractionScan(sourceIds)),
  extractionScanState: () => decode(extractionScanJobSchema, 'ExtractionScanState', host.ExtractionScanState()),
  extractionScanCancel: () => decode(extractionScanJobSchema, 'ExtractionScanCancel', host.ExtractionScanCancel()),
  extractionImportPreview: (text, hint) => decode(extractionImportPlanSchema, 'ExtractionImportPreview', host.ExtractionImportPreview(text, hint ?? '')),
  extractionImportCommit: (text, hint) => decode(extractionImportResultSchema, 'ExtractionImportCommit', host.ExtractionImportCommit(text, hint ?? '')),
  extractionImportUndo: (ids) => decode(extractionImportUndoneSchema, 'ExtractionImportUndo', host.ExtractionImportUndo(ids)),
  extractionImportPrompt: (format) => decode(extractionImportPromptSchema, 'ExtractionImportPrompt', host.ExtractionImportPrompt(format)),
  marksReply: (id, who, text) => decode(markSchema, 'MarksReply', host.MarksReply(id, who, text)),
  marksEditMessage: (id, index, text) => decode(markSchema, 'MarksEditMessage', host.MarksEditMessage(id, index, text)),
  marksDeleteMessage: (id, index) => decode(markThreadDeletedSchema, 'MarksDeleteMessage', host.MarksDeleteMessage(id, index)),
  marksRestoreMessage: (id, index, message) => decode(markSchema, 'MarksRestoreMessage', host.MarksRestoreMessage(id, index, message)),
  marksSetStatus: (id, status) => decode(markSchema, 'MarksSetStatus', host.MarksSetStatus(id, status)),
  editingCutsList: (chapterId) => decode(editCutsSchema, 'EditingCutsList', host.EditingCutsList(chapterId)),
  editingCutRecord: (chapterId, cut) => decode(editCutsChangeSchema, 'EditingCutRecord', host.EditingCutRecord(chapterId, cut)),
  editingCutRemove: (chapterId, id) => decode(editCutsChangeSchema, 'EditingCutRemove', host.EditingCutRemove(chapterId, id)),
  editingWordFxList: (chapterId) => decode(wordFxListSchema, 'EditingWordFxList', host.EditingWordFxList(chapterId)),
  editingWordFxRecord: (chapterId, fx) => decode(wordFxChangeSchema, 'EditingWordFxRecord', host.EditingWordFxRecord(chapterId, fx)),
  editingWordFxRemove: (chapterId, id) => decode(wordFxChangeSchema, 'EditingWordFxRemove', host.EditingWordFxRemove(chapterId, id)),
  editingWordFxBypass: (chapterId, id, bypassed) => decode(wordFxChangeSchema, 'EditingWordFxBypass', host.EditingWordFxBypass(chapterId, id, bypassed)),
  editingStacksList: (chapterId) => decode(stackListSchema, 'EditingStacksList', host.EditingStacksList(chapterId)),
  editingStackRecord: (chapterId, stack) => decode(stackChangeSchema, 'EditingStackRecord', host.EditingStackRecord(chapterId, stack)),
  editingStackRemove: (chapterId, passageId, takeIds) =>
    decode(stackChangeSchema, 'EditingStackRemove', host.EditingStackRemove(chapterId, passageId, takeIds)),
  editingRetryModeGet: (level, chapterId, passageId) =>
    decode(retryModeAnswerSchema, 'EditingRetryModeGet', host.EditingRetryModeGet(level, chapterId, passageId)),
  editingRetryModeSet: (level, chapterId, passageId, mode) =>
    decode(retryModeAnswerSchema, 'EditingRetryModeSet', host.EditingRetryModeSet(level, chapterId, passageId, mode)),
  subscribeTranscript: (onUpdate) => subscribeChecked('transcript:state', transcriptStateSchema, onUpdate),
  coverageStart: (chapterId, options) => decode(coverageStartResultSchema, 'CoverageStart', host.CoverageStart(chapterId, coverageStartOptions(options))),
  coverageGapAccept: (chapterId, gapId) => decode(findingSchema, 'CoverageGapAccept', host.CoverageGapAccept(chapterId, gapId)),
  coverageGapIgnore: (chapterId, gapId) => decode(voidResult, 'CoverageGapIgnore', host.CoverageGapIgnore(chapterId, gapId)),
  coverageGapReviews: (chapterId) => decode(coverageGapReviewsSchema, 'CoverageGapReviews', host.CoverageGapReviews(chapterId)),
  coverageEngines: () => decode(coverageEnginesSchema, 'CoverageEngines', host.CoverageEngines()),
  coverageState: () => decode(coverageStateSchema, 'CoverageState', host.CoverageState()),
  coverageCancel: () => decode(voidResult, 'CoverageCancel', host.CoverageCancel()),
  coverageResult: (chapterId) => decode(coverageResultSchema, 'CoverageResult', host.CoverageResult(chapterId)),
  stageRecommendations: () => decode(stageRecommendationsSchema, 'StageRecommendations', host.StageRecommendations()),
  stageConfirm: (chapterId, target, basisKey) => decode(stageDecisionResultSchema, 'StageConfirm', host.StageConfirm(chapterId, target, basisKey)),
  stageDismiss: (chapterId, target, basisKey) => decode(stageDecisionResultSchema, 'StageDismiss', host.StageDismiss(chapterId, target, basisKey)),
  stageRevert: (chapterId) => decode(stageDecisionResultSchema, 'StageRevert', host.StageRevert(chapterId)),
  proofingRenderState: (chapterId) => decode(proofingRenderSchema, 'ProofingRenderState', host.ProofingRenderState(chapterId)),
  proofingChooseRender: (chapterId) => decode(proofingChooseRenderResultSchema, 'ProofingChooseRender', host.ProofingChooseRender(chapterId)),
  proofingClearRender: (chapterId) => decode(proofingRenderSchema, 'ProofingClearRender', host.ProofingClearRender(chapterId)),
  productionOverview: () => decode(productionOverviewSchema, 'ProductionOverview', host.ProductionOverview()),
  productionStartTimer: (chapterId, stage) => decode(productionStartResultSchema, 'ProductionStartTimer', host.ProductionStartTimer(chapterId, stage)),
  productionStopTimer: () => decode(productionStopResultSchema, 'ProductionStopTimer', host.ProductionStopTimer()),
  productionStatusReport: (includeContractedAmount) =>
    decode(productionReportExportSchema, 'ProductionStatusReport', host.ProductionStatusReport(includeContractedAmount)),
  productionStatusReportPreview: (includeContractedAmount) =>
    decode(productionReportPreviewSchema, 'ProductionStatusReportPreview', host.ProductionStatusReportPreview(includeContractedAmount)),
  productionBurndown: () => decode(productionBurndownSchema, 'ProductionBurndown', host.ProductionBurndown()),
  subscribeCoverage: (onUpdate) => subscribeChecked('coverage:state', coverageStateSchema, onUpdate),
  editingStart: (documentId, chapterId, chapterTitle) =>
    decode(editingStartResultSchema, 'EditingStart', host.EditingStart(documentId, chapterId, chapterTitle)),
  editingState: () => decode(editingStateSchema, 'EditingState', host.EditingState()),
  editingCancel: () => decode(voidResult, 'EditingCancel', host.EditingCancel()),
  editingCandidates: (chapterId) => decode(editingCandidatesSchema, 'EditingCandidates', host.EditingCandidates(chapterId)),
  // EditingSourceChoice/EditingSetSourceChoice are not yet in wailsjs/.../host.ts - this sandbox has no
  // wails3 CLI to regenerate it (bindings_editing.go's own doc comment; `pnpm --dir apps/desktop bindings` fails the
  // same way here). host.EditingSourceChoice/EditingSetSourceChoice below type-check once that
  // regeneration adds them, the same shape every other bare-string binding above already has.
  editingSourceChoice: (chapterId) => decode(editingSourceChoiceSchema, 'EditingSourceChoice', host.EditingSourceChoice(chapterId)),
  editingSetSourceChoice: (chapterId, choice) => decode(editingSourceChoiceSchema, 'EditingSetSourceChoice', host.EditingSetSourceChoice(chapterId, choice)),
  levelMatchPreview: (chapterId, metric, targetValueDb, toleranceDb) =>
    decode(levelMatchPreviewResultSchema, 'LevelMatchPreview', host.LevelMatchPreview(chapterId, metric, targetValueDb, toleranceDb)),
  levelMatchApply: (chapterId, metric, targetValueDb, toleranceDb) =>
    decode(levelMatchApplyResultSchema, 'LevelMatchApply', host.LevelMatchApply(chapterId, metric, targetValueDb, toleranceDb)),
  workspaceAlignment: (chapterId) => decode(workspaceAlignmentResultSchema, 'WorkspaceAlignment', host.WorkspaceAlignment(chapterId)),
  workspaceGoTo: (chapterId, tokenIndex) => decode(findingNavigationSchema, 'WorkspaceGoTo', host.WorkspaceGoTo(chapterId, tokenIndex)),
  workspaceListFXChains: () => decode(workspaceFXChainsResultSchema, 'WorkspaceListFXChains', host.WorkspaceListFXChains()),
  workspaceTakes: (chapterId, firstToken, lastToken) =>
    decode(workspaceTakesResultSchema, 'WorkspaceTakes', host.WorkspaceTakes(chapterId, firstToken, lastToken)),
  workspaceTakeEvidence: (chapterId, firstToken, lastToken) =>
    decode(takeEvidenceResultSchema, 'WorkspaceTakeEvidence', host.WorkspaceTakeEvidence(chapterId, firstToken, lastToken)),
  workspaceTakesCompareStart: (chapterId, firstToken, lastToken) =>
    decode(takeComparisonJobSchema, 'WorkspaceTakesCompareStart', host.WorkspaceTakesCompareStart(chapterId, firstToken, lastToken)),
  workspaceUseTake: (chapterId, firstToken, lastToken, candidateId) =>
    decode(workspaceUseTakeResultSchema, 'WorkspaceUseTake', host.WorkspaceUseTake(chapterId, firstToken, lastToken, candidateId)),
  workspacePeaks: (chapterId) => decode(workspacePeaksResultSchema, 'WorkspacePeaks', host.WorkspacePeaks(chapterId)),
  workspaceSnap: (chapterId, itemGuid, sourceTime) => decode(workspaceSnapResultSchema, 'WorkspaceSnap', host.WorkspaceSnap(chapterId, itemGuid, sourceTime)),
  previewCandidates: () => decode(previewResultSchema, 'PreviewCandidates', host.PreviewCandidates()),
  previewPin: () => decode(pinnedPreviewSchema, 'PreviewPin', host.PreviewPin()),
  previewPinSet: (chapterId, paragraphIds) => decode(pinnedPreviewSchema, 'PreviewPinSet', host.PreviewPinSet(chapterId, paragraphIds)),
  previewPinAdjust: (edge, grow) => decode(pinnedPreviewSchema, 'PreviewPinAdjust', host.PreviewPinAdjust(edge, grow)),
  previewPinClear: () => decode(pinnedPreviewSchema, 'PreviewPinClear', host.PreviewPinClear()),
  productionPlan: () => decode(productionPlanSchema, 'ProductionPlan', host.ProductionPlan()),
  setProductionDeadline: (deadline, contractedAmount) =>
    decode(productionPlanSchema, 'ProductionSetDeadline', host.ProductionSetDeadline(deadline, contractedAmount)),
  setProductionPayment: (payment) => decode(productionPlanSchema, 'ProductionSetPayment', host.ProductionSetPayment(payment)),
  setProductionRateBasis: (basis) => decode(productionPlanSchema, 'ProductionSetRateBasis', host.ProductionSetRateBasis(basis)),
  saveProductionMilestones: (milestones) => decode(productionPlanSchema, 'ProductionSaveMilestones', host.ProductionSaveMilestones(milestones)),
  lineIdentityStamp: (rows, overwrite) => decode(lineIdentityStartResultSchema, 'LineIdentityStamp', host.LineIdentityStamp(rows, overwrite)),
  lineIdentityRead: () => decode(lineIdentityStartResultSchema, 'LineIdentityRead', host.LineIdentityRead()),
  lineIdentityState: () => decode(lineIdentityStateSchema, 'LineIdentityState', host.LineIdentityState()),
  subscribeLineIdentity: (onUpdate) => subscribeChecked('lineidentity:state', lineIdentityStateSchema, onUpdate),
  pickupsImport: (csvText) => decode(pickupsImportResultSchema, 'PickupsImport', host.PickupsImport(csvText)),
  pickupsExport: () => decode(pickupsStartResultSchema, 'PickupsExport', host.PickupsExport()),
  pickupsNext: () => decode(pickupsStartResultSchema, 'PickupsNext', host.PickupsNext()),
  pickupsResolve: (position) => decode(pickupsStartResultSchema, 'PickupsResolve', host.PickupsResolve(position)),
  pickupsReopen: (position) => decode(pickupsStartResultSchema, 'PickupsReopen', host.PickupsReopen(position)),
  pickupsListMarkers: () => decode(pickupsStartResultSchema, 'PickupsListMarkers', host.PickupsListMarkers()),
  pickupsCount: () => decode(pickupsStartResultSchema, 'PickupsCount', host.PickupsCount()),
  pickupsState: () => decode(pickupsStateSchema, 'PickupsState', host.PickupsState()),
  pickupsList: () => decode(pickupListSchema, 'PickupsList', host.PickupsList()),
  pickupsAdd: (chapterId, time, line) => decode(pickupListSchema, 'PickupsAdd', host.PickupsAdd(chapterId, time, line)),
  pickupsRemove: (id) => decode(pickupListSchema, 'PickupsRemove', host.PickupsRemove(id)),
  pickupsSetIncluded: (id, included) => decode(pickupListSchema, 'PickupsSetIncluded', host.PickupsSetIncluded(id, included)),
  pickupsSetDone: (id, done) => decode(pickupListSchema, 'PickupsSetDone', host.PickupsSetDone(id, done)),
  subscribePickups: (onUpdate) => subscribeChecked('pickups:state', pickupsStateSchema, onUpdate),
  renderConfigConfigure: (outputFolder) => decode(renderConfigStartResultSchema, 'RenderConfigConfigure', host.RenderConfigConfigure(outputFolder)),
  renderConfigSuggestFolder: () => decode(renderConfigSuggestedFolderSchema, 'RenderConfigSuggestFolder', host.RenderConfigSuggestFolder()),
  renderConfigState: () => decode(renderConfigStateSchema, 'RenderConfigState', host.RenderConfigState()),
  subscribeRenderConfig: (onUpdate) => subscribeChecked('renderconfig:state', renderConfigStateSchema, onUpdate),
  cleanupToolsLaunch: (tool) => decode(cleanupToolsStartResultSchema, 'CleanupToolsLaunch', host.CleanupToolsLaunch(tool)),
  cleanupToolsState: () => decode(cleanupToolsStateSchema, 'CleanupToolsState', host.CleanupToolsState()),
  subscribeCleanupTools: (onUpdate) => subscribeChecked('cleanuptools:state', cleanupToolsStateSchema, onUpdate),
  projectStateCheck: () => decode(projectStateStartResultSchema, 'ProjectStateCheck', host.ProjectStateCheck()),
  projectStateChangedSince: (current, baseline) =>
    decode(projectStateChangedSchema, 'ProjectStateChangedSince', host.ProjectStateChangedSince(current, baseline)),
  projectStateState: () => decode(projectStateStateSchema, 'ProjectStateState', host.ProjectStateState()),
  subscribeProjectState: (onUpdate) => subscribeChecked('projectstate:state', projectStateStateSchema, onUpdate),
  retakeLanesList: () => decode(retakeLanesListSchema, 'RetakeLanesList', host.RetakeLanesList()),
  retakeLanesPick: (lineId, itemGuid) => decode(retakeLanesStartResultSchema, 'RetakeLanesPick', host.RetakeLanesPick(lineId, itemGuid)),
  retakeLanesState: () => decode(retakeLanesStateSchema, 'RetakeLanesState', host.RetakeLanesState()),
  subscribeRetakeLanes: (onUpdate) => subscribeChecked('retakelanes:state', retakeLanesStateSchema, onUpdate),
  chapterTagsPreview: () => decode(chapterTagsPreviewSchema, 'ChapterTagsPreview', host.ChapterTagsPreview()),
  chapterTagsEmbed: (destPath) => decode(chapterTagsEmbedResultSchema, 'ChapterTagsEmbed', host.ChapterTagsEmbed(destPath)),
  projectRecents: () => decode(recentProjectsSchema, 'ProjectRecents', host.ProjectRecents()),
  selectProjectFolder: () => decode(projectFolderSelectionSchema, 'ProjectSelectFolder', host.ProjectSelectFolder()),
  switchProject: (path, name) => decode(projectSwitchResultSchema, 'ProjectSwitch', host.ProjectSwitch(path, name ?? '')),
  createProject: (parent, name) => decode(projectSwitchResultSchema, 'ProjectCreateIn', host.ProjectCreateIn(parent, name)),
  projectDefaultLocation: () => decode(projectDefaultLocationSchema, 'ProjectDefaultLocation', host.ProjectDefaultLocation()),
  removeRecentProject: (path) => decode(recentProjectsSchema, 'ProjectRemoveRecent', host.ProjectRemoveRecent(path)),
  linkDawFile: () => decode(dawLinkResultSchema, 'ProjectLinkDawFile', host.ProjectLinkDawFile()),
  launchDaw: () => decode(dawLaunchResultSchema, 'DawLaunch', host.DawLaunch()),
  creditsTemplates: () => decode(creditTemplatesSchema, 'CreditsTemplates', host.CreditsTemplates()),
  saveCreditsTemplate: (id, kind, name, body) => decode(creditTemplateSchema, 'CreditsSaveTemplate', host.CreditsSaveTemplate(id, kind, name, body)),
  duplicateCreditsTemplate: (id) => decode(creditTemplateSchema, 'CreditsDuplicateTemplate', host.CreditsDuplicateTemplate(id)),
  deleteCreditsTemplate: (id) => decode(voidResult, 'CreditsDeleteTemplate', host.CreditsDeleteTemplate(id)),
  creditsProjectValues: () => decode(creditsProjectValuesResultSchema, 'CreditsProjectValues', host.CreditsProjectValues()),
  creditsSetupState: () => decode(creditsSetupStateSchema, 'CreditsSetupState', host.CreditsSetupState()),
  creditsSetupDismiss: (scope) => decode(creditsSetupStateSchema, 'CreditsSetupDismiss', host.CreditsSetupDismiss(scope)),
  creditsSetupSave: (values) =>
    decode(
      creditsSetupStateSchema,
      'CreditsSetupSave',
      host.CreditsSetupSave(Object.fromEntries(Object.entries(values).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))),
    ),
  saveCreditsProjectValues: (values) =>
    decode(
      creditsProjectValuesResultSchema.shape.values,
      'CreditsSaveProjectValues',
      host.CreditsSaveProjectValues(
        values.title ?? '',
        values.subtitle ?? '',
        values.author ?? '',
        values.series ?? '',
        values.bookNumber ?? '',
        values.copyright ?? '',
        values.year ?? '',
        values.copyrightHolder ?? '',
        values.publisher ?? '',
        values.narrator ?? '',
      ),
    ),
  creditsPreview: (body) => decode(creditsRenderResultSchema, 'CreditsPreview', host.CreditsPreview(body)),
  creditsChapterAnnouncements: (body) => decode(creditsAnnouncementsSchema, 'CreditsChapterAnnouncements', host.CreditsChapterAnnouncements(body)),
  creditsRetailSample: () => decode(retailSampleAnswerSchema, 'CreditsRetailSample', host.CreditsRetailSample()),
  saveCreditsRetailSample: (start, end) => decode(retailSampleAnswerSchema, 'CreditsSaveRetailSample', host.CreditsSaveRetailSample(start, end)),
  creditsStatuses: () => decode(creditsStatusesSchema, 'CreditsStatuses', host.CreditsStatuses()),
  setCreditsStatus: (kind, status) => decode(creditsStatusesSchema, 'CreditsSetStatus', host.CreditsSetStatus(kind, status)),
  creditsRecordedLengths: () => decode(creditsRecordedLengthsSchema, 'CreditsRecordedLengths', host.CreditsRecordedLengths()),
  dawCatalogList: () => decode(dawCatalogListSchema, 'DawCatalogList', host.DawCatalogList()),
  dawCatalogOpenDownloadPage: (id) => decode(voidResult, 'DawCatalogOpenDownloadPage', host.DawCatalogOpenDownloadPage(id)),
  pronunciationLookupOpen: (source, word) => decode(voidResult, 'PronunciationLookupOpen', host.PronunciationLookupOpen(source, word)),
  pronunciationCommonsAudioOpen: (word) => decode(voidResult, 'PronunciationCommonsAudioOpen', host.PronunciationCommonsAudioOpen(word)),
  pronunciationOnlineKeyStatus: () => decode(pronunciationOnlineKeyStatusSchema, 'PronunciationOnlineKeyStatus', host.PronunciationOnlineKeyStatus()),
  pronunciationOnlineKeySet: (key) => decode(pronunciationOnlineKeyStatusSchema, 'PronunciationOnlineKeySet', host.PronunciationOnlineKeySet(key)),
  pronunciationOnlineKeyClear: () => decode(pronunciationOnlineKeyStatusSchema, 'PronunciationOnlineKeyClear', host.PronunciationOnlineKeyClear()),
  pronunciationOnlineSignUpOpen: () => decode(voidResult, 'PronunciationOnlineSignUpOpen', host.PronunciationOnlineSignUpOpen()),
  pronunciationOnlineLookup: (word) => decode(pronunciationOnlineResultSchema, 'PronunciationOnlineLookup', host.PronunciationOnlineLookup(word)),
  pronunciationSources: () => decode(pronunciationSourcesSchema, 'PronunciationSources', host.PronunciationSources()),
  pronunciationCandidate: (word, source) => decode(pronunciationCandidateSchema, 'PronunciationCandidate', host.PronunciationCandidate(word, source)),

  dawCapabilities: () => decode(dawCapabilitiesSchema, 'DawCapabilities', host.DawCapabilities()),
  subscribeDawCapabilities: (onUpdate) => subscribeChecked('daw_capabilities_changed', dawCapabilitiesSchema, onUpdate),
  dawChoice: () => decode(dawChoiceSchema, 'DawChoice', host.DawChoice()),
  dawChoose: (daw) => decode(dawChoiceSchema, 'DawChoose', host.DawChoose(daw)),
  dawLinkFound: () => decode(dawChoiceSchema, 'DawLinkFound', host.DawLinkFound()),
  providerCapabilities: () => decode(providerCapabilitiesSchema, 'ProviderCapabilities', host.ProviderCapabilities()),
  masteringProviders: () => decode(masteringProvidersSchema, 'MasteringProviders', host.MasteringProviders()),
  masteringChooseProvider: (name) => decode(masteringProvidersSchema, 'MasteringChooseProvider', host.MasteringChooseProvider(name)),
  recorderState: () => decode(recorderStateSchema, 'RecorderState', host.RecorderState()),
  recorderChooseEngine: (engine) => decode(recorderStateSchema, 'RecorderChooseEngine', host.RecorderChooseEngine(engine)),
  recorderDevices: () => decode(recorderDevicesResultSchema, 'RecorderDevices', host.RecorderDevices()),
  recorderMeterStart: (device) => decode(recorderStateSchema, 'RecorderMeterStart', host.RecorderMeterStart(device)),
  recorderMeterStop: () => decode(recorderStateSchema, 'RecorderMeterStop', host.RecorderMeterStop()),
  recorderStart: (device) => decode(recorderStateSchema, 'RecorderStart', host.RecorderStart(device)),
  recorderStop: () => decode(recorderStateSchema, 'RecorderStop', host.RecorderStop()),
  recorderSetTakeLine: (takeName, entityId) => decode(recorderStateSchema, 'RecorderSetTakeLine', host.RecorderSetTakeLine(takeName, entityId)),
  recorderSetTakeKeeper: (takeName, keeper) => decode(recorderStateSchema, 'RecorderSetTakeKeeper', host.RecorderSetTakeKeeper(takeName, keeper)),
  subscribeRecorderState: (onUpdate) => subscribeChecked('recording:state', recorderStateSchema, onUpdate),
  subscribeRecorderLevel: (onLevel) => subscribeChecked('recording:level', recorderLevelSchema, onLevel),
  subscribeDawTransport: (onUpdate) => subscribeChecked('daw_transport_changed', dawTransportSchema, onUpdate),
  dawProjectState: () => decode(dawProjectStateSchema, 'DawProjectState', host.DawProjectState()),
  workspaceHideTakes: (chapterId, firstToken, lastToken, keepCandidateId) =>
    decode(dawResultSchema, 'WorkspaceHideTakes', host.WorkspaceHideTakes(chapterId, firstToken, lastToken, keepCandidateId)),
  dawRoll: (chapterId, at, confirmed) => decode(dawResultSchema, 'DawRoll', host.DawRoll(chapterId, at, confirmed)),
  dawDeleteRange: (chapterId, firstToken, lastToken, mode, fadeMs, padMs, roomTone) =>
    decode(dawResultSchema, 'DawDeleteRange', host.DawDeleteRange(chapterId, firstToken, lastToken, mode, fadeMs, padMs, roomTone)),
  dawTrimRange: (chapterId, itemId, start, end, fadeMs) => decode(dawResultSchema, 'DawTrimRange', host.DawTrimRange(chapterId, itemId, start, end, fadeMs)),
  dawApplyFxToRange: (chapterId, firstToken, lastToken, chainName, fadeMs) =>
    decode(dawResultSchema, 'DawApplyFxToRange', host.DawApplyFxToRange(chapterId, firstToken, lastToken, chainName, fadeMs)),
  dawRemoveFxFromRange: (chapterId, firstToken, lastToken, chainName) =>
    decode(dawResultSchema, 'DawRemoveFxFromRange', host.DawRemoveFxFromRange(chapterId, firstToken, lastToken, chainName)),
  dawFxRangeParams: (chapterId, firstToken, lastToken, chainName) =>
    decode(dawFxRangeSettingsSchema, 'DawFxRangeParams', host.DawFxRangeParams(chapterId, firstToken, lastToken, chainName)),
  dawSetFxRangeParam: (chapterId, firstToken, lastToken, chainName, fx, index, value) =>
    decode(dawResultSchema, 'DawSetFxRangeParam', host.DawSetFxRangeParam(chapterId, firstToken, lastToken, chainName, fx, index, value)),
  dawBypassFxRange: (chapterId, firstToken, lastToken, chainName, bypass) =>
    decode(dawResultSchema, 'DawBypassFxRange', host.DawBypassFxRange(chapterId, firstToken, lastToken, chainName, bypass)),
  dawCompareFxRange: (chapterId, firstToken, lastToken, chainName) =>
    decode(dawFxRangeCompareSchema, 'DawCompareFxRange', host.DawCompareFxRange(chapterId, firstToken, lastToken, chainName)),
  dawStopFxCompare: () => decode(dawResultSchema, 'DawStopFxCompare', host.DawStopFxCompare()),
  dawStackTakes: (chapterId, passageIds) => decode(dawResultSchema, 'DawStackTakes', host.DawStackTakes(chapterId, passageIds)),
  dawUnstackTakes: (chapterId, passageIds) => decode(dawResultSchema, 'DawUnstackTakes', host.DawUnstackTakes(chapterId, passageIds)),
  dawSplitTake: (chapterId, takeId, at) => decode(dawResultSchema, 'DawSplitTake', host.DawSplitTake(chapterId, takeId, at)),
  dawReduceRangeGain: (chapterId, takeId, stretches, reduceDb) =>
    decode(dawResultSchema, 'DawReduceRangeGain', host.DawReduceRangeGain(chapterId, takeId, stretches, reduceDb)),
  dawRepairClick: (chapterId, takeId, clicks) => decode(dawResultSchema, 'DawRepairClick', host.DawRepairClick(chapterId, takeId, clicks)),
  dawLastAction: (kind) => decode(dawLastActionSchema, 'DawLastAction', host.DawLastAction(kind)),
  dawUndoLast: (kind, steps) => decode(dawResultSchema, 'DawUndoLast', host.DawUndoLast(kind, steps)),
  dawMonitorLevel: () => decode(dawMonitorLevelSchema, 'DawMonitorLevel', host.DawMonitorLevel()),
  dawSetMonitorLevel: (level) => decode(dawMonitorLevelSchema, 'DawSetMonitorLevel', host.DawSetMonitorLevel(level)),
  dawBackupAround: (chapterId, firstToken, lastToken, label) =>
    decode(dawResultSchema, 'DawBackupAround', host.DawBackupAround(chapterId, firstToken, lastToken, label)),
  dawRestoreBackup: (backupId) => decode(dawResultSchema, 'DawRestoreBackup', host.DawRestoreBackup(backupId)),
  dawPreviewFileRange: (path, start, length) => decode(dawResultSchema, 'DawPreviewFileRange', host.DawPreviewFileRange(path, start, length)),
  dawStopFilePreview: () => decode(dawResultSchema, 'DawStopFilePreview', host.DawStopFilePreview()),
  dawRevealFile: (path) => decode(dawResultSchema, 'DawRevealFile', host.DawRevealFile(path)),
  masterPlayQuietest: (fileId) => decode(dawResultSchema, 'MasterPlayQuietest', host.MasterPlayQuietest(fileId)),
  masterOpenInDaw: (fileId) => decode(dawResultSchema, 'MasterOpenInDaw', host.MasterOpenInDaw(fileId)),
  dawBackups: () => decode(dawBackupsFileSchema, 'DawBackups', host.DawBackups()),
  subscribeDawProjectState: (onUpdate) => subscribeChecked('daw_project_state_changed', dawProjectStateSchema, onUpdate),
  tracksDiscover: () => decode(tracksDiscoverySchema, 'TracksDiscover', host.TracksDiscover()),
  tracksSelect: (path) => decode(tracksDiscoverySchema, 'TracksSelect', host.TracksSelect(path)),
  tracksList: () => decode(tracksProjectSchema, 'TracksList', host.TracksList()),
  chapterTrackMapList: () => decode(chapterTrackMappingSchema, 'ChapterTrackMapList', host.ChapterTrackMapList()),
  chapterTrackMapConfirm: (trackGuid, chapterId) => decode(trackMappingSchema, 'ChapterTrackMapConfirm', host.ChapterTrackMapConfirm(trackGuid, chapterId)),
  chapterTrackMapClear: (trackGuid) => decode(chapterTrackMappingSchema, 'ChapterTrackMapClear', host.ChapterTrackMapClear(trackGuid)),
  chapterTrackSet: (chapterId, trackGuid) => decode(chapterTrackSetSchema, 'ChapterTrackSet', host.ChapterTrackSet(chapterId, trackGuid)),
  chapterTrackUnlink: (chapterId) => decode(chapterTrackMappingSchema, 'ChapterTrackUnlink', host.ChapterTrackUnlink(chapterId)),
  chapterSyncState: () => decode(chapterSyncStateSchema, 'ChapterSyncState', host.ChapterSyncState()),
  chapterSyncPreview: () => decode(chapterSyncPreviewSchema, 'ChapterSyncPreview', host.ChapterSyncPreview()),
  chapterSyncSetEnabled: (on) => decode(chapterSyncStateSchema, 'ChapterSyncSetEnabled', host.ChapterSyncSetEnabled(on)),
  chapterSyncUndo: (trackGuid) => decode(chapterSyncStateSchema, 'ChapterSyncUndo', host.ChapterSyncUndo(trackGuid)),
  subscribeChapterSync: (onUpdate) => subscribeChecked('chaptersync:state', chapterSyncStateSchema, onUpdate),
  chapterTrackLinks: () => decode(chapterTrackLinksSchema, 'ChapterTrackLinks', host.ChapterTrackLinks()),
  trackSelectInReaper: (trackGuid) => decode(trackSelectResultSchema, 'TrackSelectInReaper', host.TrackSelectInReaper(trackGuid)),
  chapterRegionsPreview: (openingTrackGuid, closingTrackGuid) =>
    decode(chapterRegionPlanSchema, 'ChapterRegionsPreview', host.ChapterRegionsPreview(openingTrackGuid, closingTrackGuid)),
  chapterRegionsCreate: (openingTrackGuid, closingTrackGuid, update) =>
    decode(chapterRegionsCreatedSchema, 'ChapterRegionsCreate', host.ChapterRegionsCreate(openingTrackGuid, closingTrackGuid, update)),
  chapterTrackMatch: (chapterId) => decode(chapterTrackMatchSchema, 'ChapterTrackMatch', host.ChapterTrackMatch(chapterId)),
  chapterSuggestion: () => decode(chapterSuggestionSchema, 'ChapterSuggestion', host.ChapterSuggestion()),
  chaptersForTracks: (guids) => decode(chaptersForTracksSchema, 'ChaptersForTracks', host.ChaptersForTracks(guids)),
  findingsList: (query) => decode(findingsPageSchema, 'FindingsList', host.FindingsList(query)),
  findingsGet: (id) => decode(findingSchema, 'FindingsGet', host.FindingsGet(id)),
  findingsReview: ({ id, evidenceVersion, status, note }) => decode(findingSchema, 'FindingsReview', host.FindingsReview(id, evidenceVersion, status, note)),
  findingsSetType: (id, evidenceVersion, type) => decode(findingSchema, 'FindingsSetType', host.FindingsSetType(id, evidenceVersion, type)),
  findingsThread: (id, change) =>
    decode(
      findingSchema,
      'FindingsThread',
      host.FindingsThread(
        id,
        change.op,
        'messageId' in change ? change.messageId : '',
        change.op === 'add' ? change.who : '',
        'text' in change ? change.text : '',
      ),
    ),
  findingsSummary: () => decode(findingsSummarySchema, 'FindingsSummary', host.FindingsSummary()),
  findingsReaperStatus: () => decode(reaperStatusSchema, 'FindingsReaperStatus', host.FindingsReaperStatus()),
  findingsGoTo: (id) => decode(findingNavigationSchema, 'FindingsGoTo', host.FindingsGoTo(id)),
  findingsLoop: (id) => decode(findingNavigationSchema, 'FindingsLoop', host.FindingsLoop(id)),
  findingsGoToRead: (id, read) => decode(findingNavigationSchema, 'FindingsGoToRead', host.FindingsGoToRead(id, read)),
  findingsLoopRead: (id, read) => decode(findingNavigationSchema, 'FindingsLoopRead', host.FindingsLoopRead(id, read)),
  findingsStopLoop: () => decode(findingNavigationSchema, 'FindingsStopLoop', host.FindingsStopLoop()),
  findingsAddMarker: (id) => decode(findingMarkerSchema, 'FindingsAddMarker', host.FindingsAddMarker(id)),
  takeReviewScanStart: (scope) => decode(takeReviewScanJobSchema, 'TakeReviewScanStart', host.TakeReviewScanStart(scope)),
  takeReviewScanState: () => decode(takeReviewScanJobSchema, 'TakeReviewScanState', host.TakeReviewScanState()),
  takeReviewScanCancel: () => decode(takeReviewScanJobSchema, 'TakeReviewScanCancel', host.TakeReviewScanCancel()),
  takeComparisonStart: (findingId) => decode(takeComparisonJobSchema, 'TakeComparisonStart', host.TakeComparisonStart(findingId)),
  takeComparisonState: () => decode(takeComparisonJobSchema, 'TakeComparisonState', host.TakeComparisonState()),
  takeComparisonCancel: () => decode(takeComparisonJobSchema, 'TakeComparisonCancel', host.TakeComparisonCancel()),
  measurePickFiles: () => decode(measurePickResultSchema, 'MeasurePickFiles', host.MeasurePickFiles()),
  measureAnalyze: (paths) => decode(measureJobSchema, 'MeasureAnalyze', host.MeasureAnalyze(paths)),
  measureState: () => decode(measureJobSchema, 'MeasureState', host.MeasureState()),
  measureCancel: () => decode(measureJobSchema, 'MeasureCancel', host.MeasureCancel()),
  deliveryExportReport: (includePaths) => decode(deliveryReportExportSchema, 'DeliveryExportReport', host.DeliveryExportReport(includePaths)),
  deliveryProfiles: () => decode(deliveryProfilesStateSchema, 'DeliveryProfiles', host.DeliveryProfiles()),
  deliverySelectProfile: (scope, id, version) => decode(deliveryProfilesStateSchema, 'DeliverySelectProfile', host.DeliverySelectProfile(scope, id, version)),
  deliveryDuplicateProfile: (id, version) => decode(deliveryProfileSchema, 'DeliveryDuplicateProfile', host.DeliveryDuplicateProfile(id, version)),
  deliverySaveProfile: (edit) => decode(deliveryProfileSchema, 'DeliverySaveProfile', host.DeliverySaveProfile(JSON.stringify(edit))),
  deliveryDeleteProfile: (id) => decode(deliveryProfilesStateSchema, 'DeliveryDeleteProfile', host.DeliveryDeleteProfile(id)),
  diagnosticsAnalyze: (paths, sourceKind) => decode(diagnosticsJobSchema, 'DiagnosticsAnalyze', host.DiagnosticsAnalyze(paths, sourceKind)),
  diagnosticsState: () => decode(diagnosticsJobSchema, 'DiagnosticsState', host.DiagnosticsState()),
  diagnosticsCancel: () => decode(diagnosticsJobSchema, 'DiagnosticsCancel', host.DiagnosticsCancel()),
  takeReviewCreateTake: (request) =>
    decode(
      takeReviewCreateTakeResultSchema,
      'TakeReviewCreateTake',
      host.TakeReviewCreateTake(
        request.findingId,
        request.targetItemGuid,
        request.candidateItemGuid,
        request.sourceFile,
        request.sourceRangeStart,
        request.sourceRangeEnd,
      ),
    ),
  teleprompterStart: (options) => decode(teleprompterStartResultSchema, 'TeleprompterStart', host.TeleprompterStart(toStartOptions(options))),
  teleprompterStop: () => decode(voidResult, 'TeleprompterStop', host.TeleprompterStop()),
  teleprompterSeek: (word) => decode(voidResult, 'TeleprompterSeek', host.TeleprompterSeek(word)),
  teleprompterSaveFlags: (chapterId, flags) => decode(teleprompterFlagFindingsSchema, 'TeleprompterSaveFlags', host.TeleprompterSaveFlags(chapterId, flags)),
  teleprompterState: () => decode(teleprompterStateSchema, 'TeleprompterState', host.TeleprompterState()),
  teleprompterDevices: () => decode(teleprompterDevicesResultSchema, 'TeleprompterDevices', host.TeleprompterDevices()),
  teleprompterMeterStart: (device) => decode(voidResult, 'TeleprompterMeterStart', host.TeleprompterMeterStart(device)),
  teleprompterMeterStop: () => decode(voidResult, 'TeleprompterMeterStop', host.TeleprompterMeterStop()),
  teleprompterPause: (paused) => decode(voidResult, 'TeleprompterPause', host.TeleprompterPause(paused)),
  teleprompterPunchPreview: (word) => decode(teleprompterPunchResultSchema, 'TeleprompterPunchPreview', host.TeleprompterPunchPreview(word)),
  teleprompterPunch: (word) => decode(teleprompterPunchResultSchema, 'TeleprompterPunch', host.TeleprompterPunch(word)),
  readAloudReaperState: (chapterId) => decode(readAloudReaperStateSchema, 'ReadAloudReaperState', host.ReadAloudReaperState(chapterId)),
  readAloudArmOnly: (chapterId) => decode(readAloudRecordingSchema, 'ReadAloudArmOnly', host.ReadAloudArmOnly(chapterId)),
  readAloudRecordStart: (chapterId) => decode(readAloudRecordingSchema, 'ReadAloudRecordStart', host.ReadAloudRecordStart(chapterId)),
  readAloudRecordStartAt: (chapterId, at) => decode(readAloudRecordingSchema, 'ReadAloudRecordStartAt', host.ReadAloudRecordStartAt(chapterId, at)),
  readAloudRecordStop: () => decode(readAloudRecordingSchema, 'ReadAloudRecordStop', host.ReadAloudRecordStop()),
  teleprompterReaperInput: () => decode(teleprompterReaperInputSchema, 'TeleprompterReaperInput', host.TeleprompterReaperInput()),
  teleprompterLocate: (chapterId, options) =>
    decode(teleprompterLocateResultSchema, 'TeleprompterLocate', host.TeleprompterLocate(chapterId, options?.trackGuid ?? '', options?.model ?? '')),
  subscribeTeleprompterEvent: subscribeTeleprompterEvents,
  subscribeTeleprompterState: (onState) => subscribeChecked('teleprompter:state', teleprompterStateSchema, onState),
  teleprompterResumeFollow: (chapterId, trackGuid) =>
    decode(teleprompterResumeFollowSchema, 'TeleprompterResumeFollow', host.TeleprompterResumeFollow(chapterId, trackGuid ?? '')),
  teleprompterResumeUnfollow: () => decode(teleprompterResumeFollowSchema, 'TeleprompterResumeUnfollow', host.TeleprompterResumeUnfollow()),
  subscribeTeleprompterResumeFollow: (onEvent) => subscribeChecked('teleprompter_resume_follow', teleprompterResumeFollowEventSchema, onEvent),
  mediaUrl: (sourceFile) => `${mediaRoute}?path=${encodeURIComponent(sourceFile)}`,
  exportPickFiles: () => decode(measurePickResultSchema, 'ExportPickFiles', host.ExportPickFiles()),
  exportStart: (req) => decode(exportJobSchema, 'ExportStart', host.ExportStart(req)),
  exportState: () => decode(exportJobSchema, 'ExportState', host.ExportState()),
  exportCancel: () => decode(exportJobSchema, 'ExportCancel', host.ExportCancel()),
  packageStart: (req) => decode(packageJobSchema, 'PackageStart', host.PackageStart(req)),
  packageState: () => decode(packageJobSchema, 'PackageState', host.PackageState()),
  packageCancel: () => decode(packageJobSchema, 'PackageCancel', host.PackageCancel()),
  deliveryOpenPackageFolder: () => decode(packageFolderResultSchema, 'DeliveryOpenPackageFolder', host.DeliveryOpenPackageFolder()),
  packageStartMulti: (req) => decode(multiPackageJobSchema, 'PackageStartMulti', host.PackageStartMulti(req)),
  packageMultiState: () => decode(multiPackageJobSchema, 'PackageMultiState', host.PackageMultiState()),
  packageMultiCancel: () => decode(multiPackageJobSchema, 'PackageMultiCancel', host.PackageMultiCancel()),
};
