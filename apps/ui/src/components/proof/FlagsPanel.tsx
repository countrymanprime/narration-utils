import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faChevronLeft, faChevronRight } from '@fortawesome/free-solid-svg-icons';
import { useState } from 'react';
import { usePendingAction } from '../../hooks/usePendingAction';
import { MAX_REVIEW_NOTE_LENGTH, type FindingReviewStatus } from '../../api/contracts/findings';
import { Button } from '../primitives/Button';
import { Field } from '../primitives/Field';
import { Panel } from '../primitives/Panel';
import { StatusBadge } from '../primitives/StatusBadge';
import { TooltipTarget } from '../primitives/Tooltip';
import { analyzerLabel, STATUS_LABELS } from './findingFormat';
import type { WorkspaceToken } from '../../api/contracts/workspace';
import type { Discrepancy } from '../../api/contracts/transcript';
import { canAddEquivalence } from '../../state';
import { InlineDiff } from './InlineDiff';
import type { Flag, FlagKind } from './flags';
import { formatElapsed } from './format';
import type { WorkspaceReaperControls } from './useWorkspaceReaper';

const KIND_ORDER: FlagKind[] = ['skip', 'partial', 'not_recorded', 'misread', 'extra', 'pickup', 'cleanup'];

// The decisions a narrator can make on a flag backed by a Finding, in the order the buttons show them (mirrors
// review/FindingDetail.tsx's own DECISIONS - kept as its own small array rather than a shared import, since the two
// panels' surrounding markup differs enough that sharing the array alone would buy little).
const DECISIONS: Array<{ status: FindingReviewStatus; label: string; variant: 'primary' | 'ghost' }> = [
  { status: 'accepted', label: 'Accept', variant: 'primary' },
  { status: 'dismissed', label: 'Dismiss', variant: 'ghost' },
  { status: 'deferred', label: 'Defer', variant: 'ghost' },
];

export type FlagDecisionResult = { ok: true } | { ok: false; message: string };

/** A Transcript Compare discrepancy's own actions, from the Proofing page's results row (stage-navigation Phase 5). */
export type CompareFlagActions = {
  /** Whether Play recorded audio may call the live REAPER bridge (a linked project file, PRD W16). */
  canJump: boolean;
  jump: (row: Discrepancy) => void;
  addEquivalence: (row: Discrepancy) => void;
  showInManuscript: (row: Discrepancy) => void;
};

function countByKind(flags: readonly Flag[]): Array<{ kind: FlagKind; label: string; count: number }> {
  const counts = new Map<FlagKind, { label: string; count: number }>();
  flags.forEach((flag) => {
    const existing = counts.get(flag.kind);
    if (existing) existing.count += 1;
    else counts.set(flag.kind, { label: flag.label, count: 1 });
  });
  return KIND_ORDER.filter((kind) => counts.has(kind)).map((kind) => ({ kind, ...counts.get(kind)! }));
}

/**
 * A finding-backed flag's decision (edit-and-proof-workspace.prd.md Phase 4, mockups/edit-and-proof-workspace/02-flag-detail-open.webp
 * "DECISION"): accept, dismiss, defer and an optional note, sent through the same `findingsReview` binding the Review page uses - a
 * decision made here shows there too, and the other way round. Its own component (not inlined in FlagsPanel) so the parent can key it by
 * the flag's id and get a fresh note field on every selection, the same trick FindingDetail's caller uses.
 */
function FlagDecision({ flag, onDecide }: { flag: Flag; onDecide: (status: FindingReviewStatus, note: string) => Promise<FlagDecisionResult> }) {
  const [note, setNote] = useState('');
  const [problem, setProblem] = useState<string>();
  const [saved, setSaved] = useState<string>();
  const action = usePendingAction();
  const noteTooLong = [...note].length > MAX_REVIEW_NOTE_LENGTH;

  const decide = (status: FindingReviewStatus) =>
    action.run(status, async () => {
      setProblem(undefined);
      setSaved(undefined);
      const result = await onDecide(status, note.trim());
      if (result.ok) setSaved(`Saved as ${STATUS_LABELS[status].toLowerCase()}.`);
      else setProblem(`Not saved: ${result.message}`);
    });

  const decided = flag.reviewStatus !== undefined && flag.reviewStatus !== 'unreviewed';

  return (
    <div className="mt-3 space-y-2 border-t pt-3 text-sm" style={{ borderColor: 'var(--border)' }}>
      <div className="section-label">Decision</div>
      {decided && <p style={{ color: 'var(--text-muted)' }}>{STATUS_LABELS[flag.reviewStatus!]}.</p>}
      <Field
        label="Note (optional)"
        textarea
        value={note}
        onChange={setNote}
        error={noteTooLong ? `A note can be at most ${MAX_REVIEW_NOTE_LENGTH} characters.` : undefined}
      />
      <div className="flex flex-wrap gap-2">
        {DECISIONS.map((decision) => (
          <Button
            key={decision.status}
            variant={decision.variant}
            className="px-3 py-1"
            onClick={() => void decide(decision.status)}
            pending={action.isPending(decision.status)}
            disabled={noteTooLong || action.isBlockedFor(decision.status)}
          >
            {decision.label}
          </Button>
        ))}
      </div>
      {problem && (
        <p role="alert" style={{ color: 'var(--danger-text)' }}>
          {problem}
        </p>
      )}
      <p role="status" className="empty:hidden">
        {saved}
      </p>
      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
        Accept keeps it as a fix to make. Decisions show in the book's notes on Proof too.
      </p>
    </div>
  );
}

/** The Proofing page's per-row actions for a compare discrepancy, now under its flag's diff. */
function CompareActions({ row, actions }: { row: Discrepancy; actions: CompareFlagActions }) {
  const eligible = canAddEquivalence(row);
  const marker = row.markerState ?? 'pending';
  return (
    <>
      <div>
        <span className="section-label">Marker</span> {marker === 'pending' && <StatusBadge tone="progress" label="Ready to export" />}
        {marker === 'exported' && <StatusBadge tone="success" label="Exported" />}
        {marker === 'existing' && (
          <TooltipTarget text={row.existingMarkerName ? `Existing marker: ${row.existingMarkerName}` : 'A matching marker already exists'}>
            <span>
              <StatusBadge tone="warning" label="Already marked" />
            </span>
          </TooltipTarget>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <TooltipTarget text={row.chapter ? 'Open this line in the Manuscript' : 'No manuscript source is available'}>
          <Button variant="ghost" disabled={!row.chapter} onClick={() => actions.showInManuscript(row)}>
            Show in manuscript
          </Button>
        </TooltipTarget>
        <TooltipTarget
          text={
            actions.canJump ? `Play the heard audio at ${formatElapsed(row.projectTime)} in REAPER` : 'Link a REAPER project (.rpp) file to play recorded audio'
          }
        >
          <Button variant="ghost" disabled={!row.projectTime || !actions.canJump} onClick={() => actions.jump(row)}>
            Play recorded audio
          </Button>
        </TooltipTarget>
        <TooltipTarget text={eligible ? 'Add pronunciation equivalence' : 'Only available for single-word misreads'}>
          <Button variant="ghost" disabled={!eligible} onClick={() => actions.addEquivalence(row)}>
            Add pronunciation equivalence
          </Button>
        </TooltipTarget>
      </div>
    </>
  );
}

/**
 * The workspace's flag legend and detail (edit-and-proof-workspace.prd.md Phase 2, EP4; Phase 4 review-in-place):
 * counts by kind, next and previous navigation over every flag in the chapter, and the selected flag's script/heard
 * text. A flag backed by a stored Finding (Phase 4, `overlayFindings`) also shows where it came from ("From <analyzer>,
 * <time>") and its own Go to/Loop in REAPER for that word (mockups/edit-and-proof-workspace/02-flag-detail-open.webp),
 * plus the decision controls above (FlagDecision). A flag with no finding - straight from the check's own alignment -
 * stays read-only, with only "Play from here" (the app's own player).
 */
export function FlagsPanel({
  flags,
  tokens,
  selectedIndex,
  onSelect,
  onPlayFromFlag,
  reaper,
  onDecide,
  compare,
}: {
  flags: readonly Flag[];
  tokens: readonly WorkspaceToken[];
  selectedIndex: number | undefined;
  onSelect: (index: number) => void;
  onPlayFromFlag: (flag: Flag) => void;
  /** Go to/Loop in REAPER for the selected flag's word, shared with the transport bar's own (Phase 3). */
  reaper: Pick<WorkspaceReaperControls, 'goToTokenBlocked' | 'loopTokenBlocked' | 'tokenPending' | 'goToToken' | 'loopToken'>;
  /** Records a decision on the selected flag's finding; undefined flags never call this (no findingId to decide on). */
  onDecide: (flag: Flag, status: FindingReviewStatus, note: string) => Promise<FlagDecisionResult>;
  /** The actions of a flag that carries a compare run's discrepancy; absent when no run's results are shown. */
  compare?: CompareFlagActions;
}) {
  const selected = selectedIndex !== undefined ? flags[selectedIndex] : undefined;
  const scriptWords = selected ? tokens.slice(selected.tokenStart, selected.tokenEnd + 1).map((token) => token.text) : [];
  const selectedTime = selected?.seekTokenIndex !== undefined ? tokens[selected.seekTokenIndex]?.start : undefined;

  return (
    <Panel title={`Flags · ${flags.length}`}>
      <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
        What Whisper heard, not proof. From the chapter&rsquo;s last check.
      </p>
      <ul className="mt-2 space-y-1 text-sm">
        {countByKind(flags).map(({ kind, label, count }) => (
          <li key={kind} className="flex items-center justify-between">
            <span>{label}</span>
            <span style={{ color: 'var(--text-muted)' }}>{count}</span>
          </li>
        ))}
        {flags.length === 0 && <li style={{ color: 'var(--text-muted)' }}>No flags on this chapter&rsquo;s current check.</li>}
      </ul>
      {flags.length > 0 && (
        <div className="mt-3 flex items-center justify-center gap-2">
          <Button
            variant="ghost"
            aria-label="Previous flag"
            disabled={selectedIndex === undefined || selectedIndex <= 0}
            onClick={() => selectedIndex !== undefined && onSelect(selectedIndex - 1)}
          >
            <FontAwesomeIcon icon={faChevronLeft} />
          </Button>
          <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
            {selectedIndex !== undefined ? `Flag ${selectedIndex + 1} of ${flags.length}` : `${flags.length} flag${flags.length === 1 ? '' : 's'}`}
          </span>
          <Button
            variant="ghost"
            aria-label="Next flag"
            disabled={selectedIndex === undefined ? flags.length === 0 : selectedIndex >= flags.length - 1}
            onClick={() => onSelect(selectedIndex === undefined ? 0 : selectedIndex + 1)}
          >
            <FontAwesomeIcon icon={faChevronRight} />
          </Button>
        </div>
      )}
      {selected && (
        <div className="mt-4 space-y-2 border-t pt-3 text-sm" style={{ borderColor: 'var(--border)' }}>
          <div className="font-semibold">{selected.label}</div>
          {selected.discrepancy ? (
            <InlineDiff row={selected.discrepancy} />
          ) : (
            <>
              <div>
                <span className="section-label">Script</span> &ldquo;{scriptWords.length > 0 ? scriptWords.join(' ') : (selected.script ?? '')}&rdquo;
              </div>
              {selected.heard && (
                <div>
                  <span className="section-label">Heard</span> &ldquo;{selected.heard}&rdquo;
                </div>
              )}
            </>
          )}
          {selected.analyzer && (
            <div style={{ color: 'var(--text-muted)' }}>
              <span className="section-label">From</span> {analyzerLabel(selected.analyzer)}
              {selectedTime !== undefined && `, ${formatElapsed(selectedTime)}`}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" disabled={selected.seekTokenIndex === undefined} onClick={() => onPlayFromFlag(selected)}>
              Play from here
            </Button>
            {selected.seekTokenIndex !== undefined && (
              <>
                <TooltipTarget text={reaper.goToTokenBlocked(selected.seekTokenIndex) ?? "Select this word's item in REAPER and put the edit cursor on it"}>
                  <Button
                    variant="ghost"
                    disabled={Boolean(reaper.goToTokenBlocked(selected.seekTokenIndex)) || reaper.tokenPending !== undefined}
                    pending={reaper.tokenPending === 'goTo'}
                    onClick={() => void reaper.goToToken(selected.seekTokenIndex!)}
                  >
                    Go to in REAPER
                  </Button>
                </TooltipTarget>
                <TooltipTarget text={reaper.loopTokenBlocked(selected.seekTokenIndex) ?? 'Play this word over and over in REAPER'}>
                  <Button
                    variant="ghost"
                    disabled={Boolean(reaper.loopTokenBlocked(selected.seekTokenIndex)) || reaper.tokenPending !== undefined}
                    pending={reaper.tokenPending === 'loop'}
                    onClick={() => void reaper.loopToken(selected.seekTokenIndex!)}
                  >
                    Loop in REAPER
                  </Button>
                </TooltipTarget>
              </>
            )}
          </div>
          {selected.discrepancy && compare && <CompareActions row={selected.discrepancy} actions={compare} />}
          {selected.findingId && <FlagDecision key={selected.findingId} flag={selected} onDecide={(status, note) => onDecide(selected, status, note)} />}
        </div>
      )}
    </Panel>
  );
}
