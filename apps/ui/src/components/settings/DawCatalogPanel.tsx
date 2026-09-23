import { useCallback, useEffect, useState } from 'react';
import { describeApiError } from '../../api/errorMessage';
import { useApi } from '../../api/ApiContext';
import { usePendingAction } from '../../hooks/usePendingAction';
import type { DawCatalogEntry } from '../../types';
import { Button } from '../primitives/Button';
import type { Notify } from '../primitives/Toast';

/**
 * The DAW catalog and "Get it" flow (docs/architecture/daw-integration.md): today's one supported DAW (REAPER),
 * whether it appears to be installed, a button that opens its official download page in the narrator's default
 * browser, and a manual "Check again" action. This never downloads, verifies or installs anything - the buttons
 * only open a browser tab or re-run the on-demand check.
 *
 * Detection is on demand, not polled: it runs once when this panel mounts, which in practice means whenever the
 * narrator opens or returns to Settings' DAW Integration category, and again on every "Check again" click - both
 * share the one `load` call site (mirrors `LocalAssets`' mount-plus-"Try again" pattern).
 *
 * `onLinkDawFile`/`dawFileLinked` are optional: when given, an installed-but-not-yet-linked entry also offers the
 * shared "link a REAPER project file" action, a handoff into the DAW Link flow once a DAW is detected. Omitting
 * them (as in isolated tests) just drops that one button.
 */
export function DawCatalogPanel({
  notify,
  dawFileLinked,
  onLinkDawFile,
}: {
  notify: Notify;
  /** Whether a REAPER project is already linked (project-workspace-and-daw-link.prd.md); hides the handoff link once true, since it would have nothing left to offer. */
  dawFileLinked?: boolean;
  /** The shared "link a REAPER project file" action (PRD W19), passed through from Settings. */
  onLinkDawFile?: () => void;
}) {
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
  const handleCheckAgain = useCallback(() => opening.run('check-again', load), [opening, load]);

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
          {entry.installed && onLinkDawFile && !dawFileLinked && (
            <Button variant="ghost" type="button" onClick={onLinkDawFile}>
              Link a REAPER project file
            </Button>
          )}
        </div>
      ))}
      <Button variant="ghost" type="button" disabled={opening.isBusy} onClick={() => void handleCheckAgain()}>
        {opening.isPending('check-again') ? 'Checking…' : 'Check again'}
      </Button>
    </div>
  );
}
