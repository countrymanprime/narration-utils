import { useEffect, useState } from 'react';
import { useApi } from '../../api/ApiContext';
import { Button } from '../primitives/Button';
import { Dialog } from '../primitives/Dialog';
import type { CleanupToolKey, CleanupToolsState } from '../../types';

const IDLE: CleanupToolsState = { phase: 'idle', message: '', tool: '', action: '' };

/** The allow-listed tools, in the order the host's cleanuptools.Tools lists them. */
const TOOLS: { key: CleanupToolKey; label: string; description: string }[] = [
  {
    key: 'repair_pops_clicks',
    label: 'Repair Pops/Clicks',
    description: 'REAPER’s own dialog (REAPER 7.80 or later). It finds pops and clicks in the selected items; nothing is repaired until you apply it.',
  },
  {
    key: 'magnolius_declick',
    label: 'Magnolius DeClick',
    description: 'A free third-party script for mouth clicks. Only if you installed it in REAPER yourself: Narration Utils never installs it.',
  },
];

/** Cleanup launchers (reaper-automation-follow-through PRD, Phase 23, ADR 0146): opens a repair tool in REAPER on the
 * items selected there. The app changes nothing itself; the tool's own dialog does the work. Reachable from the Tracks
 * page next to "Prepare chapter render…", not a new nav item. */
export function CleanupToolsDialog({ onClose }: { onClose: () => void }) {
  const api = useApi();
  const [state, setState] = useState<CleanupToolsState>(IDLE);
  const [requestError, setRequestError] = useState('');

  useEffect(() => {
    const unsubscribe = api.subscribeCleanupTools(setState);
    void api
      .cleanupToolsState()
      .then(setState)
      .catch(() => {});
    return unsubscribe;
  }, [api]);

  const running = state.phase === 'launching';

  const launch = (tool: CleanupToolKey) => {
    setRequestError('');
    api.cleanupToolsLaunch(tool).catch((reason: unknown) => setRequestError(String(reason)));
  };

  return (
    <Dialog
      title="Cleanup tools"
      onClose={running ? undefined : onClose}
      escapeCloses={!running}
      description="Open a repair tool in REAPER on the items you have selected there. Narration Utils changes nothing itself: you apply or cancel the repair in the tool’s own window."
      actions={
        <Button variant="ghost" onClick={onClose} disabled={running}>
          Close
        </Button>
      }
    >
      <ul>
        {TOOLS.map((tool) => (
          <li
            key={tool.key}
            className="flex flex-wrap items-center justify-between gap-3 border-t py-3 first:border-t-0"
            style={{ borderColor: 'var(--border)' }}
          >
            <div className="min-w-0 flex-1 basis-60">
              <p className="text-sm font-semibold">{tool.label}</p>
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                {tool.description}
              </p>
            </div>
            <Button
              variant="ghost"
              aria-label={`Open ${tool.label}`}
              onClick={() => launch(tool.key)}
              pending={running && state.tool === tool.key}
              disabled={running && state.tool !== tool.key}
            >
              Open
            </Button>
          </li>
        ))}
      </ul>

      {state.phase === 'launched' && (
        <p className="mt-3 text-sm" role="status">
          {state.message}
        </p>
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
