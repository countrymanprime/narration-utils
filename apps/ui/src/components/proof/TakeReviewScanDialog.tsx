import { useEffect, useState, type ReactNode } from 'react';
import { useApi } from '../../api/ApiContext';
import { apiErrorMessage } from '../../api/errorMessage';
import type { TakeReviewScanJob, TakeReviewScanScope } from '../../types';
import { Button } from '../primitives/Button';
import { Dialog } from '../primitives/Dialog';
import { Field } from '../primitives/Field';
import { Select } from '../primitives/Select';
import { WorkDialog } from '../primitives/WorkDialog';
import { formatTime } from './findingFormat';

/** How often a running scan is read: the host reads the sidecar's progress file four times as often. */
const POLL_MS = 500;

type Addition = 'none' | 'track' | 'range';

/** A timeline time as the narrator types it: seconds ("95.5"), or minutes and seconds ("1:35.5"), or hours too ("1:02:03"). */
export function parseTimelineTime(text: string): number | undefined {
  const trimmed = text.trim();
  if (!/^\d+(:\d{1,2}){0,2}(\.\d+)?$/.test(trimmed)) return undefined;
  return trimmed.split(':').reduce((total, part) => total * 60 + Number(part), 0);
}

function Labeled({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      {label}
      {children}
    </label>
  );
}

/**
 * Find pickups and duplicates (take-review-pickups-duplicates-take-intelligence.prd.md Phase 5, user flow step 1): the narrator
 * chooses the track to scan and, at most, one pickup addition, a pickup track or a stretch of the timeline (Q3), offered from
 * the project's saved TakeReview settings; then the scan runs as a host job with its real progress and Cancel (ADR 0015), and
 * may be left running in the background, since the app says when it ends (ADR 0076). A scan already running when the dialog
 * opens is shown as it is. `onClose` gets the job as it ended, or undefined when nothing ran to an end here.
 */
export function TakeReviewScanDialog({ onClose }: { onClose: (ended?: TakeReviewScanJob) => void }) {
  const api = useApi();
  const [job, setJob] = useState<TakeReviewScanJob>();
  const [tracks, setTracks] = useState<string[]>();
  const [tracksError, setTracksError] = useState<string>();
  const [chapter, setChapter] = useState('');
  const [addition, setAddition] = useState<Addition>('none');
  const [pickupTrack, setPickupTrack] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [problem, setProblem] = useState<string>();
  const [starting, setStarting] = useState(false);

  // What is running now, and the tracks to choose from. The saved pickup scope fills the form once, when nothing is running.
  useEffect(() => {
    let active = true;
    const offer = (scope: TakeReviewScanScope) => {
      if (scope.pickupTrackName) {
        setAddition('track');
        setPickupTrack(scope.pickupTrackName);
      } else if (scope.pickupRangeStart !== undefined && scope.pickupRangeEnd !== undefined) {
        setAddition('range');
        setFrom(formatTime(scope.pickupRangeStart));
        setTo(formatTime(scope.pickupRangeEnd));
      }
    };
    api
      .takeReviewScanState()
      .then((state) => {
        if (!active) return;
        if (state.phase === 'running') setJob(state);
        else offer(state.scope);
      })
      .catch((error) => active && setProblem(apiErrorMessage(error)));
    api
      .tracksList()
      .then((project) => {
        if (!active) return;
        const names = project.tracks.map((track) => track.name);
        setTracks(names);
        setChapter((current) => current || names[0] || '');
      })
      .catch((error) => active && setTracksError(apiErrorMessage(error)));
    return () => {
      active = false;
    };
  }, [api]);

  // A running job is read until it ends; an answer after the dialog closed is dropped.
  const running = job?.phase === 'running';
  useEffect(() => {
    if (!running) return;
    let active = true;
    const timer = setTimeout(() => {
      api
        .takeReviewScanState()
        .then((next) => active && setJob(next))
        .catch((error) => active && setJob((current) => current && { ...current, phase: 'error', error: apiErrorMessage(error) }));
    }, POLL_MS);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [api, running, job]);

  if (job) {
    return (
      <WorkDialog
        title="Finding pickups and duplicates"
        job={job}
        cancel={() => void api.takeReviewScanCancel().then(setJob, (error) => setProblem(apiErrorMessage(error)))}
        background={() => onClose()}
        close={() => onClose(job)}
      />
    );
  }

  const rangeStart = parseTimelineTime(from);
  const rangeEnd = parseTimelineTime(to);
  const fromError = addition === 'range' && from !== '' && rangeStart === undefined ? 'Type a time like 30:00 or 1800.' : undefined;
  const toError =
    addition === 'range' && to !== ''
      ? rangeEnd === undefined
        ? 'Type a time like 40:00 or 2400.'
        : rangeStart !== undefined && rangeEnd <= rangeStart
          ? 'The end comes after the start.'
          : undefined
      : undefined;
  const pickupChoices = (tracks ?? []).filter((name) => name !== chapter);
  const incomplete =
    !chapter ||
    (addition === 'track' && !pickupTrack) ||
    (addition === 'range' && (rangeStart === undefined || rangeEnd === undefined || rangeEnd <= rangeStart));

  // The track being scanned is not offered as its own pickup track, so choosing it clears that choice rather than hiding it.
  const chooseChapter = (name: string) => {
    setChapter(name);
    if (pickupTrack === name) setPickupTrack('');
  };

  const start = () => {
    const scope: TakeReviewScanScope = {
      chapterTrackName: chapter,
      ...(addition === 'track' ? { pickupTrackName: pickupTrack } : {}),
      ...(addition === 'range' ? { pickupRangeStart: rangeStart, pickupRangeEnd: rangeEnd } : {}),
    };
    setStarting(true);
    setProblem(undefined);
    api
      .takeReviewScanStart(scope)
      .then(setJob, (error) => setProblem(apiErrorMessage(error)))
      .finally(() => setStarting(false));
  };

  return (
    <Dialog
      title="Find pickups and duplicates"
      onClose={() => onClose()}
      description={
        <span className="mb-3 block">
          Finds lines you recorded more than once on a track: restarts, pickups and near-identical re-reads. Each group comes to this page to review; nothing in
          REAPER changes.
        </span>
      }
      actions={
        <>
          <Button variant="ghost" onClick={() => onClose()}>
            Cancel
          </Button>
          <Button onClick={start} pending={starting} disabled={incomplete || Boolean(tracksError)}>
            Start scan
          </Button>
        </>
      }
    >
      {tracksError ? (
        <p role="alert" className="text-sm" style={{ color: 'var(--danger-text)' }}>
          The tracks could not be read, so there is nothing to scan yet: {tracksError}
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          <Labeled label="Track to scan">
            <Select
              label="Track to scan"
              value={chapter}
              onChange={chooseChapter}
              fullWidth
              options={(tracks ?? []).map((name) => ({ value: name, label: name }))}
            />
          </Labeled>
          <Labeled label="Also look for pickups on">
            <Select
              label="Also look for pickups on"
              value={addition}
              onChange={(value) => setAddition(value === 'track' || value === 'range' ? value : 'none')}
              fullWidth
              options={[
                { value: 'none', label: 'Nothing else' },
                { value: 'track', label: 'A pickup track' },
                { value: 'range', label: 'A stretch of the timeline' },
              ]}
            />
          </Labeled>
          {addition === 'track' && (
            <Labeled label="Pickup track">
              <Select
                label="Pickup track"
                value={pickupTrack}
                onChange={setPickupTrack}
                fullWidth
                options={[{ value: '', label: 'Choose a track…' }, ...pickupChoices.map((name) => ({ value: name, label: name }))]}
              />
            </Labeled>
          )}
          {addition === 'range' && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="From" value={from} onChange={setFrom} placeholder="30:00" error={fromError} />
              <Field label="To" value={to} onChange={setTo} placeholder="40:00" error={toError} />
            </div>
          )}
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            Every take of every item on the track is transcribed, which takes a while for a long chapter. You can keep working while it runs.
          </p>
        </div>
      )}
      {problem && (
        <p role="alert" className="mt-3 text-sm" style={{ color: 'var(--danger-text)' }}>
          {problem}
        </p>
      )}
    </Dialog>
  );
}
