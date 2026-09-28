// character-continuity-review.prd.md Phase 11 (D87 benches every acoustic-drift binding, so this is reference data
// only, Q11): the Series tab of the Story Bible. A series is a narrator-named group of projects (books, Q10); the
// voice bible pools each member book's approved character reference clips by character, and says which book each
// clip came from.

/** A narrator-named group of projects that share character references (Q10). */
export type Series = { id: string; name: string; memberProjectPaths: string[] };

/** One approved reference clip in the series voice bible, flattened from a character.Reference so a sibling book's
 * clip (read cross-project, never verified against its own saved REAPER project) and the current project's own
 * clip (already annotated by `characterReferences`) share one shape. */
export type SeriesVoiceBibleClip = {
  id: string;
  projectPath: string;
  /** The source project folder's own name - a plain, always-available label, not a narrator-edited title. */
  book: string;
  isCurrentProject: boolean;
  regionGuid: string;
  name: string;
  start: number;
  end: number;
  approvedAt: string;
  note?: string;
  /** Only known for the current project's own clip; absent for a sibling book's clip. */
  changedSinceApproval?: boolean;
};

/** One character's approved reference clips pooled across every book of the series that has approved one. */
export type SeriesVoiceBibleCharacter = { characterId: string; name: string; clips: SeriesVoiceBibleClip[] };

/** The Series tab's whole view of the current project's series. `characters` is absent whenever there is nothing to
 * show - the project is not in any series, or its series has no other book yet - so the tab can render one honest
 * "no other books in this series yet" state instead of an empty list. */
export type SeriesVoiceBible = {
  inSeries: boolean;
  seriesId?: string;
  seriesName?: string;
  bookCount: number;
  characters?: SeriesVoiceBibleCharacter[];
  /** Book labels of any member project whose reference data exists but could not be read - reported, never fatal. */
  unreadableBooks?: string[];
};

export interface SeriesApi {
  /** The current project's Series tab view: its series membership and, once a second book has data to share, every
   * member book's characters and approved reference clips. */
  seriesVoiceBible(): Promise<SeriesVoiceBible>;
  /** Every series the narrator has created, for managing series membership. */
  seriesList(): Promise<Series[]>;
  /** Creates a series (id empty) or updates one in place (an existing id), naming it and setting its member project
   * paths. The narrator adds and removes books this way; there is no separate add/remove call. */
  seriesSave(id: string, name: string, memberProjectPaths: string[]): Promise<Series>;
  /** Removes a series by id. Deleting an id that is not present is not an error. */
  seriesDelete(id: string): Promise<void>;
}
