import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { EnginePanelLink } from '../engine/EnginePanelContext';
import { useApi } from '../../api/ApiContext';
import type { TrackMapping } from '../../api/contracts/chapterTrackMap';
import type { TracksProject } from '../../api/contracts/tracks';
import { chapterName } from '../../chapterName';
import { Button } from '../primitives/Button';
import { CapabilityGate } from '../primitives/CapabilityGate';
import { Heading } from '../primitives/Heading';
import { Panel } from '../primitives/Panel';
import { SectionLabel } from '../primitives/SectionLabel';
import { StatusBadge } from '../primitives/StatusBadge';
import { formatTime } from '../proof/findingFormat';
import { useCapability } from '../../useCapability';
import type { PickupsMoment } from '../../types';
import { chaptersAtPosition, type PickupChapter } from './pickupChapters';
import { usePickupsState } from './usePickupsState';

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

/** Where a pickup sits in the book: every linked chapter whose track holds it, each a link to that chapter's Proof view at
 * the pickup's own place (`?t=`), or a plain line when no linked chapter track does. */
function PickupChapterLinks({ matches }: { matches: PickupChapter[] | undefined }) {
  if (matches === undefined) return null;
  if (matches.length === 0) {
    return (
      <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
        Not on a linked chapter track, so there is no chapter to open in Proof. Link chapters to their tracks in the audio engine panel. <EnginePanelLink />
      </p>
    );
  }
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
      {matches.map((match) => (
        <li key={match.chapterId}>
          <Link to={`/proof/${encodeURIComponent(match.chapterId)}?t=${Math.round(match.elapsed * 100) / 100}`} className="font-semibold underline">
            Open {match.title} in Proof
          </Link>
        </li>
      ))}
    </ul>
  );
}

/**
 * Pickups (stage-navigation-and-page-replacement.prd.md Phase 7, mock 04's Review › Pickups): the book's pickup list
 * from the proofer's REAPER markers (reaper-automation-follow-through PRD Phase 9) - import a proofer's CSV, jump
 * through the remaining pickups, open one's chapter in Proof, punch or mark it done, export what is left - and the
 * pickup session slot closed-loop proofing fills. It replaces the Tracks page's Pickups dialog (ADR 0407).
 */
export function PickupsPage() {
  const api = useApi();
  const punchCapability = useCapability('punch');
  const state = usePickupsState();
  const [rowErrors, setRowErrors] = useState<string[]>([]);
  const [requestError, setRequestError] = useState('');
  // "Punch from here" (booth-actions-enablement PRD Phase 3): the pickup's own position is already a project time, so
  // there is nothing to preview - the button moves REAPER's edit cursor straight away, like Next pickup and Mark done.
  const [punching, setPunching] = useState(false);
  // A run that starts (Go's begin(), mirrored by the mock) clears `next`/`resolved` from state, so this survives
  // across the Resolve run that follows a Next: without it, "Mark this pickup done" and its pending state would
  // disappear the instant Resolve starts, before it has anything to show for itself.
  const [activeNext, setActiveNext] = useState<PickupsMoment>();
  // What a pickup's project time is matched against to find its chapter; undefined until read, or when it cannot be.
  const [book, setBook] = useState<{ project: TracksProject; mappings: TrackMapping[]; chapters: { id: string; title: string }[] }>();
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    // The chapter links, the project's tracks and the chapters, read once: with any missing (no manuscript, no linked
    // project file) a pickup just has no chapter to open, and the rest of the page works the same.
    Promise.all([api.manuscriptChapters(), api.chapterTrackMapList(), api.tracksList()])
      .then(([chapters, mapping, project]) => {
        if (active) setBook({ project, mappings: mapping.mappings, chapters: chapters.map((chapter) => ({ id: chapter.id, title: chapterName(chapter) })) });
      })
      .catch(() => {});
    return () => {
      active = false;
    };
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

  const nextChapters = useMemo(
    () => (activeNext ? (book ? chaptersAtPosition(activeNext.position, book.project, book.mappings, book.chapters) : []) : undefined),
    [activeNext, book],
  );

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
  const punchCurrent = async () => {
    if (!activeNext) return;
    setRequestError('');
    setPunching(true);
    try {
      const result = await api.pickupsPunch(activeNext.position);
      if (result.outcome === 'refused') setRequestError(result.message ?? 'Punch from here failed.');
    } catch (reason: unknown) {
      setRequestError(String(reason));
    } finally {
      setPunching(false);
    }
  };
  const exportList = () => {
    setRequestError('');
    api.pickupsExport().catch((reason: unknown) => setRequestError(String(reason)));
  };

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4">
      <div className="min-w-0">
        <Heading title="Pickups">Import a proofer&apos;s pickup list, jump through what&apos;s left, and mark each one done as you re-record it.</Heading>
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <Panel
          title="Pickup list"
          actions={
            <>
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
                Import proofer CSV…
              </Button>
              <Button variant="ghost" onClick={exportList} disabled={state.total === 0} pending={state.phase === 'exporting'}>
                Export CSV
              </Button>
            </>
          }
        >
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-lg font-semibold">
              {state.total > 0 ? `${state.remaining} pickup${state.remaining === 1 ? '' : 's'} remaining of ${state.total}` : 'No pickups yet'}
            </p>
            {state.total > 0 && state.total > state.remaining && <StatusBadge tone="success" label={`${state.total - state.remaining} done`} />}
          </div>

          <ImportRowErrors rowErrors={rowErrors} />
          {state.phase === 'success' && state.importReport && (
            <p className="mt-2 text-sm" style={{ color: 'var(--text-muted)' }}>
              {state.message}
            </p>
          )}

          <div className="mt-4 border-t pt-3" style={{ borderColor: 'var(--border)' }}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-semibold">Next pickup</h3>
              <Button onClick={next} disabled={state.remaining === 0} pending={state.phase === 'jumping'}>
                Next pickup
              </Button>
            </div>
            {activeNext && (
              <div className="mt-2 flex flex-col gap-2 text-sm">
                <p>
                  <span className="mr-1.5 font-mono">{formatTime(activeNext.position)}</span>
                  {activeNext.tag && <SectionLabel className="mr-1.5">{activeNext.tag}</SectionLabel>}
                  {activeNext.note}
                </p>
                <PickupChapterLinks matches={nextChapters} />
                <div className="flex flex-wrap gap-2">
                  <CapabilityGate capability={punchCapability}>
                    <Button variant="ghost" onClick={punchCurrent} pending={punching}>
                      Punch from here
                    </Button>
                  </CapabilityGate>
                  <Button variant="ghost" onClick={resolveCurrent} pending={state.phase === 'resolving'}>
                    Mark this pickup done
                  </Button>
                </div>
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
        </Panel>
        {/* Mock 04's right panel: closed-loop proofing (its Phase 4, retargeted here) plans a chapter's session. Until then
            the slot says so rather than drawing an empty plan (booth mode D3's precedent). */}
        <Panel title="Pickup session" actions={<StatusBadge tone="neutral" label="Coming soon" />}>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            Planning a pickup session is not available yet. It will gather a chapter&apos;s pickups in script order, each with its line in context, ready to
            record in one sitting. For now, work through the list with Next pickup.
          </p>
        </Panel>
      </div>
    </div>
  );
}
