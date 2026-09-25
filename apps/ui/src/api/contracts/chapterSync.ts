import type { ChapterTrackCandidate, ChapterTrackLinksProject, TrackLinkMatch, TrackMapping } from './chapterTrackMap';

/**
 * Chapter sync (daw-chapter-track-auto-sync PRD Phase 3, ADR 0209): the narrator's one consent per project to link chapters to
 * tracks by name, the preview behind it, and what each sync did.
 */

/** The stored answer to "Sync chapters to tracks?": not asked yet, Sync, or Not now. */
export type ChapterSyncConsent = 'undecided' | 'on' | 'off';

/** What made a sync run: the consent itself, a DAW link (or a different .rpp chosen), an import, a project attach, an Undo, or
 * the watcher seeing the saved .rpp change (Phase 4: the narrator saved in REAPER). */
export type ChapterSyncTrigger = 'consent' | 'daw-link' | 'import' | 'attach' | 'undo' | 'watch';

/** Why a chapter was not linked on its own: a tie, only a guess, only a region, a pair the narrator undid, or the track
 * matches another chapter better. */
export type ChapterSyncReason = 'ambiguous' | 'uncertain' | 'region' | 'rejected' | 'not-mutual';

/** A take, pickup or credits track name ('' for none). */
export type ChapterSyncMarker = '' | 'take' | 'pickup' | 'credits';

/** The last plan in numbers. `linked` counts every link the narration chapters hold, of either origin. */
export type ChapterSyncCounts = { linked: number; needsYou: number; noTrack: number; unmatched: number; pickupTracks: number };

export type ChapterSyncTrackRef = { guid: string; name: string; index: number; marker: ChapterSyncMarker };

/** Whether a chapter's recording check is current, out of date (`stale`, with its reasons) or has never run. */
export type ChapterSyncFreshness = 'current' | 'stale' | 'never';

/**
 * One narration chapter's status without a click (Phase 6, S14): Home's row reads it instead of a Check button. The link
 * (`trackGuid`, `trackName` and `origin` are empty when the chapter has none); `freshness` and `reasons` from the recording
 * check's own evaluation against the saved project (reading it never starts a check); `checkedAt`, when the stored check
 * finished; `checking`, a check runs now. `lastChanged` is the later of `trackChangedAt` (the sync at which the track's
 * items last changed; null until a later sync sees a change) and `newestSourceAt` (the newest audio file the track plays).
 */
export type ChapterSyncChapter = {
  chapterId: string;
  chapterTitle: string;
  trackGuid: string;
  trackName: string;
  origin: '' | 'manual' | 'auto';
  freshness: ChapterSyncFreshness;
  reasons: string[];
  checkedAt: string | null;
  checking: boolean;
  trackChangedAt: string | null;
  newestSourceAt: string | null;
  lastChanged: string | null;
};

/**
 * What one sync just did, for the toast (S12: one toast per batch, "Linked track 'Ch. 7' to Chapter 7" with Undo through
 * `chapterSyncUndo(link.trackGuid)`). `newTracks` are tracks new since the last sync that match no chapter: list them
 * quietly, never in a toast. The same shape is one row of the Sync activity list (`ChapterSyncState.activity`). A batch whose
 * trigger is `watch` arrived while the narrator was in REAPER: also raise it through `systemNotify` when the window is not
 * focused (S12 B; the host never knows focus).
 */
export type ChapterSyncBatch = { at: string; trigger: ChapterSyncTrigger; linked: TrackMapping[]; newTracks: ChapterSyncTrackRef[] };

/**
 * `ChapterSyncState`'s answer, and what the `chaptersync:state` event carries. `ask`: show the consent dialog (not asked yet,
 * with a manuscript and a linked DAW project, S1). `project`: the saved .rpp's state, with `message` when it is not ready.
 * `lastSync`: the last sync's time, or null before the first. `batch`: set only on the answer or event of a sync that linked
 * something or found a new unmatched track. `unsavedEdits`: REAPER, running this project, has edits the saved file does not
 * have yet ("Unsaved changes in REAPER": sync reads the saved file, so they are picked up on the next save). `activity`: the
 * stored batches, newest first, at most 20 (the Tracks page's Sync activity).
 */
export type ChapterSyncState = {
  consent: ChapterSyncConsent;
  decidedAt: string | null;
  ask: boolean;
  manuscript: boolean;
  dawLinked: boolean;
  project: ChapterTrackLinksProject;
  message: string;
  projectFile: string;
  savedAt: string;
  lastSync: string | null;
  counts: ChapterSyncCounts;
  batch: ChapterSyncBatch | null;
  unsavedEdits: boolean;
  activity: ChapterSyncBatch[];
  /** One row per narration chapter (Phase 6), empty while the manuscript or the saved .rpp cannot be read. */
  chapters: ChapterSyncChapter[];
  /** Background recording checks (Phase 7, ADR 0211): on or off (`RecordingCoverage.background_checks`), and why none runs
   * now; `wait` is '' before the host has looked or when one just started. */
  background: { enabled: boolean; wait: ChapterSyncBackgroundWait };
};

/** Why no background check runs: off; a job the narrator started runs; the Whisper model is not installed; on battery (or the
 * power state is unknown); REAPER is running and may be recording; REAPER or the chapter changed in the last three minutes;
 * nothing has changed since its check. */
export type ChapterSyncBackgroundWait = '' | 'off' | 'busy' | 'model' | 'battery' | 'recording' | 'quiet' | 'nothing';

export type ChapterSyncAutoLink = { trackGuid: string; trackName: string; chapterId: string; chapterTitle: string; match: TrackLinkMatch };
export type ChapterSyncNeedsYou = {
  chapterId: string;
  chapterTitle: string;
  reason: ChapterSyncReason;
  /** The candidate to preselect. */
  best: ChapterTrackCandidate | null;
  candidates: ChapterTrackCandidate[];
};
export type ChapterSyncChapterRef = { chapterId: string; chapterTitle: string };
export type ChapterSyncPickupTrack = { trackGuid: string; trackName: string; chapterId: string; chapterTitle: string };

/**
 * `ChapterSyncPreview`'s answer: what Sync would do now, and nothing written. The consent dialog lists `autoLink` ("CHAPTER SIX →
 * Chapter 6"), `needsYou` (with the reason and the best candidate), `noTrack`, `unmatched` tracks and `pickupTracks`; `kept` are
 * links the chapters already hold (shown as kept). `new`, `changed`, `renamed` and `missing` compare with the last sync and are
 * empty before the first.
 */
export type ChapterSyncPreview = {
  project: ChapterTrackLinksProject;
  message: string;
  projectFile: string;
  savedAt: string;
  kept: TrackMapping[];
  autoLink: ChapterSyncAutoLink[];
  needsYou: ChapterSyncNeedsYou[];
  noTrack: ChapterSyncChapterRef[];
  unmatched: ChapterSyncTrackRef[];
  pickupTracks: ChapterSyncPickupTrack[];
  new: ChapterSyncTrackRef[];
  changed: ChapterSyncTrackRef[];
  renamed: Array<{ guid: string; name: string; previousName: string }>;
  missing: Array<{ trackGuid: string; name: string; chapterId: string }>;
};

export interface ChapterSyncApi {
  /** The consent, whether to ask, and the last sync; read-only. */
  chapterSyncState(): Promise<ChapterSyncState>;
  /** The plan a sync would carry out now; nothing is written. */
  chapterSyncPreview(): Promise<ChapterSyncPreview>;
  /** Stores Sync (true) or Not now (false), and with true runs the first sync; answers the state with its batch. */
  chapterSyncSetEnabled(on: boolean): Promise<ChapterSyncState>;
  /** Removes one automatic link and remembers the pair so sync never makes it again; a manual link is refused. */
  chapterSyncUndo(trackGuid: string): Promise<ChapterSyncState>;
  /** `chaptersync:state`: sent after each link path (a DAW link, an import, an attach), each sync or Undo, each sync the
   * watcher runs after a save in REAPER, when `unsavedEdits` changes, and when a recording check ends (its row's status). */
  subscribeChapterSync(onUpdate: (state: ChapterSyncState) => void): () => void;
}
