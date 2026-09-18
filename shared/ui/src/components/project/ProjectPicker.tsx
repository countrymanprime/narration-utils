import { useCallback, useEffect, useRef, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faFolderOpen, faFolderPlus, faXmark } from '@fortawesome/free-solid-svg-icons';
import { useApi } from '../../api/ApiContext';
import { Button } from '../primitives/Button';
import type { ProjectSwitchResult, RecentProject } from '../../types';

// The application-data empty state for "no project folder was given" - a
// standalone launch (Start Menu shortcut, taskbar pin) with no REAPER-supplied
// project. Distinct from StartupScreen, which only models host-connection
// failure states before any bootstrap payload exists at all.
export function ProjectPicker() {
  const api = useApi();
  const [recents, setRecents] = useState<RecentProject[]>([]);
  const [recentsFailed, setRecentsFailed] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void api
      .projectRecents()
      .then((next) => {
        if (active) setRecents(next);
      })
      .catch(() => {
        if (active) setRecentsFailed(true);
      });
    return () => {
      active = false;
    };
  }, [api]);

  // A successful switch/create emits the native "system:attached" event,
  // which App.tsx's existing subscription already turns into a bootstrap
  // refresh - this component only needs to surface a refusal, if any.
  const applyResult = (result: ProjectSwitchResult) => setReason(result.switched ? '' : (result.reason ?? ''));

  // Every action funnels through here so a failed IPC call (e.g. the dialog
  // rejecting, or the host not being ready) surfaces as visible text instead
  // of an unhandled promise rejection, and so overlapping clicks can't fire
  // two switches/creates against the same backend state machine at once.
  const runAction = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
    } catch (error) {
      setReason(String(error));
    } finally {
      setBusy(false);
    }
  };

  const openRecent = (entry: RecentProject) => runAction(async () => applyResult(await api.switchProject(entry.path, entry.name)));

  const removeButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const recentsHeadingRef = useRef<HTMLDivElement>(null);
  const pendingFocusRef = useRef<{ removedIndex: number; remaining: RecentProject[] } | null>(null);

  // After a row unmounts, its focused remove button goes with it - move focus
  // to the entry that slid into its place (or the previous one, if it was
  // last) so keyboard/screen-reader users don't lose their place in the list.
  const focusAfterRemoval = useCallback((removedIndex: number, remaining: RecentProject[]) => {
    const target = remaining[removedIndex] ?? remaining[removedIndex - 1];
    const button = target ? removeButtonRefs.current.get(target.path) : undefined;
    (button ?? recentsHeadingRef.current)?.focus();
  }, []);

  // Deferred to an effect because the remove button is still disabled={busy}
  // in the DOM committed at the point removeRecent's own code runs - a
  // disabled button can't receive focus. setRecents/setReason and the later
  // setBusy(false) can land in separate commits (they cross a microtask
  // boundary), so this must wait for a commit where busy has actually gone
  // back to false, not just for recents to change.
  useEffect(() => {
    if (busy) return;
    const pending = pendingFocusRef.current;
    if (!pending) return;
    pendingFocusRef.current = null;
    focusAfterRemoval(pending.removedIndex, pending.remaining);
  }, [busy, recents, focusAfterRemoval]);

  const removeRecent = (entry: RecentProject) =>
    runAction(async () => {
      const removedIndex = recents.findIndex((candidate) => candidate.path === entry.path);
      const updated = await api.removeRecentProject(entry.path);
      setRecents(updated);
      setReason('');
      pendingFocusRef.current = { removedIndex, remaining: updated };
    });

  const browse = () =>
    runAction(async () => {
      const selection = await api.selectProjectFolder();
      if (!selection.selected || !selection.path) return;
      applyResult(await api.switchProject(selection.path));
    });

  const createNew = () =>
    runAction(async () => {
      const selection = await api.selectProjectFolder();
      if (!selection.selected || !selection.path) return;
      applyResult(await api.createProject(selection.path));
    });

  return (
    <div className="grid min-h-screen place-items-center p-6">
      <div className="w-full max-w-2xl rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6 shadow-[var(--shadow)]">
        <div className="text-lg font-semibold">Open a project</div>
        <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
          Choose a recent project, browse to an existing folder, or create a new one.
        </p>
        {reason && (
          <p className="mt-3 text-sm" role="alert" style={{ color: 'var(--danger)' }}>
            {reason}
          </p>
        )}
        <section className="mt-5">
          <div
            className="mb-2 font-['Barlow_Condensed',sans-serif] text-[0.72rem] font-semibold uppercase tracking-[0.08em] text-[var(--text-faint)]"
            tabIndex={-1}
            ref={recentsHeadingRef}
          >
            Open recent
          </div>
          {recentsFailed ? (
            <p className="text-sm" style={{ color: 'var(--danger)' }}>
              Couldn&apos;t load recent projects.
            </p>
          ) : recents.length === 0 ? (
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              No recent projects yet.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {recents.map((entry) => (
                <li key={entry.path} className="relative">
                  <button
                    type="button"
                    className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] p-[1.1rem] pr-10 text-left shadow-[var(--shadow)] transition hover:-translate-y-px"
                    onClick={() => void openRecent(entry)}
                    disabled={busy}
                  >
                    <div className="truncate font-semibold">{entry.name}</div>
                    <div className="truncate font-['IBM_Plex_Mono',ui-monospace,monospace] text-sm" style={{ color: 'var(--text-muted)' }}>
                      {entry.path}
                    </div>
                  </button>
                  <button
                    type="button"
                    ref={(node) => {
                      if (node) removeButtonRefs.current.set(entry.path, node);
                      else removeButtonRefs.current.delete(entry.path);
                    }}
                    className="absolute right-2 top-2 inline-flex items-center gap-[0.4rem] rounded-md border border-transparent px-4 py-2 font-['Barlow_Condensed',sans-serif] text-[0.85rem] font-semibold uppercase tracking-[0.03em] disabled:pointer-events-none disabled:opacity-40"
                    aria-label={`Remove ${entry.name} from recent projects`}
                    onClick={() => void removeRecent(entry)}
                    disabled={busy}
                  >
                    <FontAwesomeIcon icon={faXmark} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
        <div className="mt-5 flex gap-2">
          <Button variant="primary" onClick={() => void browse()} disabled={busy}>
            <FontAwesomeIcon icon={faFolderOpen} />
            Browse…
          </Button>
          <button
            type="button"
            className="inline-flex items-center gap-[0.4rem] rounded-md border border-transparent px-4 py-2 font-['Barlow_Condensed',sans-serif] text-[0.85rem] font-semibold uppercase tracking-[0.03em] disabled:pointer-events-none disabled:opacity-40"
            onClick={() => void createNew()}
            disabled={busy}
          >
            <FontAwesomeIcon icon={faFolderPlus} />
            Create new…
          </button>
        </div>
      </div>
    </div>
  );
}
