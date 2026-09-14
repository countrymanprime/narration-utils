export type Scope = 'global' | 'project';
export type ScopedSettingField = {
  key: string;
  label: string;
  kind: 'text' | 'choice' | 'color';
  choices: string[];
  value: string;
  isSet: boolean;
  effectiveValue: string;
  effectiveSource: string;
};
export type GuideEvidence = { chapter: string; paragraph: number; excerpt: string; sourceLine?: number };
export type GuideRelationship = { id: string; name: string; label: string };
export type GuidePronunciation = { ipa: string; source: string; confidence: string };
export type GuideNote = { text: string; evidence: { chapter?: string; excerpt?: string } };
export type GuideAlias = { text: string; pronunciation: GuidePronunciation; occurrences: GuideEvidence[] };
export type GuideEntity = {
  id: string;
  canonical_name: string;
  aliases: GuideAlias[];
  category: string;
  occurrences: GuideEvidence[];
  occurrence_count: number;
  pronunciation: GuidePronunciation;
  description: GuideNote;
  personality_notes: GuideNote[];
  relationships: GuideRelationship[];
  locked: boolean;
  review_state: string;
  context?: string;
};
export type Discrepancy = {
  id: string;
  kind: string;
  name: string;
  docText: string;
  audioText: string;
  projectTime: number;
  itemIndex: number;
  srcpos: number;
  chapter?: string;
  paragraph?: number;
  sourceLine?: number;
  scriptContext?: string;
  audioContext?: string;
};
export type TranscriptState = {
  runId?: string;
  phase: 'idle' | 'preparing' | 'running' | 'need_chapter' | 'success' | 'cancelled' | 'error';
  percent: number;
  message: string;
  logs: string[];
  chapters: string[];
  rows: Discrepancy[];
  diff: string;
  summary: string;
  elapsed: number;
};
export type Bootstrap = {
  apiVersion: number;
  diagnosticId: string;
  projectFolder: string;
  projectName: string;
  daw: string;
  manuscriptPath: string;
  runtime: Record<string, string>;
  transcript: TranscriptState;
};
export type HostReady = { apiVersion: number; diagnosticId: string };

export type ChapterStatus = 'not_started' | 'recording' | 'editing' | 'proofing' | 'finalized';
export type ManuscriptChapter = {
  id: string;
  title: string;
  subtitle?: string;
  index: number;
  wordCount: number;
  recordedFraction?: number;
  status: ChapterStatus;
};
export type ManuscriptParagraph = { chapter: string; index: number; sourceLine?: number; text: string; entityIds: string[] };
export type ManuscriptNote = {
  id: string;
  chapter: string;
  paragraph: number;
  text: string;
  createdAt: string;
  anchorStart?: number;
  anchorEnd?: number;
  anchorText?: string;
};
export type ReaderBookmark = {
  id: string;
  kind: 'chapter' | 'line' | 'note';
  chapter: string;
  paragraph?: number;
  sourceLine?: number;
  noteId?: string;
  createdAt: string;
};
export type ReaderState = { activeChapter?: string; activeSourceLine?: number; expandedChapters?: string[]; bookmarks: ReaderBookmark[] };
export type SearchHit = { chapter: string; paragraph: number; sourceLine?: number; excerpt: string };
export type ManuscriptReader = { chapters: ManuscriptChapter[]; paragraphs: ManuscriptParagraph[]; notes: ManuscriptNote[] };

export interface NarrationApi {
  ready(): Promise<HostReady>;
  bootstrap(): Promise<Bootstrap>;
  poll(revision: number): Promise<{ revision: number; transcript: TranscriptState }>;
  selectManuscript(): Promise<{ path: string }>;
  saveSettings(tool: string, scope: Scope, values: Record<string, string | null>): Promise<Bootstrap>;
  settingsForScope(scope: Scope): Promise<Record<string, ScopedSettingField[]>>;
  guideBuild(): Promise<string>;
  guideEntities(): Promise<GuideEntity[]>;
  guideEdit(id: string, values: Record<string, string>): Promise<void>;
  guideSetLocked(id: string, locked: boolean): Promise<void>;
  guideRescan(id: string): Promise<void>;
  guideCreate(name: string, category: string, aliases: string[]): Promise<string>;
  guideMerge(sourceId: string, targetId: string): Promise<void>;
  guideDelete(id: string): Promise<void>;
  guideRelate(id: string, otherId: string, label: string): Promise<void>;
  guideUnrelate(id: string, otherId: string, label: string): Promise<void>;
  guideExport(): Promise<string>;
  guidePreview(id: string, aliasIndex?: number): Promise<string>;
  transcriptStart(options: { model: string; chunk: string; workers: string; hints: string; chapterTitle?: string }): Promise<void>;
  transcriptCancel(): Promise<void>;
  transcriptReset(): Promise<void>;
  transcriptLastCompleted(): Promise<TranscriptState | undefined>;
  transcriptAddEquivalence(id: string): Promise<string>;
  transcriptJump(id: string): Promise<void>;
  transcriptSuggestHints(): Promise<string>;
  transcriptHints(): Promise<string[]>;
  transcriptSaveHints(accepted: string[]): Promise<void>;
  reportClientDiagnostic(kind: string, message: string): Promise<void>;
  manuscriptChapters(): Promise<ManuscriptChapter[]>;
  manuscriptParagraphs(chapter: string): Promise<ManuscriptParagraph[]>;
  manuscriptSearch(query: string): Promise<SearchHit[]>;
  manuscriptSetChapterStatus(chapter: string, status: ChapterStatus): Promise<ManuscriptChapter>;
  noteList(chapter?: string): Promise<ManuscriptNote[]>;
  manuscriptReader(): Promise<ManuscriptReader>;
  readerState(): Promise<ReaderState>;
  readerStateSave(values: Pick<ReaderState, 'activeChapter' | 'activeSourceLine' | 'expandedChapters'>): Promise<ReaderState>;
  readerBookmarkCreate(bookmark: Omit<ReaderBookmark, 'id' | 'createdAt'>): Promise<ReaderBookmark>;
  readerBookmarkDelete(id: string): Promise<void>;
  noteCreate(chapter: string, paragraph: number, text: string, anchorStart?: number, anchorEnd?: number, anchorText?: string): Promise<ManuscriptNote>;
  noteDelete(id: string): Promise<void>;
  /** Subscribes to live transcript-run updates (SSE in httpClient; a simple
   * synchronous replay in mockApi). Returns an unsubscribe function. Only the
   * Proofing page uses this - every other method above is plain request/response. */
  subscribeTranscript(onUpdate: (state: TranscriptState) => void): () => void;
}
