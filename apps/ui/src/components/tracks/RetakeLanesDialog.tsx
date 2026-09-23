import { useEffect, useState } from 'react';
import { useApi } from '../../api/ApiContext';
import { Button } from '../primitives/Button';
import { Dialog } from '../primitives/Dialog';
import type { RetakeLane, RetakeLaneLine, RetakeLanesList, RetakeLanesState } from '../../types';

const IDLE: RetakeLanesState = { phase: 'idle', message: '', lineId: '', itemGuid: '', trackName: '' };

function formatPosition(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${(whole % 60).toString().padStart(2, '0')}`;
}

/** The track of the retake a successful pick named, so every line on that track shows the new play state. */
function pickedTrack(list: RetakeLanesList | null, state: RetakeLanesState): string | undefined {
  if (state.phase !== 'picked' || state.lane === undefined || !list) return undefined;
  return list.lines.find((line) => line.retakes.some((retake) => retake.itemGuid === state.itemGuid))?.trackGuid;
}

function RetakeRow({
  line,
  retake,
  plays,
  state,
  onPick,
}: {
  line: RetakeLaneLine;
  retake: RetakeLane;
  plays: boolean;
  state: RetakeLanesState;
  onPick: () => void;
}) {
  const picking = state.phase === 'picking';
  const lane = retake.lane + 1;
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 border-t py-2 first:border-t-0" style={{ borderColor: 'var(--border)' }}>
      <div className="min-w-0 flex-1 basis-48">
        <p className="text-sm font-semibold">Lane {lane}</p>
        <p className="text-sm break-all" style={{ color: 'var(--text-muted)' }}>
          {retake.name || 'Untitled item'} · {retake.length.toFixed(1)} s
        </p>
      </div>
      <span className="text-sm" style={{ color: plays ? 'var(--text)' : 'var(--text-muted)' }}>
        {plays ? 'Plays' : 'Silent'}
      </span>
      <Button
        variant="ghost"
        aria-label={`Play lane ${lane} for ${line.lineId} on ${line.trackName}`}
        onClick={onPick}
        pending={picking && state.itemGuid === retake.itemGuid}
        disabled={picking && state.itemGuid !== retake.itemGuid}
      >
        Play this lane
      </Button>
    </li>
  );
}

function EmptyList({ list }: { list: RetakeLanesList }) {
  return (
    <p className="mt-3 text-sm" style={{ color: 'var(--text-muted)' }}>
      {list.laneTracks === 0
        ? 'No track in the saved project uses fixed item lanes. Record retakes into lanes in REAPER first: Narration Utils never turns lanes on or converts takes to lanes.'
        : 'No line has retakes on more than one lane of a track, so there is nothing to choose. Only items linked to manuscript lines are listed.'}
    </p>
  );
}

/** Retakes as fixed lanes (reaper-automation-follow-through PRD, Phase 25, ADR 0147): lists each manuscript line's
 * retakes on fixed lanes, read from the saved project, and makes the narrator's pick the only lane playing on its
 * track in REAPER. That is the only change it makes, one undo step. Reachable from the Tracks page next to the other
 * REAPER actions, not a new nav item. */
export function RetakeLanesDialog({ onClose }: { onClose: () => void }) {
  const api = useApi();
  const [list, setList] = useState<RetakeLanesList | null>(null);
  const [listError, setListError] = useState('');
  const [state, setState] = useState<RetakeLanesState>(IDLE);
  const [requestError, setRequestError] = useState('');
  const [requested, setRequested] = useState('');

  useEffect(() => {
    const unsubscribe = api.subscribeRetakeLanes(setState);
    void api
      .retakeLanesState()
      .then(setState)
      .catch(() => {});
    api
      .retakeLanesList()
      .then(setList)
      .catch((reason: unknown) => setListError(String(reason)));
    return unsubscribe;
  }, [api]);

  const picking = state.phase === 'picking';
  const track = pickedTrack(list, state);
  // The pick's outcome shows under the line it was made for, where the narrator's eyes already are; one that names no
  // listed retake (the list was reloaded since) shows under the list instead.
  const feedbackGuid = requestError ? requested : state.itemGuid;
  const feedbackListed = !!list?.lines.some((line) => line.retakes.some((retake) => retake.itemGuid === feedbackGuid));

  const pick = (line: RetakeLaneLine, retake: RetakeLane) => {
    setRequestError('');
    setRequested(retake.itemGuid);
    api.retakeLanesPick(line.lineId, retake.itemGuid).catch((reason: unknown) => setRequestError(String(reason)));
  };

  const feedback = (
    <>
      {state.phase === 'picked' && !requestError && (
        <p className="mt-2 text-sm" role="status">
          {state.message}
        </p>
      )}
      {requestError && (
        <p role="alert" className="mt-2 text-sm" style={{ color: 'var(--danger-text)' }}>
          {requestError}
        </p>
      )}
      {state.phase === 'error' && !requestError && (
        <p role="alert" className="mt-2 text-sm" style={{ color: 'var(--danger-text)' }}>
          {state.message}
        </p>
      )}
    </>
  );

  return (
    <Dialog
      title="Retakes on lanes"
      onClose={picking ? undefined : onClose}
      escapeCloses={!picking}
      description="Choose which lane plays for a line. A lane plays across its whole track, so choosing one silences the other lanes of that track everywhere, not only for this line. Narration Utils changes nothing else, and Undo in REAPER puts the previous lanes back."
      actions={
        <Button variant="ghost" onClick={onClose} disabled={picking}>
          Close
        </Button>
      }
    >
      {listError && (
        <p role="alert" className="mt-3 text-sm" style={{ color: 'var(--danger-text)' }}>
          {listError}
        </p>
      )}
      {list && list.lines.length === 0 && <EmptyList list={list} />}
      {list && list.lines.length > 0 && (
        <div className="mt-3 space-y-4">
          {list.lines.map((line) => (
            <section key={`${line.trackGuid}/${line.lineId}`} aria-label={`${line.lineId} on ${line.trackName}`}>
              <h3 className="text-sm font-semibold break-all">
                {line.trackName} · {line.lineId} · {formatPosition(line.retakes[0]?.position ?? 0)}
              </h3>
              <ul>
                {line.retakes.map((retake) => (
                  <RetakeRow
                    key={retake.itemGuid}
                    line={line}
                    retake={retake}
                    plays={track === line.trackGuid ? retake.lane === state.lane : retake.plays}
                    state={state}
                    onPick={() => pick(line, retake)}
                  />
                ))}
              </ul>
              {feedbackListed && line.retakes.some((retake) => retake.itemGuid === feedbackGuid) && feedback}
            </section>
          ))}
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            What plays is read from the project as last saved in REAPER.
          </p>
        </div>
      )}
      {!feedbackListed && feedback}
    </Dialog>
  );
}
