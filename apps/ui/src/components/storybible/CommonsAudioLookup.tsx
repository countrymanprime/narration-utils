import { useState } from 'react';
import { apiErrorMessage } from '../../api/errorMessage';
import { useApi } from '../../api/ApiContext';
import { Button } from '../primitives/Button';

/**
 * Opens the Wikimedia Commons recording of name in the narrator's default browser or media player, read from
 * Wiktextract's own offline pronunciation data (prep-depth P10, D72, Q12). Nothing is fetched or played in-app: the
 * host builds the address from its own installed index and hands it to the browser, the same "open externally"
 * pattern the four web lookups already use.
 */
export function CommonsAudioLookup({ name, disabled }: { name: string; disabled: boolean }) {
  const api = useApi();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const open = async () => {
    setPending(true);
    setError(undefined);
    try {
      await api.pronunciationCommonsAudioOpen(name);
    } catch (reason) {
      setError(apiErrorMessage(reason));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="space-y-1">
      <Button variant="ghost" disabled={disabled} pending={pending} onClick={() => void open()} aria-label={`Listen to ${name} on Wikimedia Commons`}>
        Listen on Commons
      </Button>
      {error && (
        <p role="status" className="text-xs text-[var(--danger-text)]">
          {error}
        </p>
      )}
    </div>
  );
}
