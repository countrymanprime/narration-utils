import { useState } from 'react';
import { describeApiError } from '../../api/errorMessage';
import { useApi } from '../../api/ApiContext';
import { usePendingAction } from '../../hooks/usePendingAction';
import { NARRATION_CHARACTER_ID } from '../../types';
import { Button } from '../primitives/Button';
import { ConfirmDialog } from '../primitives/ConfirmDialog';
import { SlideOver } from '../primitives/SlideOver';
import type { Notify } from '../primitives/Toast';
import { VoiceReferencesSection } from './VoiceReferencesSection';

/**
 * Project-wide voice-reference actions (character-continuity-review.prd.md Phase 6, non-acoustic part): approving
 * a reference for plain narration as a first-class reference subject (Q9 - Phase 3's approval layer already
 * accepts NARRATION_CHARACTER_ID like any other opaque character id), and "Remove voice data" (Q7): revoking
 * every reference for the project in one action, delivered here rather than Phase 7 per owner decision D87.
 */
export function VoiceDataPanel({ open, onClose, notify }: { open: boolean; onClose: () => void; notify: Notify }) {
  const api = useApi();
  const mutation = usePendingAction();
  const [confirmingRemoveAll, setConfirmingRemoveAll] = useState(false);
  // Remounts VoiceReferencesSection's own load() when a removal or the panel reopening should show the fresh
  // (now-empty) reference list, without this panel owning that data itself.
  const [refreshKey, setRefreshKey] = useState(0);

  const removeAll = () =>
    mutation.run('remove-all', async () => {
      try {
        await api.characterRemoveVoiceData();
        notify('Every voice reference was removed.');
        setConfirmingRemoveAll(false);
        setRefreshKey((key) => key + 1);
      } catch (error) {
        notify(describeApiError(error), 'error');
      }
    });

  return (
    <SlideOver open={open} title="Voice data" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          Approve a reference for plain narration here - a character's own references live on its entry. Remove voice data clears every approved reference in
          the project; nothing else about the Story Bible changes.
        </p>
        <VoiceReferencesSection key={refreshKey} characterId={NARRATION_CHARACTER_ID} characterLabel="Narration" notify={notify} />
        <div className="border-t pt-4" style={{ borderColor: 'var(--border)' }}>
          <Button variant="danger" onClick={() => setConfirmingRemoveAll(true)}>
            Remove voice data…
          </Button>
        </div>
      </div>
      {confirmingRemoveAll && (
        <ConfirmDialog
          title="Remove voice data"
          body="Revoke every approved voice reference in this project, for every character and for Narration? This cannot be undone; the manuscript, dialogue cues and everything else in the Story Bible stay as they are."
          confirmLabel="Remove voice data"
          confirmVariant="danger"
          pending={mutation.isPending('remove-all')}
          confirm={() => void removeAll()}
          cancel={() => setConfirmingRemoveAll(false)}
        />
      )}
    </SlideOver>
  );
}
