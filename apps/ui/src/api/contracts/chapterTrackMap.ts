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

/** One chapter a track may hold (the matcher's track-to-chapter direction, ADR 0113). */
export type ChapterCandidate = {
  chapterId: string;
  chapterTitle: string;
  score: number;
  source: ChapterTrackMatchSource;
  region: { name: string; start: number; end: number } | null;
};

/** Which saved tracks a suggestion was read from: the record-armed ones, else the selected ones, else none. */
export type ChapterSuggestionBasis = 'armed' | 'selected' | 'none';

/** ChapterSuggestion's answer (teleprompter-engines-and-input-devices PRD Phase 11, ADR 0113): the chapter the narrator is
 * most likely recording, read from the selected .rpp as of its last save. `chapter` is set only when `status` is
 * confirmed or matched; otherwise `candidates` are choices to offer, never to preselect. `track` is the one track read,
 * or null when several were (or none). */
export type ChapterSuggestion = {
  projectFile: string;
  savedAt: string;
  basis: ChapterSuggestionBasis;
  track: { guid: string; name: string; index: number } | null;
  status: ChapterTrackMatchStatus;
  chapter: ChapterCandidate | null;
  candidates: ChapterCandidate[];
  warnings: Array<ChapterTrackMatchWarning | 'confirmed-chapter-missing'>;
};

/** ChapterTrackSet's answer (chapter-track-link-control PRD Phase 1): the chapter's one link as written, the link the
 * track held for another chapter before (null when the track was free), and every link that remains. */
export type ChapterTrackSetResult = {
  documentId: string;
  link: TrackMapping;
  displaced: TrackMapping | null;
  mappings: TrackMapping[];
};

/** Whether the saved .rpp could be read: ready, none found, several found and none chosen, or unreadable. */
export type ChapterTrackLinksProject = 'ready' | 'none' | 'choose' | 'error';

/** One track's facts as of the .rpp's last save. `playableCount` counts supported items whose source is present;
 * `span` runs from the first item's start to the last item's end (null with no items); `linkedChapterId` is the chapter
 * the track is confirmed for, '' when none. */
export type ChapterTrackSummary = {
  guid: string;
  index: number;
  name: string;
  color: string;
  muted: boolean;
  soloed: boolean;
  itemCount: number;
  playableCount: number;
  missingSourceCount: number;
  unsupportedCount: number;
  span: { start: number; end: number } | null;
  linkedChapterId: string;
};

/** One narration chapter's link state: the matcher's answer, every confirmed link it holds (a missing track's too), and
 * where the matched track's audio ends. */
export type ChapterTrackLink = {
  chapterId: string;
  chapterTitle: string;
  status: ChapterTrackMatchStatus;
  track: ChapterTrackCandidate | null;
  candidates: ChapterTrackCandidate[];
  warnings: ChapterTrackMatchWarning[];
  links: TrackMapping[];
  recordedEnd: RecordedEnd | null;
};

/** ChapterTrackLinks' answer: every narration chapter and every track from one parse of the saved .rpp. When `project`
 * is not ready, `message` says why, `tracks` is empty and each chapter's status is `none`, with its links still listed. */
export type ChapterTrackLinks = {
  project: ChapterTrackLinksProject;
  message: string;
  projectFile: string;
  savedAt: string;
  tracks: ChapterTrackSummary[];
  chapters: ChapterTrackLink[];
};

export interface ChapterTrackMapApi {
  chapterTrackMapList(): Promise<ChapterTrackMapping>;
  /** Confirms trackGuid as chapterId's link; refuses a chapterId outside the current manuscript. */
  chapterTrackMapConfirm(trackGuid: string, chapterId: string): Promise<TrackMapping>;
  /** Clears trackGuid's confirmed link, if any, and returns the links that remain. */
  chapterTrackMapClear(trackGuid: string): Promise<ChapterTrackMapping>;
  /** Makes trackGuid chapterId's one link, replacing its old one; `displaced` names the chapter the track was taken from. */
  chapterTrackSet(chapterId: string, trackGuid: string): Promise<ChapterTrackSetResult>;
  /** Clears every link chapterId holds and returns the links that remain. */
  chapterTrackUnlink(chapterId: string): Promise<ChapterTrackMapping>;
  /** Every narration chapter's link state and track facts from one parse of the saved .rpp; read-only. */
  chapterTrackLinks(): Promise<ChapterTrackLinks>;
  /** Finds the track holding chapterId in the selected .rpp and where its recorded audio ends; read-only. */
  chapterTrackMatch(chapterId: string): Promise<ChapterTrackMatch>;
  /** Suggests the chapter being recorded from the selected .rpp's armed (else selected) track; read-only. */
  chapterSuggestion(): Promise<ChapterSuggestion>;
}
