import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCircleNotch, faRotate } from '@fortawesome/free-solid-svg-icons';
import { Button } from '../primitives/Button';

export type StartupState = 'connecting' | 'error' | 'timeout' | 'disconnected';

export function StartupScreen({ state, error, diagnosticId, retry }: { state: StartupState; error: string; diagnosticId: string; retry: () => void }) {
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
    <div className="grid min-h-screen place-items-center p-6">
      <div className="max-w-lg rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6 text-center shadow-[var(--shadow)]">
        <div className="text-lg font-semibold">
          {waiting ? (
            <>
              <FontAwesomeIcon icon={faCircleNotch} spin className="mr-2" />
              Opening Narration Console…
            </>
          ) : (
            'Desktop host needs attention'
          )}
        </div>
        <p className="mt-3 text-sm" style={{ color: 'var(--text-muted)' }}>
          {detail}
        </p>
        {diagnosticId && (
          <p className="mt-3 font-['IBM_Plex_Mono',ui-monospace,monospace] text-xs" style={{ color: 'var(--text-muted)' }}>
            Diagnostic: {diagnosticId}
          </p>
        )}
        {!waiting && (
          <Button variant="primary" className="mt-5" onClick={retry}>
            <FontAwesomeIcon icon={faRotate} />
            Retry connection
          </Button>
        )}
      </div>
    </div>
  );
}
