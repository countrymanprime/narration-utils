import { useState } from 'react';
import { useApi } from '../../api/ApiContext';
import { apiErrorMessage } from '../../api/errorMessage';
import { usePendingAction } from '../../hooks/usePendingAction';
import type { Finding, FindingNavigation, ReaperStatus, TakeReviewEvidence } from '../../types';
import { Button } from '../primitives/Button';
import { ConfirmDialog } from '../primitives/ConfirmDialog';
import { Select } from '../primitives/Select';
import { TooltipTarget } from '../primitives/Tooltip';
import { AuditionDialog } from './AuditionDialog';
import { formatTime } from './findingFormat';
import { doneMessage } from './ReaperControls';
import { coverageLabel, memberLabel, sourceFileName } from './takeReviewFormat';

const CHECKING = 'Checking whether REAPER is connected…';
const NO_ITEM = 'This read has no REAPER item to go to. Scan the chapter again to find it where it is now.';
const NOT_ACCEPTED = 'Accept this finding first. A take is only added for a finding you accepted.';
const CHOOSE_BOTH = 'Choose a target item and a different candidate read.';

/**
 * The reads a take-review finding groups (take-review-pickups-duplicates-take-intelligence.prd.md Phase 5): every read of the
 * same part of the script, each with where it is in its own source, how much of the span it covers and how closely it matches
 * the script, and nothing that ranks one over another (Q9). Each read has its own Go to and Loop in REAPER, by its own item
 * GUID (ADR 0121, through FindingsGoToRead and FindingsLoopRead), in place of the finding-level controls a single-spot finding
 * has. Audition plays two reads side by side from their raw source (Phase 7). Add as take (Phase 6) is offered once the
 * narrator accepted the finding: they pick the target item and the candidate read, never preselected (Q4/Q8), and confirm
 * before REAPER adds the take in one undo step.
 */
export function TakeReviewReads({
  finding,
  evidence,
  status,
  onStatusChange,
}: {
  finding: Finding;
  evidence: TakeReviewEvidence;
  status: ReaperStatus | undefined;
  onStatusChange: () => Promise<void>;
}) {
  const api = useApi();
  const action = usePendingAction();
  const [problem, setProblem] = useState<string>();
  const [done, setDone] = useState<string>();
  const [auditioning, setAuditioning] = useState(false);
  const [adding, setAdding] = useState(false);
  const reads = evidence.members;

  const connected = status?.connection === 'connected';
  const connectionReason = status === undefined ? CHECKING : connected ? undefined : status.message;
  const looping = connected && status?.loopingFindingId === finding.id;
  const offersTake = finding.suggested_action?.kind === 'create_take' && reads.length >= 2;
  const takeBlocked = (finding.review.status === 'accepted' ? undefined : NOT_ACCEPTED) ?? connectionReason;

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

  return (
    <section aria-label="Reads" className="mt-4">
      <h3 className="text-sm font-semibold">Reads</h3>
      <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
        Every read of this part of the script. Nothing here ranks one over another: listen, then choose.
      </p>
      <ol className="mt-2 flex flex-col gap-2">
        {reads.map((read, index) => {
          const name = `read ${index + 1}`;
          const blocked = (read.item_guid ? undefined : NO_ITEM) ?? connectionReason;
          return (
            <li key={`${read.item_guid}-${read.take_guid}-${index}`} className="rounded-md border border-[var(--border)] px-3 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-medium [overflow-wrap:anywhere]">
                    Read {index + 1}: {sourceFileName(read.source_file)}
                  </div>
                  <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    {formatTime(read.source_start)} to {formatTime(read.source_start + read.source_length)} in its file · {coverageLabel(read)} ·{' '}
                    {Math.round(read.quality * 100)}% of its words match the script{read.exact_copy_group ? ' · an exact copy of another read' : ''}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <TooltipTarget text={blocked ?? `Select ${name}'s item in REAPER and put the edit cursor on it`}>
                    <Button
                      variant="ghost"
                      aria-label={`Go to ${name} in REAPER`}
                      onClick={() => void send(`goto-${index}`, () => api.findingsGoToRead(finding.id, index))}
                      disabled={Boolean(blocked) || action.isBlockedFor(`goto-${index}`)}
                      pending={action.isPending(`goto-${index}`)}
                    >
                      Go to
                    </Button>
                  </TooltipTarget>
                  <TooltipTarget text={blocked ?? `Play ${name} over and over in REAPER`}>
                    <Button
                      variant="ghost"
                      aria-label={`Loop ${name} in REAPER`}
                      onClick={() => void send(`loop-${index}`, () => api.findingsLoopRead(finding.id, index))}
                      disabled={Boolean(blocked) || action.isBlockedFor(`loop-${index}`)}
                      pending={action.isPending(`loop-${index}`)}
                    >
                      Loop
                    </Button>
                  </TooltipTarget>
                </div>
              </div>
            </li>
          );
        })}
      </ol>
      <div className="mt-3 flex flex-wrap gap-2">
        {looping && (
          <Button
            variant="ghost"
            onClick={() => void send('stop', () => api.findingsStopLoop())}
            disabled={action.isBlockedFor('stop')}
            pending={action.isPending('stop')}
          >
            Stop loop
          </Button>
        )}
        {reads.length >= 2 && (
          <TooltipTarget text="Play two reads side by side from their own audio files, without REAPER">
            <Button variant="ghost" onClick={() => setAuditioning(true)} disabled={action.isBusy}>
              Audition reads
            </Button>
          </TooltipTarget>
        )}
        {offersTake && (
          <TooltipTarget text={takeBlocked ?? 'Add one read as a new take on another read’s item in REAPER, after you confirm'}>
            <Button variant="ghost" onClick={() => setAdding(true)} disabled={Boolean(takeBlocked) || action.isBusy}>
              Add as take…
            </Button>
          </TooltipTarget>
        )}
      </div>
      {connectionReason && (
        <p className="mt-2 text-sm" style={{ color: 'var(--text-muted)' }}>
          {connectionReason}
        </p>
      )}
      {offersTake && !connectionReason && takeBlocked && (
        <p className="mt-2 text-sm" style={{ color: 'var(--text-muted)' }}>
          {takeBlocked}
        </p>
      )}
      {problem && (
        <p role="alert" className="mt-2 text-sm" style={{ color: 'var(--danger-text)' }}>
          {problem}
        </p>
      )}
      <p role="status" className="mt-2 text-sm empty:hidden">
        {done ?? (looping ? 'This finding is looping in REAPER.' : undefined)}
      </p>
      {auditioning && <AuditionDialog members={reads} onClose={() => setAuditioning(false)} />}
      {adding && (
        <AddTakeDialog
          finding={finding}
          evidence={evidence}
          onClose={() => setAdding(false)}
          onAdded={(message) => {
            setAdding(false);
            setProblem(undefined);
            setDone(message);
          }}
        />
      )}
    </section>
  );
}

/**
 * The confirm for Add as take (Phase 6): which item the take goes on (one entry per item, since two reads can be takes of the
 * same item) and which read becomes the take, both chosen by the narrator. Nothing reaches REAPER until they confirm; a stale
 * item or a REAPER failure is shown here in the host's words, and the dialog stays open to try again or cancel.
 */
function AddTakeDialog({
  finding,
  evidence,
  onClose,
  onAdded,
}: {
  finding: Finding;
  evidence: TakeReviewEvidence;
  onClose: () => void;
  onAdded: (message: string) => void;
}) {
  const api = useApi();
  const reads = evidence.members;
  const [target, setTarget] = useState('');
  const [candidate, setCandidate] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  const targetOptions = reads
    .map((read, index) => ({ read, index }))
    .filter(({ read, index }) => read.item_guid && reads.findIndex((other) => other.item_guid === read.item_guid) === index);
  const candidateOptions = reads.map((read, index) => ({ read, index })).filter(({ read }) => read.item_guid !== target);

  // A candidate on the item just chosen as the target is no longer offered, so it is cleared rather than left chosen unseen.
  const chooseTarget = (item: string) => {
    setTarget(item);
    if (candidate !== '' && reads[Number(candidate)]?.item_guid === item) setCandidate('');
  };

  const create = () => {
    const chosen = candidate === '' ? undefined : reads[Number(candidate)];
    const targetIndex = reads.findIndex((read) => read.item_guid === target);
    if (!target || !chosen || chosen.item_guid === target) {
      setError(CHOOSE_BOTH);
      return;
    }
    setCreating(true);
    setError('');
    void api
      .takeReviewCreateTake({
        findingId: finding.id,
        targetItemGuid: target,
        candidateItemGuid: chosen.item_guid,
        sourceFile: chosen.source_file,
        sourceRangeStart: chosen.source_start,
        sourceRangeEnd: chosen.source_start + chosen.source_length,
      })
      .then(() =>
        onAdded(
          `REAPER added read ${Number(candidate) + 1} as a new take on read ${targetIndex + 1}'s item. The take that was playing stays active; one Undo in REAPER removes the new one.`,
        ),
      )
      .catch((reason) => setError(apiErrorMessage(reason)))
      .finally(() => setCreating(false));
  };

  return (
    <ConfirmDialog
      title="Add candidate as a new take"
      body="Choose the item this take is added to and which read to attach as its source. The previous active take stays active, and the item's length is never changed; this can be undone with one Undo in REAPER."
      confirmLabel="Create take"
      confirm={create}
      cancel={() => !creating && onClose()}
      pending={creating}
    >
      <div className="mt-3 flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm">
          Target item (where the take is added)
          <Select
            label="Target item"
            value={target}
            onChange={chooseTarget}
            fullWidth
            options={[
              { value: '', label: 'Choose a target item…' },
              ...targetOptions.map(({ read, index }) => ({ value: read.item_guid, label: `Read ${index + 1}’s item — ${sourceFileName(read.source_file)}` })),
            ]}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Candidate (source attached as the new take)
          <Select
            label="Candidate read"
            value={candidate}
            onChange={setCandidate}
            fullWidth
            options={[
              { value: '', label: 'Choose a candidate read…' },
              ...candidateOptions.map(({ read, index }) => ({ value: String(index), label: memberLabel(read, index) })),
            ]}
          />
        </label>
        {error && (
          <p role="alert" className="text-sm" style={{ color: 'var(--danger-text)' }}>
            {error}
          </p>
        )}
      </div>
    </ConfirmDialog>
  );
}
