// The mock host (mockApi.ts): character-continuity-review.prd.md Phase 6 (non-acoustic part only; D87 benches
// every acoustic-drift binding). Region listing and reference approvals over the mock's `regions`/
// `characterReferences` state (state.ts), mirroring apps/desktop/internal/character's rules closely enough for a
// component test: an opaque character id, a snapshot taken at approval, "changed since approval" computed
// against the current mock regions, and revoking an id that is not stored is not an error.
import type { ApprovedCharacterReference, CharacterReference, NarrationApi } from '../../types';
import { wireClone } from '../mockFixtures';
import type { MockState } from './state';

function referenceID(characterId: string, regionGuid: string): string {
  return `character-reference:${characterId}:${regionGuid}`;
}

function changedSinceApproval(reference: CharacterReference, s: MockState): boolean {
  const region = s.regions.find((candidate) => candidate.guid === reference.regionGuid);
  if (!region) return true;
  return region.name !== reference.snapshot.name || region.start !== reference.snapshot.start || region.end !== reference.snapshot.end;
}

/** The character bible bindings: region listing and reference approve/revoke. */
export function createCharacterMock(s: MockState) {
  const bindings = {
    characterListRegions: async () => wireClone(s.regions),
    characterApprove: async (characterId, regionGuid, note) => {
      const id = characterId.trim();
      const guid = regionGuid.trim();
      if (!id) throw new Error('a reference needs a character');
      if (!guid) throw new Error('a reference needs a region');
      const region = s.regions.find((candidate) => candidate.guid === guid);
      if (!region) throw new Error(`region ${guid} is not in the saved project; save the project in REAPER and try again`);
      const reference: CharacterReference = {
        id: referenceID(id, guid),
        characterId: id,
        regionGuid: guid,
        snapshot: { name: region.name, start: region.start, end: region.end },
        approvedAt: new Date().toISOString(),
        ...(note ? { note } : {}),
      };
      const approved: ApprovedCharacterReference = { ...reference, changedSinceApproval: false };
      const existingIndex = s.characterReferences.findIndex((row) => row.id === reference.id);
      s.characterReferences =
        existingIndex < 0 ? [...s.characterReferences, approved] : s.characterReferences.map((row, index) => (index === existingIndex ? approved : row));
      return reference;
    },
    characterRevoke: async (id) => {
      s.characterReferences = s.characterReferences.filter((row) => row.id !== id);
    },
    characterReferences: async () =>
      wireClone(s.characterReferences.map((reference) => ({ ...reference, changedSinceApproval: changedSinceApproval(reference, s) }))),
    characterRemoveVoiceData: async () => {
      s.characterReferences = [];
    },
  } satisfies Partial<NarrationApi>;
  return { bindings };
}
