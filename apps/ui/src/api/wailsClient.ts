import { normalizeGuideEntity } from '../types';
import { parseWire, parseWireJson, type WireContext } from './wire/parseWire';
import { isWireError, WireError } from './wire/WireError';
import { createLiveHealth } from './wire/liveHealth';
import type { InferOutput, StandardSchemaV1 } from './wire/standardSchema';
import { voidResult } from './schemas/base';
import { bootstrapSchema, projectAttachStateSchema, readySchema } from './schemas/system';
import { TELEPROMPTER_EVENT_TYPES, teleprompterEventSchema, teleprompterStateSchema } from './schemas/teleprompter';
import { transcriptStateSchema } from './schemas/transcript';
import type {
  Bootstrap,
  GuideEntity,
  GuidePreview,
  HintSuggestions,
  ManuscriptChapter,
  ManuscriptFileSelection,
  ManuscriptNote,
  ManuscriptParagraph,
  ManuscriptReader,
  NarrationApi,
  ProjectFolderSelection,
  ProjectSwitchResult,
  ReaderBookmark,
  ReaderState,
  RecentProject,
  ScopedSettingField,
  SearchHit,
  TeleprompterStartResult,
  TracksDiscovery,
  TracksProject,
  TranscriptStartResult,
  TranscriptState,
  TtsCatalog,
  TtsInstallJob,
  WhisperCatalog,
  WhisperInstallJob,
  WorkJob,
} from '../types';
import * as host from '../../wailsjs/go/main/Host';
import { EventsOn } from '../../wailsjs/runtime/runtime';

declare global {
  interface Window {
    go?: { main?: { Host?: unknown } };
  }
}

// Matches apps/desktop/media.go's mediaRoute constant.
const mediaRoute = '/media';

function normalizeTranscriptState(state: TranscriptState): TranscriptState {
  return { ...state, markerExport: state.markerExport ?? { phase: 'idle', message: '', added: 0, skipped: 0 } };
}

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

// Bindings whose result schema has not been written yet (phases 4 and 5 of the boundary PRD replace each with `decode`).
async function decodeUnchecked<T>(request: Promise<string>): Promise<T> {
  const value = await request;
  return value ? (JSON.parse(value) as T) : (undefined as T);
}

// This is intentionally an adapter, not a second component-facing API. The
// TypeScript contracts and mock client remain stable while transport moves
// from REST/SSE to Wails' generated Go binding and runtime events.
export const wailsClient: NarrationApi = {
  ready: () => decodeObject(readySchema, 'Ready', host.Ready()),
  bootstrap: () => decodeObject(bootstrapSchema, 'Bootstrap', host.Bootstrap()),
  selectManuscript: () => decodeUnchecked<ManuscriptFileSelection>(host.ManuscriptSelectFile()),
  manuscriptBeginImport: (path) => decodeUnchecked<ManuscriptFileSelection>(host.ManuscriptBeginImport(path)),
  manuscriptImportState: (jobId) => decodeUnchecked<WorkJob>(host.ManuscriptImportState(jobId)),
  manuscriptImportPreview: (jobId, options) => decodeUnchecked<WorkJob>(host.ManuscriptImportPreview(jobId, options.markdownHeadingLevel)),
  manuscriptImportCommit: (jobId, options) =>
    decodeUnchecked<WorkJob>(
      host.ManuscriptImportCommit(
        jobId,
        options.confirmedReset,
        (options.selection?.sectionKinds ?? {}) as Record<string, string>,
        options.selection?.characterCandidateIds ?? [],
      ),
    ),
  manuscriptImportCancel: (jobId) => decodeUnchecked<void>(host.ManuscriptImportCancel(jobId)),
  saveSettings: (tool, scope, values) => decodeUnchecked<Bootstrap>(host.SystemSaveSettings(tool, scope, values)),
  settingsForScope: (scope) => decodeUnchecked<Record<string, ScopedSettingField[]>>(host.SystemSettingsForScope(scope)),
  guideBuild: () => decodeUnchecked<WorkJob>(host.GuideBuild()),
  guideBuildState: () => decodeUnchecked<WorkJob>(host.GuideBuildState()),
  clearProjectData: () => decodeUnchecked<void>(host.ManuscriptClearProjectData(true)),
  guideEntities: () => decodeUnchecked<GuideEntity[] | null>(host.GuideEntities()).then((entities) => (entities ?? []).map(normalizeGuideEntity)),
  guideEdit: (id, values) => decodeUnchecked<void>(host.GuideEdit(id, values)),
  guideSetLocked: (id, locked) => decodeUnchecked<void>(host.GuideSetLocked(id, locked)),
  guideRescan: (id) => decodeUnchecked<void>(host.GuideRescan(id)),
  guideCreate: (name, category, aliases) => decodeUnchecked<{ id: string }>(host.GuideCreate(name, category, aliases)).then((value) => value.id),
  guideMerge: (sourceId, targetId) => decodeUnchecked<void>(host.GuideMerge(sourceId, targetId)),
  guideDelete: (id) => decodeUnchecked<void>(host.GuideDelete(id)),
  guideRelate: (id, otherId, label) => decodeUnchecked<void>(host.GuideRelate(id, otherId, label)),
  guideUnrelate: (id, otherId, label) => decodeUnchecked<void>(host.GuideUnrelate(id, otherId, label)),
  guidePreview: (id, aliasIndex) => decodeUnchecked<GuidePreview>(host.GuidePreview(id, aliasIndex)),
  ttsCatalog: () => decodeUnchecked<TtsCatalog>(host.TtsCatalog()),
  ttsInstall: (voiceId) => decodeUnchecked<TtsInstallJob>(host.TtsInstall(voiceId)),
  ttsInstallState: (jobId) => decodeUnchecked<TtsInstallJob>(host.TtsInstallState(jobId)),
  ttsInstallCancel: (jobId) => decodeUnchecked<TtsInstallJob>(host.TtsInstallCancel(jobId)),
  ttsRemove: (voiceId) => decodeUnchecked<void>(host.TtsRemove(voiceId)),
  whisperCatalog: () => decodeUnchecked<WhisperCatalog>(host.WhisperCatalog()),
  whisperInstall: (modelId) => decodeUnchecked<WhisperInstallJob>(host.WhisperInstall(modelId)),
  whisperInstallState: (jobId) => decodeUnchecked<WhisperInstallJob>(host.WhisperInstallState(jobId)),
  whisperInstallCancel: (jobId) => decodeUnchecked<WhisperInstallJob>(host.WhisperInstallCancel(jobId)),
  whisperRemove: (modelId) => decodeUnchecked<void>(host.WhisperRemove(modelId)),
  transcriptStart: (options) => decodeUnchecked<TranscriptStartResult>(host.TranscriptStart(options)),
  transcriptCancel: () => decodeUnchecked<void>(host.TranscriptCancel()),
  transcriptReset: () => decodeUnchecked<void>(host.TranscriptReset()),
  transcriptLastCompleted: () =>
    decodeUnchecked<TranscriptState | null>(host.TranscriptLastCompleted()).then((value) => (value ? normalizeTranscriptState(value) : undefined)),
  transcriptAddEquivalence: (id) => decodeUnchecked<{ message: string }>(host.TranscriptAddEquivalence(id)).then((value) => value.message),
  transcriptJump: (id) => decodeUnchecked<void>(host.TranscriptJump(id)),
  transcriptExportMarkers: () => decodeUnchecked<void>(host.TranscriptExportMarkers()),
  transcriptSuggestHints: () => decodeUnchecked<HintSuggestions>(host.TranscriptSuggestHints()),
  transcriptHints: () => decodeUnchecked<string[]>(host.TranscriptHints()),
  transcriptSaveHints: (accepted) => decodeUnchecked<void>(host.TranscriptSaveHints(accepted)),
  reportClientDiagnostic: (kind, message) => decode(voidResult, 'SystemReportDiagnostic', host.SystemReportDiagnostic(kind, message)),
  subscribeProjectAttach: (onUpdate) => subscribeChecked('system:attached', projectAttachStateSchema, onUpdate),
  subscribeLiveUpdateHealth: (onDegraded) => liveHealth.subscribe(onDegraded),
  manuscriptChapters: () => decodeUnchecked<ManuscriptChapter[]>(host.ManuscriptChapters()),
  manuscriptReader: () => decodeUnchecked<ManuscriptReader>(host.ManuscriptReader()),
  readerState: () => decodeUnchecked<ReaderState>(host.ManuscriptReaderState()),
  readerStateSave: (values) =>
    decodeUnchecked<ReaderState>(host.ManuscriptSaveReaderState(values.activeChapter ?? '', values.activeSourceLine, values.expandedChapters ?? [])),
  readerBookmarkCreate: (bookmark) => decodeUnchecked<ReaderBookmark>(host.ManuscriptCreateBookmark(bookmark)),
  readerBookmarkDelete: (id) => decodeUnchecked<void>(host.ManuscriptDeleteBookmark(id)),
  manuscriptParagraphs: (chapter) => decodeUnchecked<ManuscriptParagraph[]>(host.ManuscriptParagraphs(chapter)),
  manuscriptSearch: (query) => decodeUnchecked<SearchHit[]>(host.ManuscriptSearch(query)),
  manuscriptSetChapterStatus: (chapter, status) => decodeUnchecked<ManuscriptChapter>(host.ManuscriptSetChapterStatus(chapter, status)),
  noteList: (chapter) => decodeUnchecked<ManuscriptNote[]>(host.ManuscriptNotes(chapter ?? '')),
  noteCreate: (chapterId, paragraphId, text, anchorStart, anchorEnd, anchorText) =>
    decodeUnchecked<ManuscriptNote>(host.ManuscriptCreateNote(chapterId, paragraphId, text, anchorText ?? '', anchorStart, anchorEnd)),
  noteDelete: (id) => decodeUnchecked<void>(host.ManuscriptDeleteNote(id)),
  subscribeTranscript: (onUpdate) => subscribeChecked('transcript:state', transcriptStateSchema, onUpdate),
  projectRecents: () => decodeUnchecked<RecentProject[]>(host.ProjectRecents()),
  selectProjectFolder: () => decodeUnchecked<ProjectFolderSelection>(host.ProjectSelectFolder()),
  switchProject: (path, name) => decodeUnchecked<ProjectSwitchResult>(host.ProjectSwitch(path, name ?? '')),
  createProject: (path, name) => decodeUnchecked<ProjectSwitchResult>(host.ProjectCreate(path, name ?? '')),
  removeRecentProject: (path) => decodeUnchecked<RecentProject[]>(host.ProjectRemoveRecent(path)),
  tracksDiscover: () => decodeUnchecked<TracksDiscovery>(host.TracksDiscover()),
  tracksSelect: (path) => decodeUnchecked<TracksDiscovery>(host.TracksSelect(path)),
  tracksList: () => decodeUnchecked<TracksProject>(host.TracksList()),
  teleprompterStart: (options) => decodeUnchecked<TeleprompterStartResult>(host.TeleprompterStart(options)),
  teleprompterStop: () => decodeUnchecked<void>(host.TeleprompterStop()),
  teleprompterState: () => decode(teleprompterStateSchema, 'TeleprompterState', host.TeleprompterState()),
  subscribeTeleprompterEvent: subscribeTeleprompterEvents,
  subscribeTeleprompterState: (onState) => subscribeChecked('teleprompter:state', teleprompterStateSchema, onState),
  mediaUrl: (sourceFile) => `${mediaRoute}?path=${encodeURIComponent(sourceFile)}`,
};
