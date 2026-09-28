import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApi } from '../../api/ApiContext';
import { apiErrorMessage } from '../../api/errorMessage';
import { takeComparisonEvidenceSchema } from '../../api/schemas/takeReview';
import type { Finding, ReaperStatus, WorkspaceAlignmentResult } from '../../types';
import type { PassageTake, PassageTakeSource, WorkspaceTakesResult } from '../../api/contracts/workspace';
import { usePendingAction } from '../../hooks/usePendingAction';
import { Button } from '../primitives/Button';
import { ConfirmDialog } from '../primitives/ConfirmDialog';
import { InsetCard } from '../primitives/InsetCard';
import { Panel } from '../primitives/Panel';
import { StatusBadge } from '../primitives/StatusBadge';
import { TooltipTarget } from '../primitives/Tooltip';
import { AuditionDialog } from './AuditionDialog';
import { TakeComparisonDialog } from './TakeComparisonDialog';
import { TakeComparisonView } from './TakeComparisonView';
import { auditionRangeOf, paragraphPassage, passageLabel } from './takesPassage';

/** How often a lane pick REAPER was asked for is read until it ends. */
const LANE_POLL_MS = 500;

const SOURCE_LABEL: Record<PassageTakeSource, string> = {
  item_take: 'Another take of this item',
  lane_retake: 'Retake on another lane',
  take_review: 'Read from Find pickups',
};

type Notice = { tone: 'ok' | 'problem'; message: string };

type TakesPanelProps = {
  chapterId: string;
  alignment: WorkspaceAlignmentResult;
  /** The word at the playhead: the passage is its paragraph. */
  currentToken: number | undefined;
  /** The chapter's findings, one of which may be the saved comparison of the passage's takes. */
  findings: Finding[];
  reaper: ReaperStatus | undefined;
  onReaperStatusChange: () => Promise<void>;
  /** A comparison saved a finding: the page reads its findings again. */
  onFindingsChanged: () => void;
};

/**
 * The Takes panel (edit-and-proof-workspace.prd.md Phase 6, EP6 and EP7, ADR 0700): for the paragraph at the playhead, every
 * take the narrator has to choose from (the other takes of the item it was heard on, the other retakes of its line on a
 * fixed lane, and the reads Find pickups and duplicates set beside it), heard side by side from their raw recordings (the
 * take review A/B), compared word by word when the narrator asks (a take never compared says so), and chosen with "Use this take".
 * The panel sends the host a chapter and a range of words, and the id of a take the host listed: never a GUID, a file or a
 * time. A take that only exists as a read on another item is added as a take and made active in one action the narrator
 * confirms first (EP7); every other choice is one undo step in REAPER, and each says what it did in the host's words.
 */
export function TakesPanel({ chapterId, alignment, currentToken, findings, reaper, onReaperStatusChange, onFindingsChanged }: TakesPanelProps) {
  const api = useApi();
  const action = usePendingAction();
  const [passage, setPassage] = useState<{ firstToken: number; lastToken: number }>();
  const [takes, setTakes] = useState<WorkspaceTakesResult>();
  const [problem, setProblem] = useState<string>();
  const [notice, setNotice] = useState<Notice>();
  const [confirming, setConfirming] = useState<PassageTake>();
  const [comparing, setComparing] = useState(false);
  const [auditioning, setAuditioning] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const here = useMemo(() => paragraphPassage(alignment.tokens, currentToken), [alignment.tokens, currentToken]);

  const load = useCallback(
    async (range: { firstToken: number; lastToken: number }) => {
      try {
        setTakes(await api.workspaceTakes(chapterId, range.firstToken, range.lastToken));
        setProblem(undefined);
      } catch (error) {
        setTakes(undefined);
        setProblem(apiErrorMessage(error));
      }
    },
    [api, chapterId],
  );

  useEffect(() => {
    if (passage) void load(passage);
  }, [passage, load]);

  const usable = useMemo(() => (takes?.candidates ?? []).filter((candidate) => candidate.usable), [takes]);
  const comparison = takes?.comparisonId ? findings.find((finding) => finding.id === takes.comparisonId) : undefined;
  const evidence = useMemo(() => {
    const parsed = comparison ? takeComparisonEvidenceSchema.safeParse(comparison.evidence) : undefined;
    return parsed?.success ? parsed.data : undefined;
  }, [comparison]);

  const reaperBlocked =
    reaper === undefined
      ? 'Checking whether REAPER is connected…'
      : reaper.connection !== 'connected'
        ? (reaper.message ?? 'REAPER is not connected.')
        : undefined;

  const use = async (candidate: PassageTake) => {
    if (!passage) return;
    setConfirming(undefined);
    setNotice(undefined);
    const result = await action.run(`use-${candidate.id}`, async () => {
      try {
        return await api.workspaceUseTake(chapterId, passage.firstToken, passage.lastToken, candidate.id);
      } catch (error) {
        return { outcome: 'refused' as const, message: apiErrorMessage(error), changed: false };
      }
    });
    if (!result) return;
    setNotice({ tone: result.outcome === 'refused' ? 'problem' : 'ok', message: result.message });
    if (result.outcome === 'started') void followLanePick();
    await Promise.all([load(passage), onReaperStatusChange()]);
  };

  // A lane pick ends on REAPER's own event: read its state until it is no longer picking, then say how it ended.
  const followLanePick = async () => {
    for (let waited = 0; waited < 20; waited += 1) {
      await new Promise((resolve) => setTimeout(resolve, LANE_POLL_MS));
      if (!mounted.current) return;
      try {
        const state = await api.retakeLanesState();
        if (state.phase === 'picking') continue;
        setNotice({ tone: state.phase === 'error' ? 'problem' : 'ok', message: state.message });
        if (passage) await load(passage);
        return;
      } catch {
        return;
      }
    }
  };

  const chooseParagraph = () => {
    if (here) {
      setPassage({ firstToken: here.firstToken, lastToken: here.lastToken });
      setNotice(undefined);
    }
  };

  const label = takes ? passageLabel(alignment.paragraphs, takes.firstParagraph, takes.lastParagraph) : undefined;
  const auditionMembers = usable.map((candidate) => ({
    ...auditionRangeOf(
      candidate,
      evidence?.members.find((member) => member.item_guid === candidate.itemGuid && member.take_guid === candidate.takeGuid),
    ),
    name: candidate.label,
  }));

  return (
    <Panel title="Takes" subtitle="Hear them, compare them, choose one">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0 text-sm">
            {label ? (
              <>
                <span className="font-semibold">{label.title}</span>
                {label.excerpt && <span style={{ color: 'var(--text-muted)' }}> · {label.excerpt}</span>}
              </>
            ) : (
              <span style={{ color: 'var(--text-muted)' }}>Play or click a word, then show the takes of its paragraph.</span>
            )}
          </div>
          <TooltipTarget
            text={
              here
                ? 'List the takes you can choose from for the paragraph at the playhead'
                : 'Play or click a word first: the takes shown are for its paragraph.'
            }
          >
            <Button variant="secondary" onClick={chooseParagraph} disabled={!here}>
              {passage ? 'Show takes for the paragraph at the playhead' : 'Show takes for this paragraph'}
            </Button>
          </TooltipTarget>
        </div>

        {problem && (
          <p role="alert" className="text-sm" style={{ color: 'var(--danger-text)' }}>
            {problem}
          </p>
        )}
        {takes?.message && (
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            {takes.message}
          </p>
        )}
        {takes && !takes.message && takes.candidates.length === 0 && (
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            This paragraph has only one take, and no retake or repeated read was found for it. Record another, or run Find pickups and duplicates.
          </p>
        )}

        {takes && takes.candidates.length > 0 && (
          <>
            <ol aria-label="Takes of this passage" className="flex flex-col gap-2">
              {takes.candidates.map((candidate) => {
                const blocked = !candidate.usable ? candidate.reason : reaperBlocked;
                return (
                  <InsetCard as="li" key={candidate.id}>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{candidate.label}</span>
                          <StatusBadge tone="neutral" label={SOURCE_LABEL[candidate.source]} />
                          {candidate.active && <StatusBadge tone="success" label="Playing in REAPER" />}
                        </div>
                        <div className="text-xs [overflow-wrap:anywhere]" style={{ color: 'var(--text-muted)' }}>
                          {candidate.detail}
                        </div>
                        <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                          {candidate.compared
                            ? `Matched ${Math.round((candidate.fidelity ?? 0) * 100)}% of the passage's words`
                            : (candidate.notComparedReason ?? 'Not compared yet')}
                        </div>
                        {!candidate.usable && candidate.reason && (
                          <div className="text-xs" style={{ color: 'var(--danger-text)' }}>
                            {candidate.reason}
                          </div>
                        )}
                      </div>
                      <TooltipTarget
                        text={
                          candidate.active
                            ? 'This take is the one playing now'
                            : (blocked ??
                              (candidate.confirm
                                ? 'Add this read as a new take on the item and make it active, after you confirm'
                                : candidate.action === 'pick_lane'
                                  ? 'Make this retake the lane that plays, in one undo step'
                                  : 'Make this the item’s active take, in one undo step'))
                        }
                      >
                        <Button
                          variant="secondary"
                          aria-label={`Use ${candidate.label.toLowerCase()}${candidate.source === 'item_take' ? '' : ` (${SOURCE_LABEL[candidate.source].toLowerCase()})`}`}
                          onClick={() => (candidate.confirm ? setConfirming(candidate) : void use(candidate))}
                          disabled={candidate.active || Boolean(blocked) || action.isBusy}
                          pending={action.isPending(`use-${candidate.id}`)}
                        >
                          Use this take
                        </Button>
                      </TooltipTarget>
                    </div>
                  </InsetCard>
                );
              })}
            </ol>

            <div className="flex flex-wrap gap-2">
              <TooltipTarget
                text={
                  usable.length < 2
                    ? 'Two takes that can be heard are needed'
                    : 'Play two of these takes side by side from their own recordings, without REAPER'
                }
              >
                <Button variant="secondary" onClick={() => setAuditioning(true)} disabled={usable.length < 2}>
                  Hear side by side
                </Button>
              </TooltipTarget>
              <TooltipTarget
                text={
                  usable.length < 2
                    ? 'Two takes that can be heard are needed'
                    : 'Transcribe each take again and set its words beside the script. This takes a little while'
                }
              >
                <Button variant="secondary" onClick={() => setComparing(true)} disabled={usable.length < 2}>
                  {takes.comparisonId ? 'Compare again' : 'Compare takes'}
                </Button>
              </TooltipTarget>
            </div>
          </>
        )}

        {takes && takes.candidates.length > 0 && reaperBlocked && reaper !== undefined && (
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            Use this take needs REAPER. {reaperBlocked}
          </p>
        )}

        {notice && (
          <p
            role={notice.tone === 'problem' ? 'alert' : 'status'}
            className="text-sm"
            style={notice.tone === 'problem' ? { color: 'var(--danger-text)' } : undefined}
          >
            {notice.message}
          </p>
        )}

        {comparison && evidence && <TakeComparisonView finding={comparison} evidence={evidence} status={reaper} onStatusChange={onReaperStatusChange} />}
      </div>

      {confirming && (
        <ConfirmDialog
          title="Add this read and make it active"
          body={`REAPER will add this read (${confirming.detail}) as a new take on the item, then make it the active take. That is two undo steps in REAPER, and the item's length and position do not change.`}
          confirmLabel="Add and make active"
          confirm={() => void use(confirming)}
          cancel={() => setConfirming(undefined)}
        />
      )}
      {auditioning && <AuditionDialog members={auditionMembers} label={(member) => member.name} onClose={() => setAuditioning(false)} />}
      {comparing && takes && passage && (
        <TakeComparisonDialog
          findingId={takes.passageId}
          start={() => api.workspaceTakesCompareStart(chapterId, passage.firstToken, passage.lastToken)}
          onClose={(ended) => {
            setComparing(false);
            if (ended?.phase === 'success') {
              onFindingsChanged();
              void load(passage);
            }
          }}
        />
      )}
    </Panel>
  );
}
