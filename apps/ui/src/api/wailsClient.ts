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
  chapterSchema,
  paragraphsSchema,
  readerSchema,
  readerStateSchema,
  searchHitsSchema,
  workJobSchema,
} from './schemas/manuscript';
import { dawLinkResultSchema, projectFolderSelectionSchema, projectSwitchResultSchema, recentProjectsSchema } from './schemas/project';
import { guideBuildResultSchema, guideCreatedSchema, guideEntitiesSchema, guidePreviewSchema } from './schemas/storyBible';
import { settingsForScopeSchema } from './schemas/settings';
import { tracksDiscoverySchema, tracksProjectSchema } from './schemas/tracks';
import { assetCatalogSchema, assetInstallJobSchema, assetVerifyResultSchema } from './schemas/assets';
import { ttsCatalogSchema, ttsInstallJobSchema } from './schemas/tts';
import { updateJobSchema, updateStatusSchema } from './schemas/update';
import { startResultSchema, whisperCatalogSchema, whisperInstallJobSchema } from './schemas/whisper';
import { bootstrapSchema, jobEndedSchema, noticeSchema, projectAttachStateSchema, readySchema } from './schemas/system';
import { TELEPROMPTER_EVENT_TYPES, teleprompterDevicesResultSchema, teleprompterEventSchema, teleprompterStateSchema } from './schemas/teleprompter';
import { equivalenceSchema, hintSuggestionsSchema, hintsSchema, lastCompletedSchema, transcriptStateSchema } from './schemas/transcript';
import type { NarrationApi } from '../types';
import * as host from '../../wailsjs/go/main/Host';
import { EventsOn } from '../../wailsjs/runtime/runtime';

declare global {
  interface Window {
    go?: { main?: { Host?: unknown } };
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
  return EventsOn(event, (value) => liveEvent(schema, event, value, onValid));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

// The host relays each sidecar line as a JSON value; tolerate the string form too so a transport change cannot silently drop the
// whole stream. A type the UI does not know is a newer sidecar: ignored and named once, not counted as a failure.
function subscribeTeleprompterEvents(onEvent: (event: InferOutput<typeof teleprompterEventSchema>) => void): () => void {
  return EventsOn('teleprompter:event', (payload) => {
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
  const text = await request;
  return checked(() => parseWireJson(schema, text, bindingContext(payload)));
}

/** Ready and Bootstrap are the two bindings that return an object, not JSON text. */
async function decodeObject<S extends StandardSchemaV1>(schema: S, payload: string, request: Promise<unknown>): Promise<InferOutput<S>> {
  const value = await request;
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
      host.ManuscriptImportCommit(jobId, options.confirmedReset, options.selection?.sectionKinds ?? {}, options.selection?.characterCandidateIds ?? []),
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
  guidePreview: (id, aliasIndex) => decode(guidePreviewSchema, 'GuidePreview', host.GuidePreview(id, aliasIndex)),
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
      host.ManuscriptSaveReaderState(values.activeChapter ?? '', values.activeSourceLine, values.expandedChapters ?? []),
    ),
  readerBookmarkCreate: (bookmark) => decode(bookmarkSchema, 'ManuscriptCreateBookmark', host.ManuscriptCreateBookmark(bookmark)),
  readerBookmarkDelete: (id) => decode(voidResult, 'ManuscriptDeleteBookmark', host.ManuscriptDeleteBookmark(id)),
  manuscriptParagraphs: (chapter) => decode(paragraphsSchema, 'ManuscriptParagraphs', host.ManuscriptParagraphs(chapter)),
  manuscriptSearch: (query) => decode(searchHitsSchema, 'ManuscriptSearch', host.ManuscriptSearch(query)),
  manuscriptSetChapterStatus: (chapter, status) => decode(chapterSchema, 'ManuscriptSetChapterStatus', host.ManuscriptSetChapterStatus(chapter, status)),
  noteList: (chapter) => decode(notesSchema, 'ManuscriptNotes', host.ManuscriptNotes(chapter ?? '')),
  noteCreate: (chapterId, paragraphId, text, anchorStart, anchorEnd, anchorText) =>
    decode(noteSchema, 'ManuscriptCreateNote', host.ManuscriptCreateNote(chapterId, paragraphId, text, anchorText ?? '', anchorStart, anchorEnd)),
  noteDelete: (id) => decode(voidResult, 'ManuscriptDeleteNote', host.ManuscriptDeleteNote(id)),
  subscribeTranscript: (onUpdate) => subscribeChecked('transcript:state', transcriptStateSchema, onUpdate),
  projectRecents: () => decode(recentProjectsSchema, 'ProjectRecents', host.ProjectRecents()),
  selectProjectFolder: () => decode(projectFolderSelectionSchema, 'ProjectSelectFolder', host.ProjectSelectFolder()),
  switchProject: (path, name) => decode(projectSwitchResultSchema, 'ProjectSwitch', host.ProjectSwitch(path, name ?? '')),
  createProject: (parent, name) => decode(projectSwitchResultSchema, 'ProjectCreateIn', host.ProjectCreateIn(parent, name)),
  removeRecentProject: (path) => decode(recentProjectsSchema, 'ProjectRemoveRecent', host.ProjectRemoveRecent(path)),
  linkDawFile: () => decode(dawLinkResultSchema, 'ProjectLinkDawFile', host.ProjectLinkDawFile()),
  tracksDiscover: () => decode(tracksDiscoverySchema, 'TracksDiscover', host.TracksDiscover()),
  tracksSelect: (path) => decode(tracksDiscoverySchema, 'TracksSelect', host.TracksSelect(path)),
  tracksList: () => decode(tracksProjectSchema, 'TracksList', host.TracksList()),
  teleprompterStart: (options) => decode(startResultSchema, 'TeleprompterStart', host.TeleprompterStart(options)),
  teleprompterStop: () => decode(voidResult, 'TeleprompterStop', host.TeleprompterStop()),
  teleprompterState: () => decode(teleprompterStateSchema, 'TeleprompterState', host.TeleprompterState()),
  teleprompterDevices: () => decode(teleprompterDevicesResultSchema, 'TeleprompterDevices', host.TeleprompterDevices()),
  subscribeTeleprompterEvent: subscribeTeleprompterEvents,
  subscribeTeleprompterState: (onState) => subscribeChecked('teleprompter:state', teleprompterStateSchema, onState),
  mediaUrl: (sourceFile) => `${mediaRoute}?path=${encodeURIComponent(sourceFile)}`,
};
