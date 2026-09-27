import { useCallback, useEffect, useState } from 'react';
import { apiErrorMessage } from '../../api/errorMessage';
import { useApi } from '../../api/ApiContext';
import type { PronunciationOnlineKeyStatus } from '../../types';
import { Button } from '../primitives/Button';
import { Field } from '../primitives/Field';
import { StatusBadge } from '../primitives/StatusBadge';
import type { Notify } from '../primitives/Toast';

/**
 * The narrator's own Merriam-Webster key (prep-depth P9; ADR 0405 point 2, ADR 0350): get a free one from the sign-up page
 * (opened in the browser), paste it here, remove it any time. The key goes to the host once and never comes back: this
 * panel only ever knows whether one is saved. What an online lookup sends is said here in plain words (D72).
 */
export function OnlineDictionaryPanel({ notify }: { notify: Notify }) {
  const api = useApi();
  const [status, setStatus] = useState<PronunciationOnlineKeyStatus | undefined>();
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState<'save' | 'remove' | 'signup' | undefined>();

  const load = useCallback(async () => {
    try {
      setStatus(await api.pronunciationOnlineKeyStatus());
    } catch (reason) {
      setError(apiErrorMessage(reason));
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    setBusy('save');
    setError(undefined);
    try {
      setStatus(await api.pronunciationOnlineKeySet(draft));
      setDraft('');
      notify('Merriam-Webster key saved.');
    } catch (reason) {
      setError(apiErrorMessage(reason));
    } finally {
      setBusy(undefined);
    }
  };

  const remove = async () => {
    setBusy('remove');
    setError(undefined);
    try {
      setStatus(await api.pronunciationOnlineKeyClear());
      notify('Merriam-Webster key removed.');
    } catch (reason) {
      notify(apiErrorMessage(reason), 'error');
    } finally {
      setBusy(undefined);
    }
  };

  const signUp = async () => {
    setBusy('signup');
    try {
      await api.pronunciationOnlineSignUpOpen();
    } catch (reason) {
      notify(apiErrorMessage(reason), 'error');
    } finally {
      setBusy(undefined);
    }
  };

  const present = status?.present ?? false;
  return (
    <section aria-labelledby="online-dictionary-heading" className="mb-4 space-y-3 rounded-md p-3 text-sm" style={{ background: 'var(--surface-2)' }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="online-dictionary-heading" className="font-medium">
          Online dictionary (Merriam-Webster)
        </h3>
        {status && <StatusBadge tone={present ? 'success' : 'neutral'} label={present ? 'Key saved' : 'No key'} />}
      </div>
      <p style={{ color: 'var(--text-muted)' }}>
        Optional. When no dictionary on this computer knows a name, Look up online asks Merriam-Webster, on your own free key. Only the one word you look up is
        sent, never your text, file names or project. Answers are kept on this computer, so a word is never sent twice.
      </p>
      {!present && (
        <Button variant="ghost" pending={busy === 'signup'} onClick={() => void signUp()}>
          Get a free key
        </Button>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[14rem] flex-1">
          <Field
            label={present ? 'Replace your key' : 'Your key'}
            value={draft}
            onChange={setDraft}
            secret
            placeholder="Paste the key from your dictionaryapi.com account"
            error={error}
            disabled={busy !== undefined}
          />
        </div>
        <Button variant="ghost" disabled={draft.trim() === '' || busy !== undefined} pending={busy === 'save'} onClick={() => void save()}>
          Save key
        </Button>
        {present && (
          <Button variant="ghost" disabled={busy !== undefined} pending={busy === 'remove'} onClick={() => void remove()}>
            Remove key
          </Button>
        )}
      </div>
      {status && !status.protectedAtRest && (
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          On this system the key is kept in a file only your account can read, not in a protected credential store.
        </p>
      )}
    </section>
  );
}
