// The mock host (mockApi.ts): character-continuity-review.prd.md Phase 11 (D87 benches every acoustic-drift
// binding, so this is reference data only). Series membership over `s.series`, and the voice bible pooled from the
// current project's own `s.characterReferences` plus WIRE_SERIES_SIBLING_CLIPS - a second book this mock never
// actually opens, so its clips are canned rather than simulated through a second MockState.
import type { NarrationApi, Series, SeriesVoiceBible, SeriesVoiceBibleCharacter, SeriesVoiceBibleClip } from '../../types';
import { WIRE_SERIES_SIBLING_CLIPS, wireClone } from '../mockFixtures';
import type { MockState } from './state';

// The mock always represents this one project (mockHost/project.ts's DEFAULT_PROJECT_FOLDER); a narrator switching
// projects is a different app launch in this demo, not a live folder change this mock tracks.
const CURRENT_PROJECT = 'C:/Projects/Alice-in-Wonderland';
const CURRENT_BOOK = 'Alice-in-Wonderland';

export function createSeriesMock(s: MockState, entityName: (characterId: string) => string | undefined) {
  const forCurrentProject = () => s.series.find((series) => series.memberProjectPaths.includes(CURRENT_PROJECT));

  const bindings = {
    seriesVoiceBible: async (): Promise<SeriesVoiceBible> => {
      const series = forCurrentProject();
      if (!series) return { inSeries: false, bookCount: 0 };
      const bookCount = series.memberProjectPaths.length;
      if (bookCount <= 1) return { inSeries: true, seriesId: series.id, seriesName: series.name, bookCount };

      const byCharacter = new Map<string, SeriesVoiceBibleCharacter>();
      const order: string[] = [];
      const addClip = (characterId: string, clip: SeriesVoiceBibleClip) => {
        let row = byCharacter.get(characterId);
        if (!row) {
          row = { characterId, name: entityName(characterId) ?? characterId, clips: [] };
          byCharacter.set(characterId, row);
          order.push(characterId);
        }
        row.clips.push(clip);
      };

      for (const reference of s.characterReferences) {
        addClip(reference.characterId, {
          id: reference.id,
          projectPath: CURRENT_PROJECT,
          book: CURRENT_BOOK,
          isCurrentProject: true,
          regionGuid: reference.regionGuid,
          name: reference.snapshot.name,
          start: reference.snapshot.start,
          end: reference.snapshot.end,
          approvedAt: reference.approvedAt,
          ...(reference.note ? { note: reference.note } : {}),
          changedSinceApproval: reference.changedSinceApproval,
        });
      }
      for (const { characterId, clip } of WIRE_SERIES_SIBLING_CLIPS) addClip(characterId, clip);

      const characters = order
        .map((id) => byCharacter.get(id)!)
        .map((row) => ({ ...row, clips: [...row.clips].sort((a, b) => a.approvedAt.localeCompare(b.approvedAt)) }))
        .sort((a, b) => a.name.localeCompare(b.name));
      return { inSeries: true, seriesId: series.id, seriesName: series.name, bookCount, characters };
    },
    seriesList: async () => wireClone(s.series),
    seriesSave: async (id: string, name: string, memberProjectPaths: string[]) => {
      const trimmedName = name.trim();
      if (!trimmedName) throw new Error('a series needs a name');
      const cleaned = [...new Set(memberProjectPaths.map((path) => path.trim()).filter(Boolean))];
      const saved: Series = { id: id || `series-${s.nextId++}`, name: trimmedName, memberProjectPaths: cleaned };
      const existingIndex = s.series.findIndex((series) => series.id === saved.id);
      s.series = existingIndex < 0 ? [...s.series, saved] : s.series.map((series, index) => (index === existingIndex ? saved : series));
      return wireClone(saved);
    },
    seriesDelete: async (id: string) => {
      s.series = s.series.filter((series) => series.id !== id);
    },
  } satisfies Partial<NarrationApi>;
  return { bindings };
}
