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
// `matchStart` is the excerpt's own match offset (UTF-16 code units), added for the windowing helper
// (reader search and controls PRD, Phase 3) - additive, so no hostAPIVersion bump (this shape carries
// inside a map[string]any-style payload, not a fixed binding signature).
export type SearchHit = {
  chapter: string;
  chapterId?: string;
  paragraph: number;
  paragraphId?: string;
  sourceLine?: number;
  excerpt: string;
  matchStart?: number;
};
export type ManuscriptImportSection = {
  id: string;
  title: string;
  /** What follows the title in the heading ("CHAPTER ONE / Bad Ideas..."): the first paragraph's, which is what the written chapter gets. Omitted when there is none. */
  subtitle?: string;
  /**
   * Where the subtitle's line goes if the narrator says it is not a subtitle: `title` joins it to the title (a title wrapped onto two
   * lines), `body` makes it the chapter's first paragraph (a line of plain text under a plain-text heading, an epigraph say). Sent with
   * every subtitle, omitted with none (story-bible-and-import-ux-briefs PRD, Phase 5).
   */
  subtitleOff?: 'title' | 'body';
  contentKind: ManuscriptContentKind;
  paragraphCount: number;
};
export type ManuscriptCharacterCandidate = {
  id: string;
  name: string;
  description: string;
  sourceSectionId: string;
  /** Labelled facts captured from the manuscript's cast block ("Codename": "Wren"), in source order. Omitted when there are none. */
  properties?: Array<{ key: string; value: string }>;
};
export type ManuscriptImportSelection = {
  sectionKinds?: Record<string, ManuscriptContentKind>;
  characterCandidateIds?: string[];
  /** The review's "Read a heading's second line as its subtitle" default (true when unset). Review state only: the commit sends it resolved into `subtitleOverrides`. */
  subtitleDefault?: boolean;
  /** Per section id, whether its subtitle is one. In the review, the rows the narrator set by hand; on the wire, every section whose subtitle is turned off, as `false`. */
  subtitleOverrides?: Record<string, boolean>;
};
export type ManuscriptImportPreview = {
  // `pdf` remains readable for a pre-migration canonical manuscript, but the
  // native picker and shipped importer currently reject new PDF imports.
  // `txt` is Phase 1 and `epub` is Phase 2 of the txt-and-epub-import PRD.
  format: 'docx' | 'markdown' | 'txt' | 'epub' | 'pdf';
  sourceName: string;
  paragraphCount: number;
  chapterTitles: string[];
  sections?: ManuscriptImportSection[];
  characterCandidates?: ManuscriptCharacterCandidate[];
  /** What the importer repaired in the source (a title and subtitle it found run together), as sentences. Omitted when it repaired nothing. */
  notices?: string[];
};
export type ManuscriptFileSelection = { selected: boolean; jobId?: string };
export type ManuscriptReader = { chapters: ManuscriptChapter[]; paragraphs: ManuscriptParagraph[]; notes: ManuscriptNote[] };
export type WorkJob = {
  id: string | null;
  /** The wire kinds are the first two; the others are client-side jobs shown in the same work dialog (a download, the update, a recording check, the pickup and duplicate scan, the take comparison). */
  kind: 'manuscript_import' | 'story_bible' | 'app_update' | 'asset_install' | 'recording_coverage' | 'take_review' | 'take_comparison';
  phase: 'idle' | 'preparing' | 'ready' | 'committing' | 'running' | 'success' | 'cancelled' | 'error';
  message: string;
  percent: number;
  /** The bytes so far ("44 of 109 MB"), shown next to the message but never announced: it changes on nearly every poll. */
  detail?: string;
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
