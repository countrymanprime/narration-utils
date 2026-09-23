import { useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCheck, faCircleNotch, faCopy, faRotate } from '@fortawesome/free-solid-svg-icons';
import { Button } from '../primitives/Button';
import { DemoBanner } from './DemoBanner';

export type StartupState = 'connecting' | 'error' | 'timeout' | 'disconnected';

type Props = {
  state: StartupState;
  error: string;
  /** Technical text for a payload that did not match its schema (boundary, payload, failing paths); shown and copyable. */
  details?: string;
  diagnosticId: string;
  retry: () => void;
};

export function StartupScreen({ state, error, details, diagnosticId, retry }: Props) {
  const [copied, setCopied] = useState(false);
  const copyDetails = () => {
    // The details stay on screen, so a narrator can still select them when the clipboard is unavailable.
    void navigator.clipboard?.writeText(details ?? '').then(
      () => setCopied(true),
      () => {},
    );
  };
  const waiting = state === 'connecting';
  const detail =
    state === 'connecting'
      ? 'Reading project context from the desktop host…'
      : state === 'timeout'
        ? 'The desktop host did not respond within 10 seconds.'
        : state === 'disconnected'
          ? 'Lost connection to the Narration Utils server. It may have been closed or crashed - check that it is still running.'
          : error;
  return (
    <>
      <DemoBanner />
      <main className="grid min-h-screen place-items-center p-6">
        <div className="max-w-lg rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6 text-center shadow-[var(--shadow)]">
          <h1 className="text-lg font-semibold">
            {waiting ? (
              <>
                <FontAwesomeIcon icon={faCircleNotch} spin className="mr-2" />
                Opening Narration Console…
              </>
            ) : (
              'Desktop host needs attention'
            )}
          </h1>
          <p className="mt-3 text-sm" style={{ color: 'var(--text-muted)' }}>
            {detail}
          </p>
          {details && !waiting && (
            <pre
              aria-label="Technical details"
              className="mt-3 max-h-40 overflow-auto rounded-md border border-[var(--border)] bg-[var(--surface-2)] p-3 text-left font-['IBM_Plex_Mono',ui-monospace,monospace] text-xs break-words whitespace-pre-wrap"
              style={{ color: 'var(--text-muted)' }}
            >
              {details}
            </pre>
          )}
          {diagnosticId && (
            <p className="mt-3 font-['IBM_Plex_Mono',ui-monospace,monospace] text-xs" style={{ color: 'var(--text-muted)' }}>
              Diagnostic: {diagnosticId}
            </p>
          )}
          {!waiting && (
            <div className="mt-5 flex flex-wrap justify-center gap-3">
              <Button variant="primary" onClick={retry}>
                <FontAwesomeIcon icon={faRotate} />
                Retry connection
              </Button>
              {details && (
                <Button variant="ghost" onClick={copyDetails}>
                  <FontAwesomeIcon icon={copied ? faCheck : faCopy} />
                  {copied ? 'Copied' : 'Copy details'}
                </Button>
              )}
            </div>
          )}
        </div>
      </main>
    </>
  );
}
