import { parseWire, parseWireJson, type WireContext } from './wire/parseWire';
import { isWireError, WireError } from './wire/WireError';
import { createLiveHealth } from './wire/liveHealth';
import type { InferOutput, StandardSchemaV1 } from './wire/standardSchema';
import { voidResult } from './schemas/base';
import {
  bookmarkSchema,
  chaptersSchema,
  fileSelectionSchema,
  noteSchema,
  notesSchema,
  chapterKindResultSchema,
  chapterSchema,
  paragraphsSchema,
  readerSchema,
  readerStateSchema,
  searchHitsSchema,
  workJobSchema,
} from './schemas/manuscript';
import { dawLaunchResultSchema, dawLinkResultSchema, projectFolderSelectionSchema, projectSwitchResultSchema, recentProjectsSchema } from './schemas/project';
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
import { dawCapabilitiesSchema, dawTransportSchema } from './schemas/daw';
import { providerCapabilitiesSchema } from './schemas/providers';
import { pronunciationOnlineBatchResultSchema, pronunciationOnlineKeyStatusSchema, pronunciationOnlineResultSchema } from './schemas/pronunciationOnline';
import { masteringProvidersSchema } from './schemas/mastering';
import { recorderDevicesResultSchema, recorderLevelSchema, recorderStateSchema } from './schemas/recording';
import { chapterSyncPreviewSchema, chapterSyncStateSchema } from './schemas/chapterSync';
import {
  guideBuildResultSchema,
  guideCreatedSchema,
  guideDialogueCuesSchema,
  guideEntitiesSchema,
  guidePreviewSchema,
  pronunciationQueriesCsvSchema,
  pronunciationQueriesSchema,
  queryImportResultSchema,
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
import { coverageResultSchema, coverageStartResultSchema, coverageStateSchema } from './schemas/coverage';
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
  productionStartResultSchema,
  productionStopResultSchema,
} from './schemas/production';
import { prepCompletenessSummarySchema } from './schemas/prepCompleteness';
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
import { pickupsImportResultSchema, pickupsPunchResultSchema, pickupsStartResultSchema, pickupsStateSchema } from './schemas/pickups';
import { renderConfigStartResultSchema, renderConfigStateSchema, renderConfigSuggestedFolderSchema } from './schemas/renderconfig';
import { chapterTagsEmbedResultSchema, chapterTagsPreviewSchema } from './schemas/chaptertags';
import { cleanupToolsStartResultSchema, cleanupToolsStateSchema } from './schemas/cleanuptools';
import { prepMarkupChapterSchema, prepMarkupSpanSchema } from './schemas/prepMarkup';
import { cleanupApplyResultSchema, cleanupPreviewResultSchema, levelMatchApplyResultSchema, levelMatchPreviewResultSchema } from './schemas/cleanup';
import { projectStateChangedSchema, projectStateStartResultSchema, projectStateStateSchema } from './schemas/projectstate';
import { dictionaryLookupResultSchema } from './schemas/dictionary';
import { retakeLanesListSchema, retakeLanesStartResultSchema, retakeLanesStateSchema } from './schemas/retakelanes';
import { exportJobSchema, multiPackageJobSchema, packageJobSchema } from './schemas/renderEncodeMaster';
import type { NarrationApi } from '../types';
import * as host from '../../wailsjs/github.com/countrymanprime/narration-utils/shell/host';
import { Events } from '@wailsio/runtime';

/**
 * A Go method that returns an error rejected with the error's text on Wails v2. Wails v3 rejects with a `RuntimeError` whose `message`
 * is that text (ADR 0200), and pages show a rejection with `String(reason)`, which would then read "RuntimeError: ...". `decode` and
 * `decodeObject`, which every binding call goes through, keep v2's contract: the text alone. Any other rejection (an unknown method,
 * a wrong argument, a lost transport) passes through as it is.
 */
function hostErrorText(reason: unknown): unknown {
  return reason instanceof Error && reason.name === 'RuntimeError' ? reason.message : reason;
}

async function hostResult<T>(request: Promise<T>): Promise<T> {
  try {
    return await request;
  } catch (reason) {
    throw hostErrorText(reason);
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

// Live events (ADR 0069, failure class "live event"): one counter for the whole client. An event that does not match is dropped
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
  const text = await hostResult(request);
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
  const value = await hostResult(request);
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
  guideMerge: (sourceId, targetId) => decode(voidResult, 'GuideMerge', host.GuideMerge(sourceId, targetId)),
  guideDelete: (id) => decode(voidResult, 'GuideDelete', host.GuideDelete(id)),
  guideRelate: (id, otherId, label) => decode(voidResult, 'GuideRelate', host.GuideRelate(id, otherId, label)),
  guideUnrelate: (id, otherId, label) => decode(voidResult, 'GuideUnrelate', host.GuideUnrelate(id, otherId, label)),
  guidePreview: (id, aliasIndex) => decode(guidePreviewSchema, 'GuidePreview', host.GuidePreview(id, aliasIndex ?? null)),
  guidePronounce: (id, source, aliasIndex) => decode(voidResult, 'GuidePronounce', host.GuidePronounce(id, aliasIndex ?? null, source)),
  guidePronounceUser: (id, ipa, aliasIndex) => decode(voidResult, 'GuidePronounceUser', host.GuidePronounceUser(id, aliasIndex ?? null, ipa)),
  guidePronunciationUseAlternate: (id, aliasIndex) =>
    decode(voidResult, 'GuidePronunciationUseAlternate', host.GuidePronunciationUseAlternate(id, aliasIndex ?? null)),
  guidePronunciationQueries: () => decode(pronunciationQueriesSchema, 'GuidePronunciationQueries', host.GuidePronunciationQueries()),
  guidePronunciationQueriesCsv: () => decode(pronunciationQueriesCsvSchema, 'GuidePronunciationQueriesCSV', host.GuidePronunciationQueriesCSV()),
  guidePronunciationImportQueriesCsv: (csvText) =>
    decode(queryImportResultSchema, 'GuidePronunciationImportQueriesCSV', host.GuidePronunciationImportQueriesCSV(csvText)),
  guidePronunciationSetStatus: (id, status, note, aliasIndex) =>
    decode(voidResult, 'GuidePronunciationSetStatus', host.GuidePronunciationSetStatus(id, aliasIndex ?? null, status, note ?? null)),
  guideDialogueCues: () => decode(guideDialogueCuesSchema, 'GuideDialogueCues', host.GuideDialogueCues()),
  guideCorrectCue: (cueId, speakerEntityId) => decode(voidResult, 'GuideCorrectCue', host.GuideCorrectCue(cueId, speakerEntityId)),
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
  readerStateSave: (values) =>
    decode(
      readerStateSchema,
      'ManuscriptSaveReaderState',
      host.ManuscriptSaveReaderState(values.activeChapter ?? '', values.activeSourceLine ?? null, values.expandedChapters ?? []),
    ),
  readerBookmarkCreate: (bookmark) => decode(bookmarkSchema, 'ManuscriptCreateBookmark', host.ManuscriptCreateBookmark(bookmark)),
  readerBookmarkDelete: (id) => decode(voidResult, 'ManuscriptDeleteBookmark', host.ManuscriptDeleteBookmark(id)),
  manuscriptParagraphs: (chapter) => decode(paragraphsSchema, 'ManuscriptParagraphs', host.ManuscriptParagraphs(chapter)),
  manuscriptSearch: (query) => decode(searchHitsSchema, 'ManuscriptSearch', host.ManuscriptSearch(query)),
  manuscriptSetChapterStatus: (chapter, status) => decode(chapterSchema, 'ManuscriptSetChapterStatus', host.ManuscriptSetChapterStatus(chapter, status)),
  manuscriptSetChapterKind: (chapterId, kind) => decode(chapterKindResultSchema, 'ManuscriptSetChapterKind', host.ManuscriptSetChapterKind(chapterId, kind)),
  noteList: (chapter) => decode(notesSchema, 'ManuscriptNotes', host.ManuscriptNotes(chapter ?? '')),
  noteCreate: (chapterId, paragraphId, text, anchorStart, anchorEnd, anchorText) =>
    decode(
      noteSchema,
      'ManuscriptCreateNote',
      host.ManuscriptCreateNote(chapterId, paragraphId, text, anchorText ?? '', anchorStart ?? null, anchorEnd ?? null),
    ),
  noteDelete: (id) => decode(voidResult, 'ManuscriptDeleteNote', host.ManuscriptDeleteNote(id)),
  prepMarkupList: (chapterId) => decode(prepMarkupChapterSchema, 'PrepMarkupList', host.PrepMarkupList(chapterId)),
  prepMarkupSave: (chapterId, paragraphId, start, end, kind, value) =>
    decode(prepMarkupSpanSchema, 'PrepMarkupSave', host.PrepMarkupSave(chapterId, paragraphId, start, end, kind, value)),
  prepMarkupDelete: (chapterId, id) => decode(voidResult, 'PrepMarkupDelete', host.PrepMarkupDelete(chapterId, id)),
  subscribeTranscript: (onUpdate) => subscribeChecked('transcript:state', transcriptStateSchema, onUpdate),
  coverageStart: (chapterId, options) =>
    decode(coverageStartResultSchema, 'CoverageStart', host.CoverageStart(chapterId, options?.skipRecheck ? { skipRecheck: 'true' } : {})),
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
  prepCompletenessSummary: () => decode(prepCompletenessSummarySchema, 'PrepCompletenessSummary', host.PrepCompletenessSummary()),
  productionStartTimer: (chapterId, stage) => decode(productionStartResultSchema, 'ProductionStartTimer', host.ProductionStartTimer(chapterId, stage)),
  productionStopTimer: () => decode(productionStopResultSchema, 'ProductionStopTimer', host.ProductionStopTimer()),
  productionStatusReport: (includeContractedAmount) =>
    decode(productionReportExportSchema, 'ProductionStatusReport', host.ProductionStatusReport(includeContractedAmount)),
  productionBurndown: () => decode(productionBurndownSchema, 'ProductionBurndown', host.ProductionBurndown()),
  subscribeCoverage: (onUpdate) => subscribeChecked('coverage:state', coverageStateSchema, onUpdate),
  editingStart: (documentId, chapterId, chapterTitle) =>
    decode(editingStartResultSchema, 'EditingStart', host.EditingStart(documentId, chapterId, chapterTitle)),
  editingState: () => decode(editingStateSchema, 'EditingState', host.EditingState()),
  editingCancel: () => decode(voidResult, 'EditingCancel', host.EditingCancel()),
  editingCandidates: (chapterId) => decode(editingCandidatesSchema, 'EditingCandidates', host.EditingCandidates(chapterId)),
  // Phase 8 (Q6): EditingSourceChoice/EditingSetSourceChoice are not yet in wailsjs/.../host.ts - this sandbox has no
  // wails3 CLI to regenerate it (bindings_editing.go's own doc comment; `pnpm --dir apps/desktop bindings` fails the
  // same way here it did for Phase 5). host.EditingSourceChoice/EditingSetSourceChoice below type-check once that
  // regeneration adds them, the same shape every other bare-string binding above already has.
  editingSourceChoice: (chapterId) => decode(editingSourceChoiceSchema, 'EditingSourceChoice', host.EditingSourceChoice(chapterId)),
  editingSetSourceChoice: (chapterId, choice) => decode(editingSourceChoiceSchema, 'EditingSetSourceChoice', host.EditingSetSourceChoice(chapterId, choice)),
  cleanupPreview: (chapterId) => decode(cleanupPreviewResultSchema, 'CleanupPreview', host.CleanupPreview(chapterId)),
  cleanupApply: (chapterId) => decode(cleanupApplyResultSchema, 'CleanupApply', host.CleanupApply(chapterId)),
  levelMatchPreview: (chapterId, metric, targetValueDb, toleranceDb) =>
    decode(levelMatchPreviewResultSchema, 'LevelMatchPreview', host.LevelMatchPreview(chapterId, metric, targetValueDb, toleranceDb)),
  levelMatchApply: (chapterId, metric, targetValueDb, toleranceDb) =>
    decode(levelMatchApplyResultSchema, 'LevelMatchApply', host.LevelMatchApply(chapterId, metric, targetValueDb, toleranceDb)),
  workspaceAlignment: (chapterId) => decode(workspaceAlignmentResultSchema, 'WorkspaceAlignment', host.WorkspaceAlignment(chapterId)),
  workspaceGoTo: (chapterId, tokenIndex) => decode(findingNavigationSchema, 'WorkspaceGoTo', host.WorkspaceGoTo(chapterId, tokenIndex)),
  workspaceLoop: (chapterId, firstToken, lastToken) => decode(findingNavigationSchema, 'WorkspaceLoop', host.WorkspaceLoop(chapterId, firstToken, lastToken)),
  workspaceListFXChains: () => decode(workspaceFXChainsResultSchema, 'WorkspaceListFXChains', host.WorkspaceListFXChains()),
  workspaceTakes: (chapterId, firstToken, lastToken) =>
    decode(workspaceTakesResultSchema, 'WorkspaceTakes', host.WorkspaceTakes(chapterId, firstToken, lastToken)),
  workspaceTakesCompareStart: (chapterId, firstToken, lastToken) =>
    decode(takeComparisonJobSchema, 'WorkspaceTakesCompareStart', host.WorkspaceTakesCompareStart(chapterId, firstToken, lastToken)),
  workspaceUseTake: (chapterId, firstToken, lastToken, candidateId) =>
    decode(workspaceUseTakeResultSchema, 'WorkspaceUseTake', host.WorkspaceUseTake(chapterId, firstToken, lastToken, candidateId)),
  workspacePeaks: (chapterId) => decode(workspacePeaksResultSchema, 'WorkspacePeaks', host.WorkspacePeaks(chapterId)),
  previewCandidates: () => decode(previewResultSchema, 'PreviewCandidates', host.PreviewCandidates()),
  previewPin: () => decode(pinnedPreviewSchema, 'PreviewPin', host.PreviewPin()),
  previewPinSet: (chapterId, paragraphIds) => decode(pinnedPreviewSchema, 'PreviewPinSet', host.PreviewPinSet(chapterId, paragraphIds)),
  previewPinAdjust: (edge, grow) => decode(pinnedPreviewSchema, 'PreviewPinAdjust', host.PreviewPinAdjust(edge, grow)),
  previewPinClear: () => decode(pinnedPreviewSchema, 'PreviewPinClear', host.PreviewPinClear()),
  productionPlan: () => decode(productionPlanSchema, 'ProductionPlan', host.ProductionPlan()),
  setProductionDeadline: (deadline, contractedAmount) =>
    decode(productionPlanSchema, 'ProductionSetDeadline', host.ProductionSetDeadline(deadline, contractedAmount)),
  saveProductionMilestones: (milestones) => decode(productionPlanSchema, 'ProductionSaveMilestones', host.ProductionSaveMilestones(milestones)),
  lineIdentityStamp: (rows, overwrite) => decode(lineIdentityStartResultSchema, 'LineIdentityStamp', host.LineIdentityStamp(rows, overwrite)),
  lineIdentityRead: () => decode(lineIdentityStartResultSchema, 'LineIdentityRead', host.LineIdentityRead()),
  lineIdentityState: () => decode(lineIdentityStateSchema, 'LineIdentityState', host.LineIdentityState()),
  subscribeLineIdentity: (onUpdate) => subscribeChecked('lineidentity:state', lineIdentityStateSchema, onUpdate),
  pickupsImport: (csvText) => decode(pickupsImportResultSchema, 'PickupsImport', host.PickupsImport(csvText)),
  pickupsExport: () => decode(pickupsStartResultSchema, 'PickupsExport', host.PickupsExport()),
  pickupsNext: () => decode(pickupsStartResultSchema, 'PickupsNext', host.PickupsNext()),
  pickupsResolve: (position) => decode(pickupsStartResultSchema, 'PickupsResolve', host.PickupsResolve(position)),
  pickupsCount: () => decode(pickupsStartResultSchema, 'PickupsCount', host.PickupsCount()),
  pickupsPunch: (position) => decode(pickupsPunchResultSchema, 'PickupsPunch', host.PickupsPunch(position)),
  pickupsState: () => decode(pickupsStateSchema, 'PickupsState', host.PickupsState()),
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
  pronunciationOnlineLookupBatch: (words, confirmedCount) =>
    decode(pronunciationOnlineBatchResultSchema, 'PronunciationOnlineLookupBatch', host.PronunciationOnlineLookupBatch(words, confirmedCount)),
  dawCapabilities: () => decode(dawCapabilitiesSchema, 'DawCapabilities', host.DawCapabilities()),
  subscribeDawCapabilities: (onUpdate) => subscribeChecked('daw_capabilities_changed', dawCapabilitiesSchema, onUpdate),
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
  packageStartMulti: (req) => decode(multiPackageJobSchema, 'PackageStartMulti', host.PackageStartMulti(req)),
  packageMultiState: () => decode(multiPackageJobSchema, 'PackageMultiState', host.PackageMultiState()),
  packageMultiCancel: () => decode(multiPackageJobSchema, 'PackageMultiCancel', host.PackageMultiCancel()),
};
