import { useEffect, useRef, useState } from 'react';
import { useApi } from '../../api/ApiContext';
import { Button } from '../primitives/Button';
import { Dialog } from '../primitives/Dialog';
import type { PickupsMoment, PickupsState } from '../../types';

const IDLE: PickupsState = { phase: 'idle', message: '', remaining: 0, total: 0, csv: '' };

// Triggers a browser "Save As" for csv, under name, without a native file-dialog binding: the WebView2 host
// handles a download the same way a real browser does (Phase 9's "Export action").
function downloadCSV(csv: string, name: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function ImportRowErrors({ rowErrors }: { rowErrors: string[] }) {
  if (rowErrors.length === 0) return null;
  return (
    <div className="mt-2 text-sm" style={{ color: 'var(--warn-text)' }}>
      <p>
        {rowErrors.length} row{rowErrors.length === 1 ? '' : 's'} could not be used:
      </p>
      <ul className="list-inside list-disc">
        {rowErrors.map((row) => (
          <li key={row}>{row}</li>
        ))}
      </ul>
    </div>
  );
}

/** The pickup list (reaper-automation-follow-through PRD, Phase 9): import a proofer's CSV, jump through the
 * remaining pickups, mark one done, export what is left. Reachable from the Tracks page next to "Link
 * chapters…" (Phase 7), not a new nav item. */
export function PickupsDialog({ onClose }: { onClose: () => void }) {
  const api = useApi();
  const [state, setState] = useState<PickupsState>(IDLE);
  const [rowErrors, setRowErrors] = useState<string[]>([]);
  const [requestError, setRequestError] = useState('');
  // A run that starts (Go's begin(), mirrored by the mock) clears `next`/`resolved` from state, so this survives
  // across the Resolve run that follows a Next: without it, "Mark this pickup done" and its pending state would
  // disappear the instant Resolve starts, before it has anything to show for itself.
  const [activeNext, setActiveNext] = useState<PickupsMoment>();
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const unsubscribe = api.subscribePickups(setState);
    // Hydrates whatever run was already in flight (the way LinkChaptersDialog does for line identity), then
    // asks for a fresh count so a narrator sees where things stand without an extra press (the "remaining
    // count" the phase's success signal names). Count only after the hydrate settles, not in a second,
    // independent effect: two unordered fetches racing on the same `setState` can resolve out of order and
    // flash the dialog back to a stale phase after Count has already moved it on.
    void api
      .pickupsState()
      .then((fetched) => {
        setState(fetched);
        return api.pickupsCount();
      })
      .catch(() => {});
    return unsubscribe;
  }, [api]);

  useEffect(() => {
    if (state.phase === 'success' && state.csv) downloadCSV(state.csv, 'pickups.csv');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fires once per completed export (a fresh runId), not on every render
  }, [state.runId, state.csv]);

  useEffect(() => {
    if (state.phase === 'success' && state.next) setActiveNext(state.next);
    else if (state.phase === 'success' && state.resolved) setActiveNext(undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fires once per completed run (Next and Resolve on the same runId both flip phase to 'success')
  }, [state.runId, state.phase]);

  const running = ['importing', 'exporting', 'jumping', 'resolving', 'counting'].includes(state.phase);

  const pickFile = () => fileInput.current?.click();
  const importFile = async (file: File) => {
    setRequestError('');
    setRowErrors([]);
    const text = await file.text();
    try {
      const result = await api.pickupsImport(text);
      setRowErrors(result.rowErrors);
    } catch (reason: unknown) {
      setRequestError(String(reason));
    }
  };
  const next = () => {
    setRequestError('');
    api.pickupsNext().catch((reason: unknown) => setRequestError(String(reason)));
  };
  const resolveCurrent = () => {
    if (!activeNext) return;
    setRequestError('');
    api.pickupsResolve(activeNext.position).catch((reason: unknown) => setRequestError(String(reason)));
  };
  const exportList = () => {
    setRequestError('');
    api.pickupsExport().catch((reason: unknown) => setRequestError(String(reason)));
  };

  return (
    <Dialog
      title="Pickups"
      onClose={running ? undefined : onClose}
      escapeCloses={!running}
      description="Import a proofer's pickup list, jump through what's left, and mark each one done as you re-record it."
      actions={
        <Button variant="ghost" onClick={onClose} disabled={running}>
          Close
        </Button>
      }
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-lg font-semibold">
          {state.total > 0 ? `${state.remaining} pickup${state.remaining === 1 ? '' : 's'} remaining of ${state.total}` : 'No pickups yet'}
        </p>
        <div className="flex flex-wrap gap-2">
          <input
            ref={fileInput}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) void importFile(file);
            }}
          />
          <Button variant="ghost" onClick={pickFile} pending={state.phase === 'importing'}>
            Import CSV…
          </Button>
          <Button variant="ghost" onClick={exportList} disabled={state.total === 0} pending={state.phase === 'exporting'}>
            Export CSV
          </Button>
        </div>
      </div>

      <ImportRowErrors rowErrors={rowErrors} />
      {state.phase === 'success' && state.importReport && (
        <p className="mt-2 text-sm" style={{ color: 'var(--text-muted)' }}>
          {state.message}
        </p>
      )}

      <div className="mt-4 border-t pt-3" style={{ borderColor: 'var(--border)' }}>
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-semibold">Next pickup</h3>
          <Button onClick={next} disabled={state.remaining === 0} pending={state.phase === 'jumping'}>
            Next pickup
          </Button>
        </div>
        {activeNext && (
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-sm">
            <p>
              {activeNext.tag && <span className="section-label mr-1.5">{activeNext.tag}</span>}
              {activeNext.note}
            </p>
            <Button variant="ghost" onClick={resolveCurrent} pending={state.phase === 'resolving'}>
              Mark this pickup done
            </Button>
          </div>
        )}
        {state.phase === 'success' && state.resolved && (
          <p className="mt-2 text-sm" style={{ color: 'var(--text-muted)' }}>
            Marked done: {state.resolved.note}
          </p>
        )}
      </div>

      {requestError && (
        <p role="alert" className="mt-2 text-sm" style={{ color: 'var(--danger-text)' }}>
          {requestError}
        </p>
      )}
      {state.phase === 'error' && (
        <p role="alert" className="mt-2 text-sm" style={{ color: 'var(--danger-text)' }}>
          {state.message}
        </p>
      )}
    </Dialog>
  );
}
