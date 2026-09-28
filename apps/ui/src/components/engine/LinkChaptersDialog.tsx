import { useEffect, useMemo, useState } from 'react';
import { useApi } from '../../api/ApiContext';
import { Button } from '../primitives/Button';
import { Checkbox } from '../primitives/Checkbox';
import { Dialog } from '../primitives/Dialog';
import { Select } from '../primitives/Select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../primitives/Table';
import type { LineIdentityLine, LineIdentityRowStatus, LineIdentityState, LineIdentityStampRow, ManuscriptChapter, Track } from '../../types';

const STATUS_LABEL: Record<LineIdentityRowStatus, string> = {
  ok: 'OK',
  drift: 'Text changed since stamping',
  'stale-source': 'Manuscript re-imported since stamping',
  removed: 'Chapter no longer in the manuscript',
  unrecognized: 'From an older stamp scheme',
  unknown: 'No manuscript loaded to compare against',
};

const STATUS_COLOR: Record<LineIdentityRowStatus, string> = {
  ok: 'var(--text)',
  drift: 'var(--warn-text)',
  'stale-source': 'var(--warn-text)',
  removed: 'var(--danger-text)',
  unrecognized: 'var(--text-muted)',
  unknown: 'var(--text-muted)',
};

/** One chapter mapped to a track: every one of the track's items will be stamped with this chapter's identity (Open Question 3,
 * chapter-level granularity). Building this mapping is this phase's stand-in for the chapter-to-track matcher planned for
 * teleprompter-manuscript-integration.prd.md Phase 8, which does not exist yet: see the PRD's Phase 7 row. */
type ChapterMapping = Record<string, string>;

function rowsFor(
  chapters: ManuscriptChapter[],
  tracks: Track[],
  mapping: ChapterMapping,
): { row: LineIdentityStampRow; trackName: string; chapterTitle: string }[] {
  const byGuid = new Map(tracks.map((track) => [track.guid, track]));
  const rows: { row: LineIdentityStampRow; trackName: string; chapterTitle: string }[] = [];
  for (const chapter of chapters) {
    const trackGuid = mapping[chapter.id];
    if (!trackGuid) continue;
    const track = byGuid.get(trackGuid);
    if (!track) continue;
    for (const item of track.items) {
      rows.push({
        row: { itemGuid: item.guid, lineId: chapter.id, text: chapter.title },
        trackName: track.name || `Track ${track.index + 1}`,
        chapterTitle: chapter.title,
      });
    }
  }
  return rows;
}

function LineStatusRow({ line }: { line: LineIdentityLine }) {
  return (
    <TableRow>
      <TableCell>{line.itemGuid}</TableCell>
      <TableCell>{line.entityId || line.lineId}</TableCell>
      <TableCell style={{ color: STATUS_COLOR[line.status] }}>{STATUS_LABEL[line.status]}</TableCell>
      <TableCell>{line.status === 'drift' ? (line.currentText ?? '') : line.text}</TableCell>
    </TableRow>
  );
}

/** Reads current stamped identity from REAPER and shows every row's status (ok, drift, stale-source, removed, unrecognized,
 * unknown), so a narrator can see what "Link chapters" would change before running it again. */
function CurrentStamps({ state, onRead, pending }: { state: LineIdentityState; onRead: () => void; pending: boolean }) {
  return (
    <div className="mt-4 border-t pt-3" style={{ borderColor: 'var(--border)' }}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-semibold">Currently stamped in REAPER</h3>
        <Button variant="ghost" onClick={onRead} pending={pending}>
          Read current stamps
        </Button>
      </div>
      {(state.phase === 'reading' || (state.phase === 'success' && state.linesRead > 0)) && (
        <p className="mt-2 text-sm" style={{ color: 'var(--text-muted)' }}>
          {state.message}
        </p>
      )}
      {state.phase === 'error' && (
        <p role="alert" className="mt-2 text-sm" style={{ color: 'var(--danger-text)' }}>
          {state.message}
        </p>
      )}
      {state.lines.length > 0 && (
        <Table label="Stamped lines" className="mt-2">
          <TableHead>
            <TableRow>
              <TableHeader>Item</TableHeader>
              <TableHeader>Manuscript entity</TableHeader>
              <TableHeader>Status</TableHeader>
              <TableHeader>Text</TableHeader>
            </TableRow>
          </TableHead>
          <TableBody>
            {state.lines.map((line) => (
              <LineStatusRow key={line.itemGuid} line={line} />
            ))}
          </TableBody>
        </Table>
      )}
      {state.phase === 'success' && state.lines.length === 0 && (
        <p className="mt-2 text-sm" style={{ color: 'var(--text-muted)' }}>
          Nothing is stamped yet.
        </p>
      )}
    </div>
  );
}

export function LinkChaptersDialog({ chapters, tracks, onClose }: { chapters: ManuscriptChapter[]; tracks: Track[]; onClose: () => void }) {
  const api = useApi();
  const [mapping, setMapping] = useState<ChapterMapping>({});
  const [overwrite, setOverwrite] = useState(false);
  const [state, setState] = useState<LineIdentityState>({
    phase: 'idle',
    message: '',
    stamp: { applied: 0, unchanged: 0, missingCount: 0, conflictsCount: 0, missing: [], conflicts: [] },
    lines: [],
    linesRead: 0,
  });
  const [requestError, setRequestError] = useState('');

  useEffect(() => {
    const unsubscribe = api.subscribeLineIdentity(setState);
    // Hydrates whatever run was already in flight (opened once, then reopened); the live event follows anyway.
    void api
      .lineIdentityState()
      .then(setState)
      .catch(() => {});
    return unsubscribe;
  }, [api]);

  const preview = useMemo(() => rowsFor(chapters, tracks, mapping), [chapters, tracks, mapping]);
  const running = state.phase === 'stamping';
  const trackOptions = [{ value: '', label: 'Not linked' }, ...tracks.map((track) => ({ value: track.guid, label: track.name || `Track ${track.index + 1}` }))];

  const approve = () => {
    setRequestError('');
    api
      .lineIdentityStamp(
        preview.map((entry) => entry.row),
        overwrite,
      )
      .catch((reason: unknown) => setRequestError(String(reason)));
  };
  const read = () => {
    setRequestError('');
    api.lineIdentityRead().catch((reason: unknown) => setRequestError(String(reason)));
  };

  return (
    <Dialog
      title="Link chapters to REAPER"
      onClose={running ? undefined : onClose}
      escapeCloses={!running}
      description="Choose which REAPER track holds each chapter's recording. Every item on a linked track will be stamped with that chapter's identity; nothing is written until you approve."
      actions={
        <>
          <Button variant="ghost" onClick={onClose} disabled={running}>
            {state.phase === 'success' && state.stamp.applied > 0 ? 'Close' : 'Cancel'}
          </Button>
          <Button onClick={approve} disabled={preview.length === 0} pending={running}>
            {`Stamp ${preview.length} item${preview.length === 1 ? '' : 's'}`}
          </Button>
        </>
      }
    >
      <Table label="Chapter to track mapping">
        <TableHead>
          <TableRow>
            <TableHeader>Chapter</TableHeader>
            <TableHeader>REAPER track</TableHeader>
            <TableHeader align="right">Items to stamp</TableHeader>
          </TableRow>
        </TableHead>
        <TableBody>
          {chapters.map((chapter) => {
            const trackGuid = mapping[chapter.id] ?? '';
            const track = tracks.find((candidate) => candidate.guid === trackGuid);
            return (
              <TableRow key={chapter.id}>
                <TableCell>{chapter.title}</TableCell>
                <TableCell>
                  <Select
                    label={`Track for ${chapter.title}`}
                    value={trackGuid}
                    onChange={(value) => setMapping((current) => ({ ...current, [chapter.id]: value }))}
                    options={trackOptions}
                  />
                </TableCell>
                <TableCell align="right">{track ? track.items.length : '–'}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      <div className="mt-3">
        <Checkbox checked={overwrite} onChange={setOverwrite} disabled={running}>
          Overwrite items already stamped with a different chapter
        </Checkbox>
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
      {state.phase === 'stamping' && (
        <p className="mt-2 text-sm" style={{ color: 'var(--text-muted)' }}>
          {state.message}
        </p>
      )}
      {state.phase === 'success' && (state.stamp.applied > 0 || state.stamp.missingCount > 0 || state.stamp.conflictsCount > 0) && (
        <div className="mt-2 text-sm">
          <p>{state.message}</p>
          {state.stamp.missing.length > 0 && (
            <p style={{ color: 'var(--warn-text)' }}>Stale items (their GUID no longer resolves in REAPER): {state.stamp.missing.join(', ')}</p>
          )}
          {state.stamp.conflicts.length > 0 && (
            <p style={{ color: 'var(--warn-text)' }}>Already stamped with a different chapter, not overwritten: {state.stamp.conflicts.join(', ')}</p>
          )}
        </div>
      )}

      <CurrentStamps state={state} onRead={read} pending={state.phase === 'reading'} />
    </Dialog>
  );
}
