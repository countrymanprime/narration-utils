export type ChapterStatus = 'not_started' | 'recording' | 'editing' | 'proofing' | 'finalized';
export type ManuscriptContentKind = 'narration' | 'opening' | 'reference';
export type ManuscriptChapter = {
  id: string;
  title: string;
  subtitle?: string;
  index: number;
  wordCount: number;
  recordedFraction?: number;
  status: ChapterStatus;
  /** Omitted by manuscripts imported before structural classification. */
  contentKind?: ManuscriptContentKind;
  paragraphIds?: Array<{ id: string; index: number }>;
};
/** Inline formatting over a paragraph's `text`. Offsets are UTF-16 code units (JS string indexes). */
export type TextSpan = { start: number; end: number; style: 'bold' | 'italic' | 'underline' };
export type ManuscriptParagraph = {
  id: string;
  chapterId: string;
  chapter: string;
  index: number;
  sourceLine?: number;
  /** May contain "\n" for author-intended line breaks. */
  text: string;
  /** Omitted by manuscripts imported before formatting was preserved. */
  spans?: TextSpan[];
  entityIds: string[];
};
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
export type ManuscriptImportSection = {
  id: string;
  title: string;
  contentKind: ManuscriptContentKind;
  paragraphCount: number;
};
export type ManuscriptCharacterCandidate = { id: string; name: string; description: string; sourceSectionId: string };
export type ManuscriptImportSelection = {
  sectionKinds?: Record<string, ManuscriptContentKind>;
  characterCandidateIds?: string[];
};
export type ManuscriptImportPreview = {
  // `pdf` remains readable for a pre-migration canonical manuscript, but the
  // native picker and shipped importer currently reject new PDF imports.
  format: 'docx' | 'markdown' | 'pdf';
  sourceName: string;
  paragraphCount: number;
  chapterTitles: string[];
  sections?: ManuscriptImportSection[];
  characterCandidates?: ManuscriptCharacterCandidate[];
};
export type ManuscriptFileSelection = { selected: boolean; jobId?: string };
export type ManuscriptReader = { chapters: ManuscriptChapter[]; paragraphs: ManuscriptParagraph[]; notes: ManuscriptNote[] };
export type WorkJob = {
  id: string | null;
  kind: 'manuscript_import' | 'story_bible' | 'app_update';
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
  selectManuscript(): Promise<ManuscriptFileSelection>;
  /** Begins an import for the file offered as `Bootstrap.manuscriptCandidate`; the host accepts only that exact path. */
  manuscriptBeginImport(path: string): Promise<ManuscriptFileSelection>;
  manuscriptImportState(jobId: string): Promise<WorkJob>;
  manuscriptImportPreview(jobId: string, options: { markdownHeadingLevel: number }): Promise<WorkJob>;
  manuscriptImportCommit(jobId: string, options: { confirmedReset: boolean; selection?: ManuscriptImportSelection }): Promise<WorkJob>;
  manuscriptImportCancel(jobId: string): Promise<void>;
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
