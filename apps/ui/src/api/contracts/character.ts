// character-continuity-review.prd.md Phase 6 (non-acoustic part only; owner decision D87 on #509 benches every
// acoustic-drift binding): region listing and reference approvals over apps/desktop/internal/character (Phase 3).

/** The reserved character id for plain narration as a first-class reference subject (Q9), matching
 * apps/desktop/internal/character.NarrationCharacterID. */
export const NARRATION_CHARACTER_ID = 'narration';

/** One region of the saved REAPER project, as CharacterListRegions sends it. */
export type CharacterRegion = { index: number; name: string; start: number; end: number; guid: string };

/** What an approval remembers of the region it names, taken at approval time (Q2): the region's own name and time
 * range, so a later change (move, rename, delete) is visible as "changed since approval". */
export type CharacterReferenceSnapshot = { name: string; start: number; end: number };

/** One approved (or previously approved) voice reference: a REAPER region approved for a character id, or for
 * `NARRATION_CHARACTER_ID`. */
export type CharacterReference = {
  id: string;
  characterId: string;
  regionGuid: string;
  snapshot: CharacterReferenceSnapshot;
  approvedAt: string;
  note?: string;
};

/** A stored reference alongside whether the region it names still matches what was approved (Q2). */
export type ApprovedCharacterReference = CharacterReference & { changedSinceApproval: boolean };

export interface CharacterApi {
  /** The saved REAPER project's regions, for the narrator to pick one to approve as a voice reference. */
  characterListRegions(): Promise<CharacterRegion[]>;
  /**
   * Approves regionGuid as a voice reference for characterId (a Story Bible entity id, or
   * `NARRATION_CHARACTER_ID`), with an optional note. Approving the same character and region again refreshes
   * the snapshot and note in place - the correction path for a reference re-approved after "changed since
   * approval" is raised.
   */
  characterApprove(characterId: string, regionGuid: string, note?: string): Promise<CharacterReference>;
  /** Removes one stored reference by id. Revoking an id that is not (or no longer) stored is not an error. */
  characterRevoke(id: string): Promise<void>;
  /** Every stored reference, each annotated with whether the region it names has changed since it was approved. */
  characterReferences(): Promise<ApprovedCharacterReference[]>;
  /**
   * Revokes every reference for the project in one action ("Remove voice data", Q7): the same data-layer effect
   * as revoking each reference one at a time.
   */
  characterRemoveVoiceData(): Promise<void>;
}
