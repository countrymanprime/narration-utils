import { useCallback, useEffect, useState } from 'react';
import { describeApiError } from '../../api/errorMessage';
import { useApi } from '../../api/ApiContext';
import { usePendingAction } from '../../hooks/usePendingAction';
import type { GuideDialogueCue, GuideEntity } from '../../types';
import { InsetCard } from '../primitives/InsetCard';
import { Select } from '../primitives/Select';
import type { Notify } from '../primitives/Toast';

const UNKNOWN_SPEAKER = 'unknown';

/**
 * Dialogue cues attributed to this character, or left unknown, with a correction control
 * (character-continuity-review.prd.md Phase 6: "attribution correction", via the guide's correct_cue). A rebuild
 * never overwrites a correction (ADR 0007's lock guard, applied to a cue). Self-fetching, like
 * VoiceReferencesSection - its own data source, independent of the entity edit form.
 */
export function DialogueCueAttribution({ entity, entities, notify }: { entity: GuideEntity; entities: GuideEntity[]; notify: Notify }) {
  const api = useApi();
  const mutation = usePendingAction();
  const [cues, setCues] = useState<GuideDialogueCue[]>();
  const [loadError, setLoadError] = useState<string>();

  const load = useCallback(async () => {
    try {
      setCues(await api.guideDialogueCues());
      setLoadError(undefined);
    } catch (error) {
      setLoadError(describeApiError(error));
    }
  }, [api]);
  useEffect(() => {
    void load();
  }, [load]);

  const correct = (cue: GuideDialogueCue, speakerEntityId: string) =>
    mutation.run(`correct:${cue.id}`, async () => {
      try {
        await api.guideCorrectCue(cue.id, speakerEntityId);
        notify(speakerEntityId === UNKNOWN_SPEAKER ? 'Cue cleared to unknown.' : 'Cue attribution corrected.');
        await load();
      } catch (error) {
        notify(describeApiError(error), 'error');
      }
    });

  if (loadError)
    return (
      <p className="text-sm" style={{ color: 'var(--danger-text)' }}>
        {loadError}
      </p>
    );

  const relevant = (cues ?? []).filter((cue) => cue.speaker_entity_id === entity.id || cue.speaker_entity_id === null);
  const characterOptions = [
    { value: UNKNOWN_SPEAKER, label: 'Unknown' },
    ...entities.filter((row) => row.category === 'Character').map((row) => ({ value: row.id, label: row.canonical_name })),
  ];

  if (relevant.length === 0) return null;

  return (
    <div>
      <div className="mb-1.5 text-[0.82rem] font-medium text-[var(--text-muted)]">Dialogue cues</div>
      <ul className="space-y-1.5">
        {relevant.map((cue) => (
          <InsetCard as="li" key={cue.id}>
            <p className="text-sm">“{cue.quote_text}”</p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                {cue.corrected ? 'Corrected' : cue.speaker_source === 'unknown' ? 'Unattributed' : 'Attributed'}
              </span>
              <Select
                label={`Speaker for “${cue.quote_text}”`}
                value={cue.speaker_entity_id ?? UNKNOWN_SPEAKER}
                disabled={mutation.isBusy}
                onChange={(value) => void correct(cue, value)}
                options={characterOptions}
              />
            </div>
          </InsetCard>
        ))}
      </ul>
    </div>
  );
}
