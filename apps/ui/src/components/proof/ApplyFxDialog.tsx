import { useEffect, useState } from 'react';
import { useApi } from '../../api/ApiContext';
import { apiErrorMessage } from '../../api/errorMessage';
import type { WorkspaceFXResult } from '../../api/contracts/workspace';
import { ConfirmDialog } from '../primitives/ConfirmDialog';
import { Select } from '../primitives/Select';

export type FxRequest = { kind: 'plugin'; firstToken: number; lastToken: number; passage: string } | { kind: 'chain' };

type Options = { names: string[]; favourites: Set<string> };

// The narrator's favourites (Settings > DAW, DAW.fx_favourites, a comma-joined list of chain and plug-in names): read for
// the project so a project's own list wins, as the Settings page shows it. A failed read just means no favourites.
async function readFavourites(api: ReturnType<typeof useApi>): Promise<Set<string>> {
  try {
    const sections = await api.settingsForScope('project');
    const field = (sections.DAW ?? []).find((candidate) => candidate.key === 'fx_favourites');
    return new Set(
      (field?.effectiveValue ?? '')
        .split(',')
        .map((name) => name.trim())
        .filter(Boolean),
    );
  } catch {
    return new Set();
  }
}

/** What a successful request did, in the narrator's words, for the page's status line. */
export function fxDoneMessage(result: Exclude<WorkspaceFXResult, { outcome: 'refused' }>): string {
  if (result.outcome === 'added') {
    const cuts =
      result.splits === 0 ? 'The passage was the whole item, so nothing was split' : `REAPER split the item ${result.splits === 1 ? 'once' : 'twice'}`;
    return `Added ${result.plugin} to the passage in REAPER. ${cuts}. One Undo in REAPER takes it all back.`;
  }
  return `Put ${result.chain} on the chapter's track in REAPER (${result.added} ${result.added === 1 ? 'effect' : 'effects'}). One Undo in REAPER takes it back.`;
}

/**
 * The confirm step of applying an effect (edit-and-proof-workspace.prd.md Phase 9, ADR 0234): the narrator picks one of
 * REAPER's installed plug-ins for the selected passage, or one of their FX chains for the chapter's track, and reads what
 * REAPER will do before anything is sent (EP10 A: each edit is sent when confirmed, nothing is queued). The favourites
 * (Settings > DAW) list first. What REAPER refuses is shown here, in the host's words, and nothing has changed; a success
 * closes the dialog and reports through `onDone`.
 */
export function ApplyFxDialog({
  chapterId,
  request,
  onDone,
  onClose,
}: {
  chapterId: string;
  request: FxRequest;
  onDone: (message: string) => void;
  onClose: () => void;
}) {
  const api = useApi();
  const [options, setOptions] = useState<Options>();
  const [choice, setChoice] = useState('');
  const [problem, setProblem] = useState<string>();
  const [pending, setPending] = useState(false);
  const plugin = request.kind === 'plugin';

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const [listing, favourites] = await Promise.all([plugin ? api.workspaceListFX() : api.workspaceListFXChains(), readFavourites(api)]);
        if (!live) return;
        const names = [...listing.names.filter((name) => favourites.has(name)), ...listing.names.filter((name) => !favourites.has(name))];
        setOptions({ names, favourites });
        setChoice(names[0] ?? '');
      } catch (error) {
        if (live) setProblem(`REAPER was not asked: ${apiErrorMessage(error)}`);
      }
    })();
    return () => {
      live = false;
    };
  }, [api, plugin]);

  const confirm = async () => {
    if (choice === '') {
      setProblem(plugin ? 'Choose an effect first.' : 'Choose an FX chain first.');
      return;
    }
    setPending(true);
    setProblem(undefined);
    try {
      const result =
        request.kind === 'plugin'
          ? await api.workspaceAddTakeFX(chapterId, request.firstToken, request.lastToken, choice)
          : await api.workspaceApplyFXChain(chapterId, choice);
      if (result.outcome === 'refused') {
        setProblem(result.message);
        setPending(false);
        return;
      }
      onDone(fxDoneMessage(result));
    } catch (error) {
      setProblem(`REAPER was not asked: ${apiErrorMessage(error)}`);
      setPending(false);
    }
  };

  const body = plugin
    ? 'REAPER cuts this passage out of its item and adds the effect to that piece only. You can remove it in its take FX window, and one Undo in REAPER takes back the cuts and the effect together.'
    : "REAPER adds the whole chain to this chapter's track, so it changes how everything on that track sounds. One Undo in REAPER takes it back.";
  const empty = options !== undefined && options.names.length === 0;

  return (
    <ConfirmDialog
      title={plugin ? 'Add an effect to this passage' : "Put an FX chain on the chapter's track"}
      body={body}
      confirmLabel={plugin ? 'Add effect' : 'Put chain on track'}
      confirm={() => void confirm()}
      cancel={onClose}
      pending={pending}
    >
      {request.kind === 'plugin' && (
        <p className="mt-3 text-sm">
          Passage: <q>{request.passage}</q>
        </p>
      )}
      {options === undefined && problem === undefined && <p className="text-sm">Asking REAPER what it has…</p>}
      {options && !empty && (
        <div className="mt-3">
          <Select
            label={plugin ? 'Effect' : 'FX chain'}
            value={choice}
            onChange={setChoice}
            fullWidth
            options={options.names.map((name) => ({ value: name, label: options.favourites.has(name) ? `★ ${name}` : name }))}
          />
        </div>
      )}
      {empty && (
        <p className="text-sm">
          {plugin ? 'REAPER lists no installed effects.' : 'No FX chains were found in REAPER’s FXChains folder. Save one in REAPER’s FX window first.'}
        </p>
      )}
      {problem && (
        <p role="alert" className="mt-3 text-sm" style={{ color: 'var(--danger-text)' }}>
          {problem}
        </p>
      )}
    </ConfirmDialog>
  );
}
