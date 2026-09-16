export type ChapterStatus = 'not_started' | 'recording' | 'editing' | 'proofing' | 'finalized';
export type ManuscriptChapter = {
  id: string;
  title: string;
  subtitle?: string;
  index: number;
  wordCount: number;
  recordedFraction?: number;
  status: ChapterStatus;
  paragraphIds?: Array<{ id: string; index: number }>;
};
export type ManuscriptParagraph = { id: string; chapterId: string; chapter: string; index: number; sourceLine?: number; text: string; entityIds: string[] };
export type ManuscriptNote = {
  id: string;
  chapter: string;
  chapterId?: string;
  paragraph: number;
  paragraphId?: string;
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
  chapterId?: string;
  paragraph?: number;
  paragraphId?: string;
  sourceLine?: number;
  noteId?: string;
  createdAt: string;
};
export type ReaderState = { activeChapter?: string; activeSourceLine?: number; expandedChapters?: string[]; bookmarks: ReaderBookmark[] };
export type SearchHit = { chapter: string; chapterId?: string; paragraph: number; paragraphId?: string; sourceLine?: number; excerpt: string };
export type ManuscriptImportPreview = { format: 'docx' | 'markdown' | 'pdf'; sourceName: string; paragraphCount: number; chapterTitles: string[] };
export type ManuscriptImportSelection = { selected: boolean; jobId?: string };
export type ManuscriptReader = { chapters: ManuscriptChapter[]; paragraphs: ManuscriptParagraph[]; notes: ManuscriptNote[] };
export type WorkJob = {
  id: string | null;
  kind: 'manuscript_import' | 'story_bible';
  phase: 'idle' | 'preparing' | 'ready' | 'committing' | 'running' | 'success' | 'cancelled' | 'error';
  message: string;
  percent: number;
  logs: string[];
  elapsed: number;
  preview?: ManuscriptImportPreview | null;
  requiresReset?: boolean;
  result?: { id?: string; format?: string; sourceName?: string; importedAt?: string; message?: string } | null;
  error?: string;
};

export interface ManuscriptApi {
  selectManuscript(): Promise<ManuscriptImportSelection>;
  manuscriptImportState(jobId: string): Promise<WorkJob>;
  manuscriptImportPreview(jobId: string, markdownHeadingLevel: number): Promise<WorkJob>;
  manuscriptImportCommit(jobId: string, confirmedReset: boolean): Promise<WorkJob>;
  manuscriptImportCancel(jobId: string): Promise<void>;
  manuscriptLegacyPreview(): Promise<ManuscriptImportSelection>;
  clearProjectData(): Promise<void>;
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
  noteCreate(chapterId: string, paragraphId: string, text: string, anchorStart?: number, anchorEnd?: number, anchorText?: string): Promise<ManuscriptNote>;
  noteDelete(id: string): Promise<void>;
}
