import { useCallback, useEffect, useState } from 'react';
import { faPlay } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { describeApiError } from '../../api/errorMessage';
import { useApi } from '../../api/ApiContext';
import { usePendingAction } from '../../hooks/usePendingAction';
import type { ApprovedCharacterReference, CharacterRegion } from '../../types';
import { Button } from '../primitives/Button';
import { IconButton } from '../primitives/IconButton';
import { InsetCard } from '../primitives/InsetCard';
import { Select } from '../primitives/Select';
import { StatusBadge } from '../primitives/StatusBadge';
import { TextField } from '../primitives/TextField';
import type { Notify } from '../primitives/Toast';

/** mm:ss, the region-length format the mock's reference clip rows use (06-series-voice-bible-concept.webp); this
 * view never sees a region longer than about an hour, so no hour component is needed. Exported for the Series tab
 * (components/series/SeriesTab.tsx, Phase 11), which reuses this formatting for the same clips read cross-project. */
export function formatRegionTime(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(whole / 60);
  const remaining = whole % 60;
  return `${minutes}:${String(remaining).padStart(2, '0')}`;
}

/**
 * One character's (or Narration's) approved voice references: the region list to approve one from, and the
 * approved list with revoke (character-continuity-review.prd.md Phase 6, non-acoustic part - owner decision D87
 * on #509 benches every acoustic-drift binding, so there is no drift comparison or audition here, only approval).
 * Self-fetching (PronunciationQueries.tsx's pattern): its own data source, independent of the entity edit form.
 */
export function VoiceReferencesSection({ characterId, characterLabel, notify }: { characterId: string; characterLabel: string; notify: Notify }) {
  const api = useApi();
  const mutation = usePendingAction();
  const [regions, setRegions] = useState<CharacterRegion[]>();
  const [references, setReferences] = useState<ApprovedCharacterReference[]>();
  const [loadError, setLoadError] = useState<string>();
  const [regionGuid, setRegionGuid] = useState('');
  const [note, setNote] = useState('');

  const load = useCallback(async () => {
    try {
      const [nextRegions, nextReferences] = await Promise.all([api.characterListRegions(), api.characterReferences()]);
      setRegions(nextRegions);
      setReferences(nextReferences);
      setLoadError(undefined);
    } catch (error) {
      setLoadError(describeApiError(error));
    }
  }, [api]);
  useEffect(() => {
    void load();
  }, [load]);

  const ownReferences = (references ?? []).filter((reference) => reference.characterId === characterId);

  const approve = () =>
    mutation.run('approve', async () => {
      if (!regionGuid) return;
      try {
        await api.characterApprove(characterId, regionGuid, note.trim() || undefined);
        setRegionGuid('');
        setNote('');
        notify('Reference approved.');
        await load();
      } catch (error) {
        notify(describeApiError(error), 'error');
      }
    });
  const revoke = (reference: ApprovedCharacterReference) =>
    mutation.run(`revoke:${reference.id}`, async () => {
      try {
        await api.characterRevoke(reference.id);
        notify('Reference revoked.');
        await load();
      } catch (error) {
        notify(describeApiError(error), 'error');
      }
    });
  // No binding plays a region's real audio in-app yet (character-continuity-review.prd.md Phase 6 scope is
  // bindings + UI over the region and reference data that already exists; a REAPER-side "play this region"
  // command would be a new Lua bridge command, integrations/reaper territory, owned by lane B). Matches the
  // existing "Voice-sample picker is a future integration." notice this section replaces.
  const play = () => notify('Playing a reference clip in the app is a future integration; open it in REAPER by its name for now.');

  if (loadError)
    return (
      <p className="text-sm" style={{ color: 'var(--danger-text)' }}>
        {loadError}
      </p>
    );

  return (
    <div>
      <div className="mb-1.5 text-[0.82rem] font-medium text-[var(--text-muted)]">Reference clips</div>
      {ownReferences.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          No reference clips approved yet.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {ownReferences.map((reference) => (
            <InsetCard as="li" key={reference.id} className="flex items-center gap-2">
              <IconButton label={`Play ${reference.snapshot.name}`} onClick={play}>
                <FontAwesomeIcon icon={faPlay} />
              </IconButton>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{reference.snapshot.name}</div>
                <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  {formatRegionTime(reference.snapshot.start)}–{formatRegionTime(reference.snapshot.end)}
                  {reference.note ? ` · ${reference.note}` : ''}
                </div>
              </div>
              {reference.changedSinceApproval && <StatusBadge tone="warning" label="Changed since approval" />}
              <Button variant="ghost" className="text-xs" pending={mutation.isPending(`revoke:${reference.id}`)} onClick={() => void revoke(reference)}>
                Revoke
              </Button>
            </InsetCard>
          ))}
        </ul>
      )}
      <div className="mt-2 flex flex-wrap items-end gap-2">
        <Select
          label={`Approve a region for ${characterLabel}`}
          value={regionGuid}
          onChange={setRegionGuid}
          options={[
            { value: '', label: 'Choose a region…' },
            ...(regions ?? []).map((region) => ({ value: region.guid, label: region.name || `Region ${region.index}` })),
          ]}
        />
        <TextField label="Note (optional)" value={note} onChange={setNote} placeholder="e.g. anchor take, chapter 1" />
        <Button variant="ghost" className="text-xs" disabled={!regionGuid} pending={mutation.isPending('approve')} onClick={() => void approve()}>
          Approve as reference
        </Button>
      </div>
    </div>
  );
}
