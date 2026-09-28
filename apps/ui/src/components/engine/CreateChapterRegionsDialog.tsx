import { useEffect, useState } from 'react';
import { useApi } from '../../api/ApiContext';
import { useCapability } from '../../useCapability';
import { Button } from '../primitives/Button';
import { CapabilityGate } from '../primitives/CapabilityGate';
import { Checkbox } from '../primitives/Checkbox';
import { Dialog } from '../primitives/Dialog';
import { Select } from '../primitives/Select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../primitives/Table';
import { formatDuration } from '../proof/format';
import type { ChapterRegionPlan, ChapterRegionState, ChapterRegionsCreated, Track } from '../../types';

const REGION_STATE_LABEL: Record<ChapterRegionState, string> = {
  new: 'New region',
  exists: 'Already exists',
  moves: 'Moves an existing region',
  ambiguous: 'Several regions share this title',
};

/** Chapter regions (booth-actions-enablement PRD Phase 4; reaper-automation-follow-through PRD Phase 7's remaining
 * UI half, "not delivered yet" there). Plans one REAPER region per chapter with a confirmed track link (the Tracks
 * page's "Link chapters…" flow), plus the opening/closing credits tracks chosen below, and writes them to the saved
 * project in one undo step (`ChapterRegionsCreate`, already wired to `dawport.RegionWriter` via the DAW port
 * resolver). Reachable from the audio engine panel next to "Link chapters…" and "Prepare chapter render…", not
 * a new nav item. Styled after LinkChaptersDialog.tsx: both preview a REAPER write derived from the same confirmed
 * chapter links before gating the primary action on the preview's readiness, over the same Table/Select primitives. */
export function CreateChapterRegionsDialog({ tracks, onClose }: { tracks: Track[]; onClose: () => void }) {
  const api = useApi();
  const regionsCapability = useCapability('regions');
  const [openingTrackGuid, setOpeningTrackGuid] = useState('');
  const [closingTrackGuid, setClosingTrackGuid] = useState('');
  const [update, setUpdate] = useState(false);
  const [plan, setPlan] = useState<ChapterRegionPlan | null>(null);
  const [previewError, setPreviewError] = useState('');
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<ChapterRegionsCreated | null>(null);
  const [createError, setCreateError] = useState('');

  useEffect(() => {
    let active = true;
    setPreviewError('');
    void api
      .chapterRegionsPreview(openingTrackGuid, closingTrackGuid)
      .then((next) => {
        if (active) setPlan(next);
      })
      .catch((reason: unknown) => {
        if (active) setPreviewError(String(reason));
      });
    return () => {
      active = false;
    };
  }, [api, openingTrackGuid, closingTrackGuid]);

  const trackOptions = [{ value: '', label: 'None' }, ...tracks.map((track) => ({ value: track.guid, label: track.name || `Track ${track.index + 1}` }))];
  const rows = plan?.rows ?? [];
  const canCreate = plan !== null && plan.project === 'ready' && rows.length > 0 && !creating;

  const create = () => {
    setCreateError('');
    setCreating(true);
    api
      .chapterRegionsCreate(openingTrackGuid, closingTrackGuid, update)
      .then((result) => {
        setCreated(result);
        // A second preview shows the rows this run just wrote as "exists" - the same idempotence create_regions itself guarantees.
        // A failed refresh only leaves the pre-create preview in place; the created counts above already answer whether the write worked.
        api
          .chapterRegionsPreview(openingTrackGuid, closingTrackGuid)
          .then(setPlan)
          .catch(() => {});
      })
      .catch((reason: unknown) => setCreateError(String(reason)))
      .finally(() => setCreating(false));
  };

  return (
    <Dialog
      title="Create chapter regions"
      onClose={creating ? undefined : onClose}
      escapeCloses={!creating}
      description="Plan one REAPER region per chapter with a confirmed track link, plus the opening and closing credits tracks you choose below. Nothing is written until you create them."
      actions={
        <>
          <Button variant="ghost" onClick={onClose} disabled={creating}>
            {created ? 'Close' : 'Cancel'}
          </Button>
          <CapabilityGate capability={regionsCapability}>
            <Button onClick={create} disabled={!canCreate} pending={creating}>
              {`Create ${rows.length} region${rows.length === 1 ? '' : 's'}`}
            </Button>
          </CapabilityGate>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Select label="Opening credits track" value={openingTrackGuid} onChange={setOpeningTrackGuid} options={trackOptions} disabled={creating} fullWidth />
        <Select label="Closing credits track" value={closingTrackGuid} onChange={setClosingTrackGuid} options={trackOptions} disabled={creating} fullWidth />
      </div>

      {previewError && (
        <p role="alert" className="mt-2 text-sm" style={{ color: 'var(--danger-text)' }}>
          {previewError}
        </p>
      )}

      {plan && plan.project !== 'ready' && !previewError && (
        <p className="mt-2 text-sm" style={{ color: 'var(--text-muted)' }}>
          {plan.message}
        </p>
      )}

      {plan && plan.project === 'ready' && (
        <>
          <Table label="Chapter regions" className="mt-3">
            <TableHead>
              <TableRow>
                <TableHeader>Region</TableHeader>
                <TableHeader>Track</TableHeader>
                <TableHeader align="right">Start</TableHeader>
                <TableHeader align="right">End</TableHeader>
                <TableHeader>Status</TableHeader>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={`${row.kind}-${row.chapterId || row.trackGuid}`}>
                  <TableCell>{row.title}</TableCell>
                  <TableCell>{row.trackName}</TableCell>
                  <TableCell align="right">{formatDuration(row.start)}</TableCell>
                  <TableCell align="right">{formatDuration(row.end)}</TableCell>
                  <TableCell>{REGION_STATE_LABEL[row.state]}</TableCell>
                </TableRow>
              ))}
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} style={{ color: 'var(--text-muted)' }}>
                    No chapter or credits track is ready for a region yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>

          {plan.skipped.length > 0 && (
            <div className="mt-3 text-sm" style={{ color: 'var(--text-muted)' }}>
              <p className="font-semibold">Not planned</p>
              <ul className="mt-1 list-inside list-disc space-y-0.5">
                {plan.skipped.map((skip) => (
                  <li key={`${skip.kind}-${skip.chapterId}`}>
                    {skip.title}: {skip.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-3">
            <Checkbox checked={update} onChange={setUpdate} disabled={creating}>
              Move an existing region that shares a chapter&rsquo;s title, instead of adding a second one
            </Checkbox>
          </div>
        </>
      )}

      {createError && (
        <p role="alert" className="mt-3 text-sm" style={{ color: 'var(--danger-text)' }}>
          {createError}
        </p>
      )}

      {created && (
        <p className="mt-3 text-sm font-semibold">
          {`Sent ${created.sent}: ${created.created} created, ${created.existing} already existed, ${created.updated} moved, ${created.ambiguous} ambiguous, ${created.failed} failed.`}
        </p>
      )}
    </Dialog>
  );
}
