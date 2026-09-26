import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApi } from '../../api/ApiContext';
import { EditingCheckPanel } from '../editing/EditingCheckPanel';
import { MappingConfirm } from '../mapping/MappingConfirm';
import { Button } from '../primitives/Button';
import { Panel } from '../primitives/Panel';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../primitives/Table';
import type { Notify } from '../primitives/Toast';
import { chapterTrackRows, type ChapterLinkState } from './chapterTrackRows';
import type { ManuscriptChapter, Track, TrackMapping } from '../../types';

const STATE_LABEL: Record<ChapterLinkState, string> = {
  linked: 'Linked',
  unlinked: 'Not linked',
  missing_track: 'Track missing',
};

const STATE_COLOR: Record<ChapterLinkState, string> = {
  linked: 'var(--text-muted)',
  unlinked: 'var(--text-muted)',
  missing_track: 'var(--danger-text)',
};

// The Tracks page's list of every chapter-track link (analysis evidence ledger PRD, Phase 7, Q7 option A: the "whole
// picture" list lives here, beside the per-chapter inline prompt used wherever a check needs it). It shows every
// narration chapter whether or not it has a confirmed link, so an unlinked chapter and a link pointing at a track
// that no longer exists are both visible in one place, not just the one chapter a narrator happens to be checking.
export function ChapterLinksTable({ tracks, refreshKey, notify }: { tracks: Track[]; refreshKey?: number; notify: Notify }) {
  const api = useApi();
  const [chapters, setChapters] = useState<ManuscriptChapter[]>([]);
  const [mappings, setMappings] = useState<TrackMapping[]>([]);
  const [error, setError] = useState('');
  const [busyChapterId, setBusyChapterId] = useState('');
  const [editingChecking, setEditingChecking] = useState<ManuscriptChapter>();

  const reload = useCallback(async () => {
    const [nextChapters, mapping] = await Promise.all([api.manuscriptChapters(), api.chapterTrackMapList()]);
    setChapters(nextChapters);
    setMappings(mapping.mappings);
  }, [api]);

  useEffect(() => {
    let active = true;
    reload().catch((reason) => {
      if (active) setError(String(reason));
    });
    return () => {
      active = false;
    };
    // refreshKey has no meaning of its own: it only asks this effect to run again, for a caller (chapter sync's panel) whose own
    // action changed the mapping this table reads.
  }, [reload, refreshKey]);

  // Set, not Confirm: it replaces the chapter's link rather than adding a second one beside it
  // (chapter-track-link-control PRD Phase 1), so a Change never leaves the chapter linked to two tracks.
  const confirm = (chapterId: string, trackGuid: string) => {
    setBusyChapterId(chapterId);
    setError('');
    api
      .chapterTrackSet(chapterId, trackGuid)
      .then(() => reload())
      .catch((reason) => setError(String(reason)))
      .finally(() => setBusyChapterId(''));
  };

  // Clears every link the chapter holds, including a second one an older Change left behind.
  const clear = (chapterId: string) => {
    setBusyChapterId(chapterId);
    setError('');
    api
      .chapterTrackUnlink(chapterId)
      .then(() => reload())
      .catch((reason) => setError(String(reason)))
      .finally(() => setBusyChapterId(''));
  };

  const rows = chapterTrackRows(chapters, tracks, mappings);
  // Nothing to link before a manuscript is imported: the mapping is scoped to a document (Q6).
  if (chapters.length === 0) return null;

  return (
    <Panel title="Chapter links">
      {error && (
        <p role="alert" className="mb-2 text-sm" style={{ color: 'var(--danger-text)' }}>
          {error}
        </p>
      )}
      <Table label="Chapter links">
        <TableHead>
          <TableRow>
            <TableHeader>Chapter</TableHeader>
            <TableHeader>Status</TableHeader>
            <TableHeader hiddenLabel="Workspace" />
            <TableHeader hiddenLabel="Editing check" />
            <TableHeader hiddenLabel="Link" />
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.chapter.id}>
              <TableCell className="font-medium">{row.chapter.title}</TableCell>
              <TableCell style={{ color: STATE_COLOR[row.state] }}>{STATE_LABEL[row.state]}</TableCell>
              <TableCell>
                {row.state === 'linked' && (
                  <Link className="text-sm font-semibold underline" to={`/tracks/chapter/${encodeURIComponent(row.chapter.id)}`}>
                    Open workspace
                  </Link>
                )}
              </TableCell>
              <TableCell>
                <Button variant="ghost" className="text-sm" onClick={() => setEditingChecking(row.chapter)}>
                  Editing check…
                </Button>
              </TableCell>
              <TableCell>
                <MappingConfirm
                  chapterTitle={row.chapter.title}
                  tracks={tracks}
                  linkedTrackGuid={row.mapping?.trackGuid}
                  linkedTrackName={row.trackName}
                  busy={busyChapterId === row.chapter.id}
                  onConfirm={(trackGuid) => confirm(row.chapter.id, trackGuid)}
                  onClear={() => clear(row.chapter.id)}
                />
              </TableCell>
            </TableRow>
          ))}
          {rows.length === 0 && (
            <TableRow>
              <TableCell colSpan={5} className="text-sm" style={{ color: 'var(--text-muted)' }}>
                No chapters to link yet.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      {editingChecking && <EditingCheckPanel key={editingChecking.id} chapter={editingChecking} notify={notify} close={() => setEditingChecking(undefined)} />}
    </Panel>
  );
}
