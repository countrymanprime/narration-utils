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
  creditsSetupStateSchema,
  creditsRenderResultSchema,
  creditsStatusesSchema,
  creditTemplateSchema,
  creditTemplatesSchema,
  retailSampleAnswerSchema,
} from './schemas/credits';
import { dawCatalogListSchema } from './schemas/dawCatalog';
import { chapterSyncPreviewSchema, chapterSyncStateSchema } from './schemas/chapterSync';
import { guideBuildResultSchema, guideCreatedSchema, guideEntitiesSchema, guidePreviewSchema } from './schemas/storyBible';
import { settingsForScopeSchema } from './schemas/settings';
import { tracksDiscoverySchema, tracksProjectSchema } from './schemas/tracks';
import {
  chapterRegionPlanSchema,
  chapterRegionsCreatedSchema,
  chapterSuggestionSchema,
  chapterTrackLinksSchema,
  chapterTrackMappingSchema,
  chapterTrackMatchSchema,
  chapterTrackSetSchema,
  trackMappingSchema,
} from './schemas/chapterTrackMap';
import { takeComparisonJobSchema, takeReviewCreateTakeResultSchema, takeReviewScanJobSchema } from './schemas/takeReview';
import { deliveryReportExportSchema, measureJobSchema, measurePickResultSchema } from './schemas/measure';
import { deliveryProfileSchema, deliveryProfilesStateSchema } from './schemas/deliveryProfiles';
import { diagnosticsJobSchema } from './schemas/diagnostics';
import { coverageResultSchema, coverageStartResultSchema, coverageStateSchema } from './schemas/coverage';
import { stageDecisionResultSchema, stageRecommendationsSchema } from './schemas/stages';
import { findingMarkerSchema, findingNavigationSchema, findingSchema, findingsPageSchema, findingsSummarySchema, reaperStatusSchema } from './schemas/findings';
import { assetCatalogSchema, assetInstallJobSchema, assetVerifyResultSchema } from './schemas/assets';
import { ttsCatalogSchema, ttsInstallJobSchema } from './schemas/tts';
import { updateJobSchema, updateStatusSchema } from './schemas/update';
import { startResultSchema, whisperCatalogSchema, whisperInstallJobSchema } from './schemas/whisper';
import { bootstrapSchema, jobEndedSchema, noticeSchema, projectAttachStateSchema, readySchema } from './schemas/system';
import {
  TELEPROMPTER_EVENT_TYPES,
  readAloudReaperStateSchema,
  teleprompterReaperInputSchema,
  teleprompterDevicesResultSchema,
  teleprompterEventSchema,
  teleprompterFlagFindingsSchema,
  teleprompterLocateResultSchema,
  teleprompterResumeLiveSchema,
  teleprompterStartResultSchema,
  teleprompterStateSchema,
} from './schemas/teleprompter';
import type { TeleprompterStartOptions } from './contracts/teleprompter';
import { equivalenceSchema, hintSuggestionsSchema, hintsSchema, lastCompletedSchema, transcriptStateSchema } from './schemas/transcript';
import { lineIdentityStartResultSchema, lineIdentityStateSchema } from './schemas/lineidentity';
import { pickupsImportResultSchema, pickupsStartResultSchema, pickupsStateSchema } from './schemas/pickups';
import { renderConfigStartResultSchema, renderConfigStateSchema, renderConfigSuggestedFolderSchema } from './schemas/renderconfig';
import { chapterTagsEmbedResultSchema, chapterTagsPreviewSchema } from './schemas/chaptertags';
import { cleanupToolsStartResultSchema, cleanupToolsStateSchema } from './schemas/cleanuptools';
import { projectStateChangedSchema, projectStateStartResultSchema, projectStateStateSchema } from './schemas/projectstate';
import { dictionaryLookupResultSchema } from './schemas/dictionary';
import { retakeLanesListSchema, retakeLanesStartResultSchema, retakeLanesStateSchema } from './schemas/retakelanes';
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
  subscribeTranscript: (onUpdate) => subscribeChecked('transcript:state', transcriptStateSchema, onUpdate),
  coverageStart: (chapterId) => decode(coverageStartResultSchema, 'CoverageStart', host.CoverageStart(chapterId)),
  coverageState: () => decode(coverageStateSchema, 'CoverageState', host.CoverageState()),
  coverageCancel: () => decode(voidResult, 'CoverageCancel', host.CoverageCancel()),
  coverageResult: (chapterId) => decode(coverageResultSchema, 'CoverageResult', host.CoverageResult(chapterId)),
  stageRecommendations: () => decode(stageRecommendationsSchema, 'StageRecommendations', host.StageRecommendations()),
  stageConfirm: (chapterId, target, basisKey) => decode(stageDecisionResultSchema, 'StageConfirm', host.StageConfirm(chapterId, target, basisKey)),
  stageDismiss: (chapterId, target, basisKey) => decode(stageDecisionResultSchema, 'StageDismiss', host.StageDismiss(chapterId, target, basisKey)),
  stageRevert: (chapterId) => decode(stageDecisionResultSchema, 'StageRevert', host.StageRevert(chapterId)),
  subscribeCoverage: (onUpdate) => subscribeChecked('coverage:state', coverageStateSchema, onUpdate),
  lineIdentityStamp: (rows, overwrite) => decode(lineIdentityStartResultSchema, 'LineIdentityStamp', host.LineIdentityStamp(rows, overwrite)),
  lineIdentityRead: () => decode(lineIdentityStartResultSchema, 'LineIdentityRead', host.LineIdentityRead()),
  lineIdentityState: () => decode(lineIdentityStateSchema, 'LineIdentityState', host.LineIdentityState()),
  subscribeLineIdentity: (onUpdate) => subscribeChecked('lineidentity:state', lineIdentityStateSchema, onUpdate),
  pickupsImport: (csvText) => decode(pickupsImportResultSchema, 'PickupsImport', host.PickupsImport(csvText)),
  pickupsExport: () => decode(pickupsStartResultSchema, 'PickupsExport', host.PickupsExport()),
  pickupsNext: () => decode(pickupsStartResultSchema, 'PickupsNext', host.PickupsNext()),
  pickupsResolve: (position) => decode(pickupsStartResultSchema, 'PickupsResolve', host.PickupsResolve(position)),
  pickupsCount: () => decode(pickupsStartResultSchema, 'PickupsCount', host.PickupsCount()),
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
  dawCatalogList: () => decode(dawCatalogListSchema, 'DawCatalogList', host.DawCatalogList()),
  dawCatalogOpenDownloadPage: (id) => decode(voidResult, 'DawCatalogOpenDownloadPage', host.DawCatalogOpenDownloadPage(id)),
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
  chapterRegionsPreview: (openingTrackGuid, closingTrackGuid) =>
    decode(chapterRegionPlanSchema, 'ChapterRegionsPreview', host.ChapterRegionsPreview(openingTrackGuid, closingTrackGuid)),
  chapterRegionsCreate: (openingTrackGuid, closingTrackGuid, update) =>
    decode(chapterRegionsCreatedSchema, 'ChapterRegionsCreate', host.ChapterRegionsCreate(openingTrackGuid, closingTrackGuid, update)),
  chapterTrackMatch: (chapterId) => decode(chapterTrackMatchSchema, 'ChapterTrackMatch', host.ChapterTrackMatch(chapterId)),
  chapterSuggestion: () => decode(chapterSuggestionSchema, 'ChapterSuggestion', host.ChapterSuggestion()),
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
  readAloudReaperState: (chapterId) => decode(readAloudReaperStateSchema, 'ReadAloudReaperState', host.ReadAloudReaperState(chapterId)),
  teleprompterReaperInput: () => decode(teleprompterReaperInputSchema, 'TeleprompterReaperInput', host.TeleprompterReaperInput()),
  teleprompterLocate: (chapterId, options) =>
    decode(teleprompterLocateResultSchema, 'TeleprompterLocate', host.TeleprompterLocate(chapterId, options?.trackGuid ?? '', options?.model ?? '')),
  teleprompterWatchResume: (trackGuid) => decode(voidResult, 'TeleprompterWatchResume', host.TeleprompterWatchResume(trackGuid)),
  teleprompterUnwatchResume: () => decode(voidResult, 'TeleprompterUnwatchResume', host.TeleprompterUnwatchResume()),
  subscribeTeleprompterEvent: subscribeTeleprompterEvents,
  subscribeTeleprompterState: (onState) => subscribeChecked('teleprompter:state', teleprompterStateSchema, onState),
  subscribeTeleprompterResumeLive: (onEvent) => subscribeChecked('teleprompter:resumeLive', teleprompterResumeLiveSchema, () => onEvent()),
  mediaUrl: (sourceFile) => `${mediaRoute}?path=${encodeURIComponent(sourceFile)}`,
};
