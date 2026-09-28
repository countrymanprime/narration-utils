import { useState } from 'react';
import type { GuidePronunciation, GuidePronunciationStatus } from '../../types';
import { Button } from '../primitives/Button';
import { Field } from '../primitives/Field';
import { InsetCard } from '../primitives/InsetCard';
import { Select } from '../primitives/Select';
import { StatusBadge } from '../primitives/StatusBadge';
import { CommonsAudioLookup } from './CommonsAudioLookup';
import { OnlinePronunciationLookup } from './OnlinePronunciationLookup';
import { PRONUNCIATION_STATUSES, pronunciationSourceLabel, pronunciationStatusInfo, pronunciationStatusOf } from './pronunciationStatus';

// The limits the host and the sidecar enforce (guide/service.go, manuscript_guide.py); checked here too so the narrator is told first.
const MAX_USER_PRONUNCIATION = 200;
const MAX_NOTE = 1000;

// The narrator's work on one name's pronunciation (prep-depth P1, ADR 0346): its status and note, their own pronunciation typed beside
// the dictionary's, and a switch to whichever of the two is kept as the alternate. The read view shows the status, the note and what is
// kept; edit mode adds the controls. The calls are the parent's (GuideDetail), so this only holds the fields being typed.
export function PronunciationWork({
  name,
  value,
  editing,
  expanded,
  onExpandedChange,
  disabled,
  pending,
  onSaveUser,
  onUseAlternate,
  onSaveStatus,
}: {
  name: string;
  value: GuidePronunciation;
  editing: boolean;
  /** Whether the edit-mode controls are open. The parent holds it, so it stays open when a save reloads the entry. */
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  disabled: boolean;
  pending: (key: 'user' | 'alternate' | 'status') => boolean;
  onSaveUser: (ipa: string) => Promise<boolean>;
  onUseAlternate: () => void;
  onSaveStatus: (status: GuidePronunciationStatus, note: string) => void;
}) {
  const status = pronunciationStatusInfo(value);
  const [ipa, setIpa] = useState(value.source === 'user' ? value.ipa : '');
  const [statusDraft, setStatusDraft] = useState<GuidePronunciationStatus>(pronunciationStatusOf(value));
  const [note, setNote] = useState(value.note ?? '');
  const ipaText = ipa.trim();
  const ipaError = ipaText.length > MAX_USER_PRONUNCIATION ? `At most ${MAX_USER_PRONUNCIATION} characters.` : undefined;
  const noteError = note.trim().length > MAX_NOTE ? `At most ${MAX_NOTE} characters.` : undefined;
  const statusChanged = statusDraft !== pronunciationStatusOf(value) || note.trim() !== (value.note ?? '');
  const alternate = value.alternate;

  return (
    <div className="mt-2 space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-xs" style={{ color: 'var(--text-muted)' }}>
        <StatusBadge tone={status.tone} label={status.label} />
        {value.note && <span className="min-w-0 break-words">{value.note}</span>}
      </div>
      {alternate && (
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          Also kept: <span className="font-['IBM_Plex_Mono',ui-monospace,monospace]">{alternate.ipa}</span> ({pronunciationSourceLabel(alternate)})
        </p>
      )}
      {editing && (
        <Button variant="secondary" aria-expanded={expanded} onClick={() => onExpandedChange(!expanded)}>
          Pronunciation details
        </Button>
      )}
      {editing && expanded && (
        <InsetCard className="space-y-3">
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[12rem] flex-1">
              <Field label="Your pronunciation" value={ipa} onChange={setIpa} disabled={disabled} placeholder="Type how you say it" error={ipaError} />
            </div>
            <Button
              variant="secondary"
              disabled={disabled || !ipaText || Boolean(ipaError) || (value.source === 'user' && ipaText === value.ipa)}
              pending={pending('user')}
              onClick={() => void onSaveUser(ipaText)}
            >
              Use mine
            </Button>
          </div>
          <p className="-mt-1 text-xs text-[var(--text-muted)]">Kept beside the dictionary&apos;s answer; you can switch back at any time.</p>
          <OnlinePronunciationLookup name={name} disabled={disabled} onUse={setIpa} />
          <CommonsAudioLookup name={name} disabled={disabled} />
          {alternate && (
            <Button
              variant="secondary"
              disabled={disabled}
              pending={pending('alternate')}
              onClick={onUseAlternate}
              aria-label={`Use ${alternate.ipa} for ${name}`}
            >
              Use {alternate.source === 'user' ? 'yours' : alternate.source} instead
            </Button>
          )}
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <div className="mb-1 text-[0.82rem] font-medium text-[var(--text-muted)]">Status</div>
              <Select
                label={`Pronunciation status for ${name}`}
                value={statusDraft}
                onChange={(next) => setStatusDraft(PRONUNCIATION_STATUSES.find((row) => row.value === next)?.value ?? statusDraft)}
                options={PRONUNCIATION_STATUSES.map((row) => ({ value: row.value, label: row.label }))}
                disabled={disabled}
              />
            </div>
            <div className="min-w-[12rem] flex-1">
              <Field label="Pronunciation note" value={note} onChange={setNote} disabled={disabled} placeholder="Who you asked, and when" error={noteError} />
            </div>
            <Button
              variant="secondary"
              disabled={disabled || !statusChanged || Boolean(noteError)}
              pending={pending('status')}
              onClick={() => onSaveStatus(statusDraft, note.trim())}
            >
              Save status
            </Button>
          </div>
        </InsetCard>
      )}
    </div>
  );
}
