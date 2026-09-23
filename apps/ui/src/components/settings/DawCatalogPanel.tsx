import { useCallback, useEffect, useState } from 'react';
import { describeApiError } from '../../api/errorMessage';
import { useApi } from '../../api/ApiContext';
import { usePendingAction } from '../../hooks/usePendingAction';
import type { DawCatalogEntry } from '../../types';
import { Button } from '../primitives/Button';
import type { Notify } from '../primitives/Toast';

/**
 * The DAW catalog and "Get it" flow (docs/prds/daw-selection-and-acquisition.prd.md Phase 2): today's one
 * supported DAW (REAPER), whether it appears to be installed, and a button that opens its official download page
 * in the narrator's default browser. This never downloads, verifies or installs anything - the click only opens
 * a browser tab (What We're NOT Building).
 *
 * Detection is on demand, not polled (Open Question A7): it runs once when this panel mounts, which in practice
 * means whenever the narrator opens or returns to Settings' DAW Integration category. An explicit "Check again"
 * action is Phase 3.
 */
export function DawCatalogPanel({ notify }: { notify: Notify }) {
  const api = useApi();
  const [entries, setEntries] = useState<DawCatalogEntry[]>();
  const [loadError, setLoadError] = useState('');
  const opening = usePendingAction();

  const load = useCallback(async () => {
    try {
      const next = await api.dawCatalogList();
      setEntries(next);
      setLoadError('');
    } catch (error) {
      setLoadError(describeApiError(error));
    }
  }, [api]);
  useEffect(() => {
    void load();
  }, [load]);

  const handleOpen = useCallback(
    (entry: DawCatalogEntry) =>
      opening.run(entry.id, async () => {
        try {
          await api.dawCatalogOpenDownloadPage(entry.id);
        } catch (error) {
          notify(describeApiError(error), 'error');
        }
      }),
    [api, notify, opening],
  );

  if (loadError) {
    return (
      <div className="mb-4 rounded-md p-3 text-sm" role="alert" style={{ background: 'var(--review-soft)', color: 'var(--danger-text)' }}>
        The DAW catalog could not be loaded: {loadError}.
      </div>
    );
  }
  if (!entries) return null;

  return (
    <div className="mb-4 space-y-3 border-b pb-4 text-sm" style={{ borderColor: 'var(--border)' }}>
      <div>
        <div className="font-medium">Digital audio workstation</div>
        <div style={{ color: 'var(--text-muted)' }}>
          This suite works with the DAW below. Detection only checks whether it is already installed - the app never downloads or installs it for you.
        </div>
      </div>
      {entries.map((entry) => (
        <div key={entry.id} className="flex items-center gap-3 rounded-md p-3" style={{ background: 'var(--surface-2)' }}>
          <span className="size-2 shrink-0 rounded-full" style={{ background: entry.installed ? 'var(--character)' : 'var(--non-text)' }} />
          <div className="flex-1">
            <div className="font-medium">
              {entry.name} {entry.installed ? 'detected' : 'not detected'}
            </div>
            <div style={{ color: 'var(--text-muted)' }}>
              {entry.publisher} · {entry.licenseNote}
            </div>
          </div>
          {!entry.installed && (
            <Button variant="ghost" type="button" disabled={opening.isBusy} onClick={() => void handleOpen(entry)}>
              {opening.isPending(entry.id) ? 'Opening…' : `Get ${entry.name}`}
            </Button>
          )}
        </div>
      ))}
    </div>
  );
}
