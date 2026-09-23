import { useEffect, useState } from 'react';
import { useApi } from '../../api/ApiContext';
import { Button } from '../primitives/Button';
import { Dialog } from '../primitives/Dialog';
import { Field } from '../primitives/Field';
import type { RenderConfigState } from '../../types';

const IDLE: RenderConfigState = { phase: 'idle', message: '', folder: '', targets: [], count: 0 };

/** Per-chapter render configuration (reaper-automation-follow-through PRD, Phase 11, Open Question 7 answered
 * (a)): configure only. Sets the render bounds to all regions, the naming pattern to the region name, and the
 * output folder; this dialog never triggers a render itself. Reachable from the Tracks page next to "Link
 * chapters…" and "Pickups…" (Phases 7 and 9), not a new nav item. */
export function RenderConfigDialog({ onClose }: { onClose: () => void }) {
  const api = useApi();
  const [state, setState] = useState<RenderConfigState>(IDLE);
  const [folder, setFolder] = useState('');
  const [requestError, setRequestError] = useState('');

  useEffect(() => {
    const unsubscribe = api.subscribeRenderConfig(setState);
    void api
      .renderConfigState()
      .then((fetched) => {
        setState(fetched);
        setFolder((current) => current || fetched.folder);
        if (!fetched.folder) return api.renderConfigSuggestFolder().then((suggested) => setFolder((current) => current || suggested.folder));
      })
      .catch(() => {});
    return unsubscribe;
  }, [api]);

  const running = state.phase === 'configuring';

  const configure = () => {
    setRequestError('');
    api.renderConfigConfigure(folder).catch((reason: unknown) => setRequestError(String(reason)));
  };

  return (
    <Dialog
      title="Prepare chapter render"
      onClose={running ? undefined : onClose}
      escapeCloses={!running}
      description="Set the render bounds to every chapter region and name each file after its region. This does not render anything: you press Render in REAPER yourself."
      actions={
        <>
          <Button variant="ghost" onClick={onClose} disabled={running}>
            Close
          </Button>
          <Button onClick={configure} disabled={!folder.trim()} pending={running}>
            Configure render
          </Button>
        </>
      }
    >
      <Field label="Output folder" value={folder} onChange={setFolder} disabled={running} placeholder="C:\Books\Alice\renders" />

      {state.phase === 'success' && (
        <div className="mt-4 border-t pt-3" style={{ borderColor: 'var(--border)' }}>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            {state.message}
          </p>
          {state.targets.length > 0 && (
            <ul
              className="mt-2 max-h-40 list-inside list-disc space-y-0.5 overflow-y-auto font-['IBM_Plex_Mono',ui-monospace,monospace] text-xs"
              style={{ color: 'var(--text)' }}
            >
              {state.targets.map((target) => (
                <li key={target}>{target}</li>
              ))}
            </ul>
          )}
          {state.count > 0 && (
            <p className="mt-3 text-sm font-semibold">Render is configured — press Render in REAPER (Ctrl+Alt+R or File &gt; Render) to create the files.</p>
          )}
        </div>
      )}

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
