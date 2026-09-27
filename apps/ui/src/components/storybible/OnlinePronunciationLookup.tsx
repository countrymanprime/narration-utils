import { useState } from 'react';
import { apiErrorMessage } from '../../api/errorMessage';
import { useApi } from '../../api/ApiContext';
import type { PronunciationOnlineResult } from '../../types';
import { Button } from '../primitives/Button';

/**
 * Look one name up in Merriam-Webster's online dictionary (prep-depth P9, D72): the narrator's own press, sending that
 * name alone, answered from this computer's copy when it was looked up before. An answer is a suggestion for the
 * narrator's own pronunciation field, never saved by itself: "Use this" only fills the field, and "Use mine" saves it.
 */
export function OnlinePronunciationLookup({ name, disabled, onUse }: { name: string; disabled: boolean; onUse: (spelling: string) => void }) {
  const api = useApi();
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<PronunciationOnlineResult | undefined>();
  const [error, setError] = useState<string | undefined>();

  const lookUp = async () => {
    setPending(true);
    setError(undefined);
    try {
      setResult(await api.pronunciationOnlineLookup(name));
    } catch (reason) {
      setResult(undefined);
      setError(apiErrorMessage(reason));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" disabled={disabled} pending={pending} onClick={() => void lookUp()} aria-label={`Look up ${name} online in Merriam-Webster`}>
          Look up online
        </Button>
        <span className="text-xs text-[var(--text-muted)]">Sends “{name}” alone to Merriam-Webster, on your own key.</span>
      </div>
      <div role="status" className="text-xs">
        {error && <p className="text-[var(--danger-text)]">{capitalize(error)}</p>}
        {result && result.found && (
          <div className="space-y-1">
            <p className="text-[var(--text-muted)]">
              {result.label} ({result.notation}){result.cached ? ', from this computer’s copy' : ''}:
            </p>
            <ul className="space-y-1">
              {result.pronunciations.map((row) => (
                <li key={`${row.headword}:${row.spelling}`} className="flex flex-wrap items-center gap-2">
                  <span className="font-['IBM_Plex_Mono',ui-monospace,monospace] text-[var(--text)]">\{row.spelling}\</span>
                  <span className="text-[var(--text-muted)]">{row.headword}</span>
                  <Button
                    variant="ghost"
                    disabled={disabled}
                    onClick={() => onUse(row.spelling)}
                    aria-label={`Use ${row.spelling} as your pronunciation of ${name}`}
                  >
                    Use this
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {result && !result.found && (
          <p className="text-[var(--text-muted)]">
            {result.label} does not have “{result.word}”{result.suggestions.length > 0 ? `. It suggests: ${result.suggestions.join(', ')}.` : '.'}
          </p>
        )}
      </div>
    </div>
  );
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1) + (/[.!?]$/.test(text) ? '' : '.');
}
