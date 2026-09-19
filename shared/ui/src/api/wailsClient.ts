import { normalizeGuideEntity } from '../types';
import type {
  Bootstrap,
  GuideEntity,
  GuidePreview,
  HostReady,
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

// Matches shell/media.go's mediaRoute constant.
const mediaRoute = '/media';

function normalizeTranscriptState(state: TranscriptState): TranscriptState {
  return { ...state, markerExport: state.markerExport ?? { phase: 'idle', message: '', added: 0, skipped: 0 } };
}

async function decode<T>(request: Promise<string>): Promise<T> {
  const value = await request;
  return value ? (JSON.parse(value) as T) : (undefined as T);
}

// This is intentionally an adapter, not a second component-facing API. The
// TypeScript contracts and mock client remain stable while transport moves
// from REST/SSE to Wails' generated Go binding and runtime events.
export const wailsClient: NarrationApi = {
  ready: () => host.Ready() as Promise<HostReady>,
  bootstrap: () => host.Bootstrap().then((value) => ({ ...(value as Bootstrap), transcript: normalizeTranscriptState((value as Bootstrap).transcript) })),
  selectManuscript: () => decode<ManuscriptFileSelection>(host.ManuscriptSelectFile()),
  manuscriptImportState: (jobId) => decode<WorkJob>(host.ManuscriptImportState(jobId)),
  manuscriptImportPreview: (jobId, options) => decode<WorkJob>(host.ManuscriptImportPreview(jobId, options.markdownHeadingLevel)),
  manuscriptImportCommit: (jobId, options) =>
    decode<WorkJob>(
      host.ManuscriptImportCommit(
        jobId,
        options.confirmedReset,
        (options.selection?.sectionKinds ?? {}) as Record<string, string>,
        options.selection?.characterCandidateIds ?? [],
      ),
    ),
  manuscriptImportCancel: (jobId) => decode<void>(host.ManuscriptImportCancel(jobId)),
  saveSettings: (tool, scope, values) => decode<Bootstrap>(host.SystemSaveSettings(tool, scope, values)),
  settingsForScope: (scope) => decode<Record<string, ScopedSettingField[]>>(host.SystemSettingsForScope(scope)),
  guideBuild: () => decode<WorkJob>(host.GuideBuild()),
  guideBuildState: () => decode<WorkJob>(host.GuideBuildState()),
  clearProjectData: () => decode<void>(host.ManuscriptClearProjectData(true)),
  guideEntities: () => decode<GuideEntity[] | null>(host.GuideEntities()).then((entities) => (entities ?? []).map(normalizeGuideEntity)),
  guideEdit: (id, values) => decode<void>(host.GuideEdit(id, values)),
  guideSetLocked: (id, locked) => decode<void>(host.GuideSetLocked(id, locked)),
  guideRescan: (id) => decode<void>(host.GuideRescan(id)),
  guideCreate: (name, category, aliases) => decode<{ id: string }>(host.GuideCreate(name, category, aliases)).then((value) => value.id),
  guideMerge: (sourceId, targetId) => decode<void>(host.GuideMerge(sourceId, targetId)),
  guideDelete: (id) => decode<void>(host.GuideDelete(id)),
  guideRelate: (id, otherId, label) => decode<void>(host.GuideRelate(id, otherId, label)),
  guideUnrelate: (id, otherId, label) => decode<void>(host.GuideUnrelate(id, otherId, label)),
  guidePreview: (id, aliasIndex) => decode<GuidePreview>(host.GuidePreview(id, aliasIndex)),
  ttsCatalog: () => decode<TtsCatalog>(host.TtsCatalog()),
  ttsInstall: (voiceId) => decode<TtsInstallJob>(host.TtsInstall(voiceId)),
  ttsInstallState: (jobId) => decode<TtsInstallJob>(host.TtsInstallState(jobId)),
  ttsInstallCancel: (jobId) => decode<TtsInstallJob>(host.TtsInstallCancel(jobId)),
  ttsRemove: (voiceId) => decode<void>(host.TtsRemove(voiceId)),
  whisperCatalog: () => decode<WhisperCatalog>(host.WhisperCatalog()),
  whisperInstall: (modelId) => decode<WhisperInstallJob>(host.WhisperInstall(modelId)),
  whisperInstallState: (jobId) => decode<WhisperInstallJob>(host.WhisperInstallState(jobId)),
  whisperInstallCancel: (jobId) => decode<WhisperInstallJob>(host.WhisperInstallCancel(jobId)),
  whisperRemove: (modelId) => decode<void>(host.WhisperRemove(modelId)),
  transcriptStart: (options) => decode<TranscriptStartResult>(host.TranscriptStart(options)),
  transcriptCancel: () => decode<void>(host.TranscriptCancel()),
  transcriptReset: () => decode<void>(host.TranscriptReset()),
  transcriptLastCompleted: () =>
    decode<TranscriptState | null>(host.TranscriptLastCompleted()).then((value) => (value ? normalizeTranscriptState(value) : undefined)),
  transcriptAddEquivalence: (id) => decode<{ message: string }>(host.TranscriptAddEquivalence(id)).then((value) => value.message),
  transcriptJump: (id) => decode<void>(host.TranscriptJump(id)),
  transcriptExportMarkers: () => decode<void>(host.TranscriptExportMarkers()),
  transcriptSuggestHints: () => decode<{ value: string }>(host.TranscriptSuggestHints()).then((value) => value.value),
  transcriptHints: () => decode<string[]>(host.TranscriptHints()),
  transcriptSaveHints: (accepted) => decode<void>(host.TranscriptSaveHints(accepted)),
  reportClientDiagnostic: (kind, message) => decode<void>(host.SystemReportDiagnostic(kind, message)),
  subscribeProjectAttach: (onUpdate) => EventsOn('system:attached', (payload) => onUpdate(payload as { attached: boolean; reason?: string })),
  manuscriptChapters: () => decode<ManuscriptChapter[]>(host.ManuscriptChapters()),
  manuscriptReader: () => decode<ManuscriptReader>(host.ManuscriptReader()),
  readerState: () => decode<ReaderState>(host.ManuscriptReaderState()),
  readerStateSave: (values) =>
    decode<ReaderState>(host.ManuscriptSaveReaderState(values.activeChapter ?? '', values.activeSourceLine, values.expandedChapters ?? [])),
  readerBookmarkCreate: (bookmark) => decode<ReaderBookmark>(host.ManuscriptCreateBookmark(bookmark)),
  readerBookmarkDelete: (id) => decode<void>(host.ManuscriptDeleteBookmark(id)),
  manuscriptParagraphs: (chapter) => decode<ManuscriptParagraph[]>(host.ManuscriptParagraphs(chapter)),
  manuscriptSearch: (query) => decode<SearchHit[]>(host.ManuscriptSearch(query)),
  manuscriptSetChapterStatus: (chapter, status) => decode<ManuscriptChapter>(host.ManuscriptSetChapterStatus(chapter, status)),
  noteList: (chapter) => decode<ManuscriptNote[]>(host.ManuscriptNotes(chapter ?? '')),
  noteCreate: (chapterId, paragraphId, text, anchorStart, anchorEnd, anchorText) =>
    decode<ManuscriptNote>(host.ManuscriptCreateNote(chapterId, paragraphId, text, anchorText ?? '', anchorStart, anchorEnd)),
  noteDelete: (id) => decode<void>(host.ManuscriptDeleteNote(id)),
  subscribeTranscript: (onUpdate) => EventsOn('transcript:state', (payload) => onUpdate(normalizeTranscriptState(payload as TranscriptState))),
  projectRecents: () => decode<RecentProject[]>(host.ProjectRecents()),
  selectProjectFolder: () => decode<ProjectFolderSelection>(host.ProjectSelectFolder()),
  switchProject: (path, name) => decode<ProjectSwitchResult>(host.ProjectSwitch(path, name ?? '')),
  createProject: (path, name) => decode<ProjectSwitchResult>(host.ProjectCreate(path, name ?? '')),
  removeRecentProject: (path) => decode<RecentProject[]>(host.ProjectRemoveRecent(path)),
  tracksDiscover: () => decode<TracksDiscovery>(host.TracksDiscover()),
  tracksSelect: (path) => decode<TracksDiscovery>(host.TracksSelect(path)),
  tracksList: () => decode<TracksProject>(host.TracksList()),
  mediaUrl: (sourceFile) => `${mediaRoute}?path=${encodeURIComponent(sourceFile)}`,
};
