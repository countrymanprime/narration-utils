// Talks to the /api/* REST + SSE surface exposed by shared/server/app.py.
// The UI runs in a plain browser tab pointed at that loopback server.
// Every method maps directly to an API route.
import type {
  Bootstrap,
  ChapterStatus,
  GuideEntity,
  HostReady,
  ManuscriptChapter,
  ManuscriptImportSelection,
  WorkJob,
  ManuscriptNote,
  ManuscriptParagraph,
  ManuscriptReader,
  NarrationApi,
  ReaderBookmark,
  ReaderState,
  Scope,
  ScopedSettingField,
  SearchHit,
  TranscriptState,
} from '../types';

// Defends against a stale/hand-edited guide.json on disk (predating a field,
// or an entity missing one) reaching render code that assumes these arrays
// are always present - see the Story Bible "blank page" incident.
function normalizeGuideEntity(entity: GuideEntity): GuideEntity {
  return {
    ...entity,
    aliases: (entity.aliases ?? []).map((alias) => ({ ...alias, occurrences: alias.occurrences ?? [] })),
    occurrences: entity.occurrences ?? [],
    personality_notes: entity.personality_notes ?? [],
    relationships: entity.relationships ?? [],
  };
}

// Older persisted comparison snapshots predate manual marker export. Keep
// them reviewable after an upgrade instead of assuming the new state exists.
function normalizeTranscriptState(state: TranscriptState): TranscriptState {
  return { ...state, markerExport: state.markerExport ?? { phase: 'idle', message: '', added: 0, skipped: 0 } };
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text();
    let message = text;
    try {
      message = JSON.parse(text).error ?? text;
    } catch {
      /* not JSON - use raw text */
    }
    throw new Error(message || `${method} ${path} failed with ${response.status}`);
  }
  if (response.status === 204 || response.headers.get('content-length') === '0') return undefined as T;
  const text = await response.text();
  return text ? (JSON.parse(text) as T) : (undefined as T);
}

const get = <T>(path: string) => request<T>('GET', path);
const post = <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {});
const put = <T>(path: string, body?: unknown) => request<T>('PUT', path, body ?? {});
const patch = <T>(path: string, body?: unknown) => request<T>('PATCH', path, body ?? {});
const del = <T>(path: string) => request<T>('DELETE', path);

export const httpClient: NarrationApi = {
  ready: () => get<HostReady>('/api/health'),
  bootstrap: () => get<Bootstrap>('/api/bootstrap').then((value) => ({ ...value, transcript: normalizeTranscriptState(value.transcript) })),
  poll: () =>
    get<{ revision: number; transcript: TranscriptState }>('/api/transcript/state').then((value) => ({
      ...value,
      transcript: normalizeTranscriptState(value.transcript),
    })),
  selectManuscript: () => post<ManuscriptImportSelection>('/api/manuscript/select-file'),
  manuscriptImportState: (jobId) => get<WorkJob>(`/api/manuscript/import/${encodeURIComponent(jobId)}`),
  manuscriptImportPreview: (jobId, markdownHeadingLevel) =>
    post<WorkJob>(`/api/manuscript/import/${encodeURIComponent(jobId)}/preview`, { markdownHeadingLevel }),
  manuscriptImportCommit: (jobId, confirmedReset) => post<WorkJob>(`/api/manuscript/import/${encodeURIComponent(jobId)}/commit`, { confirmedReset }),
  manuscriptImportCancel: (jobId) => post(`/api/manuscript/import/${encodeURIComponent(jobId)}/cancel`),
  manuscriptLegacyPreview: () => post<ManuscriptImportSelection>('/api/manuscript/import/legacy-preview'),
  saveSettings: (tool, scope, values) => put<Bootstrap>(`/api/settings/${tool}/${scope}`, values),
  settingsForScope: (scope) => get<Record<string, ScopedSettingField[]>>(`/api/settings?scope=${scope}`),
  guideBuild: () => post<WorkJob>('/api/guide/build'),
  guideBuildState: () => get<WorkJob>('/api/guide/build'),
  clearProjectData: () => post('/api/project-data/clear', { confirmed: true }),
  guideEntities: () => get<GuideEntity[]>('/api/guide/entities').then((entities) => entities.map(normalizeGuideEntity)),
  guideEdit: (id, values) => patch(`/api/guide/entities/${id}`, values),
  guideSetLocked: (id, locked) => put(`/api/guide/entities/${id}/locked`, { locked }),
  guideRescan: (id) => post(`/api/guide/entities/${id}/rescan`),
  guideCreate: (name, category, aliases) => post<{ id: string }>('/api/guide/entities', { name, category, aliases }).then((r) => r.id),
  guideMerge: (sourceId, targetId) => post('/api/guide/merge', { sourceId, targetId }),
  guideDelete: (id) => del(`/api/guide/entities/${id}`),
  guideRelate: (id, otherId, label) => post('/api/guide/relationships', { id, otherId, label }),
  guideUnrelate: (id, otherId, label) =>
    del(`/api/guide/relationships?id=${encodeURIComponent(id)}&otherId=${encodeURIComponent(otherId)}&label=${encodeURIComponent(label)}`),
  guideExport: () => get<{ path: string }>('/api/guide/export').then((r) => r.path),
  guidePreview: (id, aliasIndex) =>
    get<{ url: string }>(`/api/guide/entities/${id}/preview${aliasIndex !== undefined ? `?aliasIndex=${aliasIndex}` : ''}`).then((r) => r.url),
  transcriptStart: (options) => post('/api/transcript/start', options),
  transcriptCancel: () => post('/api/transcript/cancel'),
  transcriptReset: () => post('/api/transcript/reset'),
  transcriptLastCompleted: () =>
    get<TranscriptState | null>('/api/transcript/last-completed').then((value) => (value ? normalizeTranscriptState(value) : undefined)),
  transcriptAddEquivalence: (id) => post<{ message: string }>(`/api/transcript/discrepancies/${id}/equivalence`).then((r) => r.message),
  transcriptJump: (id) => post(`/api/transcript/discrepancies/${id}/jump`),
  transcriptExportMarkers: () => post('/api/transcript/markers/export'),
  transcriptSuggestHints: () => get<{ value: string }>('/api/transcript/hints/suggestions').then((r) => r.value),
  transcriptHints: () => get('/api/transcript/hints'),
  transcriptSaveHints: (accepted) => put('/api/transcript/hints', accepted),
  reportClientDiagnostic: (kind, message) => post('/api/diagnostics', { kind, message }),
  manuscriptChapters: () => get<ManuscriptChapter[]>('/api/manuscript/chapters'),
  manuscriptReader: () => get<ManuscriptReader>('/api/manuscript/reader'),
  readerState: () => get<ReaderState>('/api/manuscript/reader-state'),
  readerStateSave: (values) => put<ReaderState>('/api/manuscript/reader-state', values),
  readerBookmarkCreate: (bookmark) => post<ReaderBookmark>('/api/manuscript/bookmarks', bookmark),
  readerBookmarkDelete: (id) => del(`/api/manuscript/bookmarks/${encodeURIComponent(id)}`),
  manuscriptParagraphs: (chapter) => get<ManuscriptParagraph[]>(`/api/manuscript/chapters/${encodeURIComponent(chapter)}/paragraphs`),
  manuscriptSearch: (query) => get<SearchHit[]>(`/api/manuscript/search?q=${encodeURIComponent(query)}`),
  manuscriptSetChapterStatus: (chapter, status) => put<ManuscriptChapter>(`/api/manuscript/chapters/${encodeURIComponent(chapter)}/status`, { status }),
  noteList: (chapter) => get<ManuscriptNote[]>(`/api/manuscript/notes${chapter ? `?chapter=${encodeURIComponent(chapter)}` : ''}`),
  noteCreate: (chapterId, paragraphId, text, anchorStart, anchorEnd, anchorText) =>
    post<ManuscriptNote>('/api/manuscript/notes', { chapterId, paragraphId, text, anchorStart, anchorEnd, anchorText }),
  noteDelete: (id) => del(`/api/manuscript/notes/${id}`),
  subscribeTranscript: (onUpdate) => {
    const source = new EventSource('/api/transcript/events');
    source.onmessage = (event) => {
      try {
        onUpdate(normalizeTranscriptState(JSON.parse(event.data) as TranscriptState));
      } catch {
        /* malformed frame - ignore */
      }
    };
    return () => source.close();
  },
};
