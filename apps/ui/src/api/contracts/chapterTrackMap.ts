/** One narrator-confirmed trackGuid -> chapterId link (analysis evidence ledger PRD, Phase 5, Q6). ChapterTitle is the
 * chapter's title *at confirmation time*, stored beside the id because chapter ids reset on every manuscript
 * re-import; it is what a future re-suggestion (Q9) matches against the new chapter list. */
export type TrackMapping = {
  trackGuid: string;
  chapterId: string;
  chapterTitle: string;
  confirmedAt: string;
};

/** Every confirmed link for one manuscript document (Q6: the store is keyed by `documentId`). */
export type ChapterTrackMapping = {
  documentId: string;
  mappings: TrackMapping[];
};

/** How sure the chapter-to-track matcher is of a chapter's track (teleprompter manuscript integration PRD Phase 8,
 * ADR 0110): a narrator-confirmed link, a confident name match, a guess the narrator must confirm, a tie, or nothing. */
export type ChapterTrackMatchStatus = 'confirmed' | 'matched' | 'uncertain' | 'ambiguous' | 'none';

/** What made a track a candidate. */
export type ChapterTrackMatchSource = 'confirmed' | 'track-name' | 'region-name';

/** Something the narrator should see beside the result. */
export type ChapterTrackMatchWarning = 'confirmed-track-missing' | 'confirmed-track-renamed' | 'confirmed-links-conflict';

/** One track that may hold the chapter; `region` is the project region it was found through, if any. */
export type ChapterTrackCandidate = {
  trackGuid: string;
  trackName: string;
  trackIndex: number;
  score: number;
  source: ChapterTrackMatchSource;
  region: { name: string; start: number; end: number } | null;
};

/** Where a track's recorded audio ends, as of the .rpp's last save: in project time, and in the source file the last
 * item plays (SECTION start + SOFFS + length * PLAYRATE), which starts at `sourceStart` (SECTION start + SOFFS).
 * `approximate` when stretch markers or a looping section make the source time inexact. */
export type RecordedEnd = {
  projectTime: number;
  itemGuid: string;
  takeGuid: string;
  sourceFile: string;
  sourceStart: number;
  sourceTime: number;
  sourceAvailable: boolean;
  supported: boolean;
  approximate: boolean;
};

/** ChapterTrackMatch's answer. `track` and `recordedEnd` are set only for a confirmed or matched chapter; otherwise the
 * narrator picks from `candidates` (best first) or `tracks` (every track). Nothing is ever created. */
export type ChapterTrackMatch = {
  chapterId: string;
  chapterTitle: string;
  projectFile: string;
  /** The .rpp's modification time: the UI labels the result "as of last save". */
  savedAt: string;
  status: ChapterTrackMatchStatus;
  track: ChapterTrackCandidate | null;
  candidates: ChapterTrackCandidate[];
  warnings: ChapterTrackMatchWarning[];
  tracks: Array<{ guid: string; name: string; index: number }>;
  recordedEnd: RecordedEnd | null;
};

export interface ChapterTrackMapApi {
  chapterTrackMapList(): Promise<ChapterTrackMapping>;
  /** Confirms trackGuid as chapterId's link; refuses a chapterId outside the current manuscript. */
  chapterTrackMapConfirm(trackGuid: string, chapterId: string): Promise<TrackMapping>;
  /** Clears trackGuid's confirmed link, if any, and returns the links that remain. */
  chapterTrackMapClear(trackGuid: string): Promise<ChapterTrackMapping>;
  /** Finds the track holding chapterId in the selected .rpp and where its recorded audio ends; read-only. */
  chapterTrackMatch(chapterId: string): Promise<ChapterTrackMatch>;
}
