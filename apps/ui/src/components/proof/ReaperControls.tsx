import { useState } from 'react';
import { useApi } from '../../api/ApiContext';
import { apiErrorMessage } from '../../api/errorMessage';
import { usePendingAction } from '../../hooks/usePendingAction';
import type { Finding, FindingMarker, FindingNavigation, ReaperStatus } from '../../types';
import { Button } from '../primitives/Button';
import { ConfirmDialog } from '../primitives/ConfirmDialog';
import { TooltipTarget } from '../primitives/Tooltip';
import { formatTime } from './findingFormat';

// Why a control is off when the finding itself cannot be placed; the host refuses the same findings in the same words
// (apps/desktop/bindings_navigation.go), so a button is never enabled for a request that can only be refused.
const NO_ITEM = 'This finding has no REAPER item to go to, because it came from an older check. Run the check again to record one.';
const NO_SOURCE_TIME = 'This finding has no time in its audio to loop. Go to it instead.';
const CHECKING = 'Checking whether REAPER is connected…';
// The approved marker's own reasons (apps/desktop/bindings_marker.go): only an accepted finding gets one (review dashboard Phase 8).
const NOT_ACCEPTED = 'Accept this finding first. Only a finding you accepted gets a marker in REAPER.';
const MARKER_NO_SOURCE_TIME = 'This finding has no time in its audio to put a marker at.';

/** A finding has audio to go to when an analyzer recorded where it is in REAPER or in time; a Story Bible entry has neither. */
export const hasAudio = (finding: Finding): boolean => Boolean(finding.source.item_guid || finding.time_range);

/** What REAPER did, in the narrator's words, for the status line. A refusal is shown as an alert instead. */
export function doneMessage(result: Exclude<FindingNavigation, { outcome: 'refused' }>): string {
  switch (result.outcome) {
    case 'navigated':
      return `REAPER selected the item and moved the cursor to ${formatTime(result.projectTime)}.`;
    case 'looping':
      return `Looping ${formatTime(result.loopStart)} to ${formatTime(result.loopEnd)} in REAPER. Stop loop puts your time selection and repeat back.`;
    case 'stopped':
      if (result.restored === 0 && result.kept === 0) return 'There was no loop to stop.';
      return result.kept > 0
        ? 'Loop stopped. What you changed while it played is kept; the rest is back as you had it.'
        : 'Loop stopped. Your time selection and repeat are back as you had them.';
  }
}

/** What adding the approved marker did, in the narrator's words, for the status line. A refusal is shown as an alert instead. */
function markerMessage(result: Exclude<FindingMarker, { outcome: 'refused' }>): string {
  return result.outcome === 'added'
    ? `Marker added in REAPER: ${result.name}. One Undo in REAPER removes it.`
    : `This take already has a marker here (${result.name}), so none was added.`;
}

/**
 * Go to, Loop and Stop for a finding in REAPER (review-dashboard-and-findings-adoption.prd.md Phase 7; ADR 0121). The buttons
 * are off, with the reason under them, until the host says REAPER is listening (`status`, polled by the page), and for a finding
 * the host could not place. What REAPER refuses (the finding's audio moved, REAPER is recording, an older script) is an alert in
 * plain words; nothing in REAPER changed. After every action the page reads the status again, so a loop's Stop appears and a
 * REAPER that went away turns the buttons off.
 *
 * Add marker in REAPER (Phase 8, ADR 0123) adds one take marker for a finding the narrator accepted, after they confirm it: the one
 * control here that changes the project, as one undo point in REAPER. The batch Export markers stays on the Proofing page.
 */
export function ReaperControls({
  finding,
  status,
  onStatusChange,
}: {
  finding: Finding;
  status: ReaperStatus | undefined;
  onStatusChange: () => Promise<void>;
}) {
  const api = useApi();
  const action = usePendingAction();
  const [problem, setProblem] = useState<string>();
  const [done, setDone] = useState<string>();

  const connected = status?.connection === 'connected';
  const connectionReason = status === undefined ? CHECKING : connected ? undefined : status.message;
  const noItem = finding.source.item_guid ? undefined : NO_ITEM;
  const goToBlocked = noItem ?? connectionReason;
  const loopBlocked = noItem ?? (finding.time_range?.source_start === undefined ? NO_SOURCE_TIME : undefined) ?? connectionReason;
  const loopingId = connected ? status?.loopingFindingId : undefined;
  const markerBlocked =
    noItem ??
    (finding.review.status === 'accepted' ? undefined : NOT_ACCEPTED) ??
    (finding.time_range?.source_start === undefined ? MARKER_NO_SOURCE_TIME : undefined) ??
    connectionReason;
  const [confirmingMarker, setConfirmingMarker] = useState(false);

  const send = (key: string, request: () => Promise<FindingNavigation>) =>
    action.run(key, async () => {
      setProblem(undefined);
      setDone(undefined);
      try {
        const result = await request();
        if (result.outcome === 'refused') setProblem(result.message);
        else setDone(doneMessage(result));
      } catch (error) {
        setProblem(`REAPER was not asked: ${apiErrorMessage(error)}`);
      }
      await onStatusChange();
    });

  const addMarker = () =>
    action.run('marker', async () => {
      setProblem(undefined);
      setDone(undefined);
      try {
        const result = await api.findingsAddMarker(finding.id);
        if (result.outcome === 'refused') setProblem(result.message);
        else setDone(markerMessage(result));
      } catch (error) {
        setProblem(`REAPER was not asked: ${apiErrorMessage(error)}`);
      }
      setConfirmingMarker(false);
      await onStatusChange();
    });

  const reason = noItem ?? connectionReason;
  const loopingLine =
    loopingId && !done ? (loopingId === finding.id ? 'This finding is looping in REAPER.' : 'A loop is playing in REAPER on another finding.') : undefined;

  return (
    <section aria-label="In REAPER" className="mt-4">
      <h3 className="text-sm font-semibold">In REAPER</h3>
      <div className="mt-2 flex flex-wrap gap-2">
        <TooltipTarget text={goToBlocked ?? "Select this finding's item in REAPER and put the edit cursor on it"}>
          <Button
            variant="ghost"
            onClick={() => void send('goto', () => api.findingsGoTo(finding.id))}
            disabled={Boolean(goToBlocked) || action.isBlockedFor('goto')}
            pending={action.isPending('goto')}
          >
            Go to in REAPER
          </Button>
        </TooltipTarget>
        <TooltipTarget text={loopBlocked ?? 'Play the audio around this finding over and over in REAPER'}>
          <Button
            variant="ghost"
            onClick={() => void send('loop', () => api.findingsLoop(finding.id))}
            disabled={Boolean(loopBlocked) || action.isBlockedFor('loop')}
            pending={action.isPending('loop')}
          >
            Loop in REAPER
          </Button>
        </TooltipTarget>
        {loopingId && (
          <Button
            variant="ghost"
            onClick={() => void send('stop', () => api.findingsStopLoop())}
            disabled={action.isBlockedFor('stop')}
            pending={action.isPending('stop')}
          >
            Stop loop
          </Button>
        )}
        <TooltipTarget text={markerBlocked ?? 'Add one take marker in REAPER at this finding, after you confirm'}>
          <Button
            variant="ghost"
            onClick={() => setConfirmingMarker(true)}
            disabled={Boolean(markerBlocked) || action.isBlockedFor('marker')}
            pending={action.isPending('marker')}
          >
            Add marker in REAPER
          </Button>
        </TooltipTarget>
      </div>
      {reason && (
        <p className="mt-2 text-sm" style={{ color: 'var(--text-muted)' }}>
          {reason}
        </p>
      )}
      {problem && (
        <p role="alert" className="mt-2 text-sm" style={{ color: 'var(--danger-text)' }}>
          {problem}
        </p>
      )}
      <p role="status" className="mt-2 text-sm empty:hidden">
        {done ?? loopingLine}
      </p>
      {confirmingMarker && (
        <ConfirmDialog
          title="Add a marker in REAPER"
          body={`REAPER adds one take marker at ${formatTime(finding.time_range?.start ?? 0)}, on this finding's take, named with what the script says and what was recorded, like the markers Proofing exports. A marker of the same kind already there is not added twice, and one Undo in REAPER removes it.`}
          confirmLabel="Add marker"
          confirm={() => void addMarker()}
          cancel={() => setConfirmingMarker(false)}
          pending={action.isPending('marker')}
        />
      )}
    </section>
  );
}
