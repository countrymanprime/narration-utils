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

export interface ChapterTrackMapApi {
  chapterTrackMapList(): Promise<ChapterTrackMapping>;
  /** Confirms trackGuid as chapterId's link; refuses a chapterId outside the current manuscript. */
  chapterTrackMapConfirm(trackGuid: string, chapterId: string): Promise<TrackMapping>;
  /** Clears trackGuid's confirmed link, if any, and returns the links that remain. */
  chapterTrackMapClear(trackGuid: string): Promise<ChapterTrackMapping>;
}
