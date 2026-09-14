import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCircleNotch, faRotate } from '@fortawesome/free-solid-svg-icons';

export type StartupState = 'connecting' | 'error' | 'timeout';

export function StartupScreen({ state, error, diagnosticId, retry }: { state: StartupState; error: string; diagnosticId: string; retry: () => void }) {
  const waiting = state === 'connecting';
  const detail =
    state === 'connecting'
      ? 'Reading project context from the desktop host…'
      : state === 'timeout'
        ? 'The desktop host did not respond within 10 seconds.'
        : error;
  return (
    <div className="grid min-h-screen place-items-center p-6">
      <div className="panel max-w-lg p-6 text-center">
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
          <p className="f-mono mt-3 text-xs" style={{ color: 'var(--text-faint)' }}>
            Diagnostic: {diagnosticId}
          </p>
        )}
        {!waiting && (
          <button className="btn btn-primary mt-5" onClick={retry}>
            <FontAwesomeIcon icon={faRotate} />
            Retry connection
          </button>
        )}
      </div>
    </div>
  );
}
