import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faArrowRightArrowLeft, faPause, faPlay } from '@fortawesome/free-solid-svg-icons';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useApi } from '../../api/ApiContext';
import { apiErrorMessage } from '../../api/errorMessage';
import { takeComparisonEvidenceSchema } from '../../api/schemas/takeReview';
import type { Finding, ReaperStatus, TakeComparisonEvidence, TakeComparisonMember, WorkspaceAlignmentResult } from '../../types';
import type { PassageTake, PassageTakeSource, WorkspaceTakesResult } from '../../api/contracts/workspace';
import { usePendingAction } from '../../hooks/usePendingAction';
import { useRangePlayer, type AuditionRange } from '../engine/useRangePlayer';
import { Button } from '../primitives/Button';
import { ConfirmDialog } from '../primitives/ConfirmDialog';
import { IconButton } from '../primitives/IconButton';
import { InsetCard } from '../primitives/InsetCard';
import { Panel } from '../primitives/Panel';
import { StatusBadge } from '../primitives/StatusBadge';
import { ToggleGroup } from '../primitives/ToggleGroup';
import { TooltipTarget } from '../primitives/Tooltip';
import { TakeComparisonDialog } from './TakeComparisonDialog';
import { TakeComparisonView, WORD_STYLE } from './TakeComparisonView';
import { evidenceLine } from './takeComparisonFormat';
import { auditionRangeOf, paragraphPassage, swapPosition } from './takesPassage';

/** How often a lane pick REAPER was asked for is read until it ends. */
const LANE_POLL_MS = 500;

/** How many words of the passage a take's card shows around where the take departs from it (the mock's selection is 13). */
const WINDOW_BEFORE = 5;
const WINDOW_AFTER = 7;

type Mode = 'one' | 'ab';
type Slot = 'a' | 'b';
type Notice = { tone: 'ok' | 'problem'; message: string };

const SOURCE_LABEL: Record<PassageTakeSource, string> = {
  item_take: 'Another take of this item',
  lane_retake: 'Retake on another lane',
  take_review: 'Read from Find pickups',
};

const seconds = (value: number): string => `${value.toFixed(1)} s`;

/** What a card says under a take's name: where it came from and how long it plays. */
function metaOf(take: PassageTake): string {
  const length = seconds(take.sourceLength);
  if (take.source === 'item_take') return `This item · ${take.active ? 'active take' : 'other take'} · ${length}`;
  return `${SOURCE_LABEL[take.source]} · ${length}`;
}

const rangeOf = (take: PassageTake, member: TakeComparisonMember | undefined): AuditionRange => {
  const source = auditionRangeOf(take, member);
  return { sourceFile: source.source_file, rangeStart: source.source_start, rangeEnd: source.source_start + source.source_length };
};

/** The passage's words around where a take departs from it (or its first words), the departures marked as the comparison marks them. */
function WordWindow({ evidence, member }: { evidence: TakeComparisonEvidence; member: TakeComparisonMember }) {
  const words = evidence.span.words;
  const statuses = new Map(member.words.map((word) => [word.index, word.status]));
  const firstDeparture = words.findIndex((word) => (statuses.get(word.index) ?? 'matched') !== 'matched');
  const start = firstDeparture < 0 ? 0 : Math.max(0, firstDeparture - WINDOW_BEFORE);
  const end = Math.min(words.length, start + WINDOW_BEFORE + WINDOW_AFTER + 1);
  return (
    <p className="mt-2 text-sm leading-6">
      {start > 0 && '… '}
      {words.slice(start, end).map((word, index) => {
        const status = statuses.get(word.index) ?? 'matched';
        const style = status === 'matched' ? undefined : WORD_STYLE[status];
        return (
          <span key={word.index}>
            {index > 0 && ' '}
            {style ? (
              <span className={style.className}>
                {word.text}
                <span className="sr-only"> ({style.said})</span>
              </span>
            ) : (
              word.text
            )}
          </span>
        );
      })}
      {end < words.length && ' …'}
    </p>
  );
}

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
  /** Where the full comparison (words and audio measurements side by side) is drawn, wider than this column. */
  detailTarget: HTMLElement | null;
};

/**
 * The Takes panel (edit-and-proof-workspace.prd.md Phase 6, EP6 and EP7, ADR 0700; mock `04-takes-panel-ab`): for the paragraph at
 * the playhead, every take the narrator has to choose from (the other takes of the item it was heard on, the other retakes of its
 * line on a fixed lane, and the reads Find pickups and duplicates set beside it), each with a play button. **One** plays a take at
 * a time; **A/B** puts two of them in slots and swaps between them at the same word (the compared word when both takes were
 * compared, the same distance into the passage otherwise), from the raw recordings and without REAPER. Each take says how it read
 * the passage once compared (never a score) or offers Compare, and Use this take makes it the one that plays in REAPER. The panel
 * sends the host a chapter and a range of words, and the id of a take the host listed: never a GUID, a file or a time. A read that
 * only exists on another item is added as a take and made active in one action the narrator confirms first (EP7); every other
 * choice is one undo step in REAPER, and each says what it did in the host's words.
 */
export function TakesPanel({ chapterId, alignment, currentToken, findings, reaper, onReaperStatusChange, onFindingsChanged, detailTarget }: TakesPanelProps) {
  const api = useApi();
  const action = usePendingAction();
  const [passage, setPassage] = useState<{ firstToken: number; lastToken: number; paragraphId: string }>();
  const [takes, setTakes] = useState<WorkspaceTakesResult>();
  const [problem, setProblem] = useState<string>();
  const [notice, setNotice] = useState<Notice>();
  const [confirming, setConfirming] = useState<PassageTake>();
  const [comparing, setComparing] = useState(false);
  const [mode, setMode] = useState<Mode>('one');
  const [slots, setSlots] = useState<Partial<Record<Slot, string>>>({});
  const playerA = useRangePlayer(api.mediaUrl);
  const playerB = useRangePlayer(api.mediaUrl);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const here = useMemo(() => paragraphPassage(alignment.tokens, currentToken), [alignment.tokens, currentToken]);
  // The first paragraph heard is the passage until the narrator asks for another.
  useEffect(() => {
    if (!passage && here) setPassage(here);
  }, [passage, here]);

  const load = useCallback(
    async (range: { firstToken: number; lastToken: number }) => {
      try {
        const read = await api.workspaceTakes(chapterId, range.firstToken, range.lastToken);
        if (mounted.current) {
          setTakes(read);
          setProblem(undefined);
        }
      } catch (error) {
        if (mounted.current) {
          setTakes(undefined);
          setProblem(apiErrorMessage(error));
        }
      }
    },
    [api, chapterId],
  );

  useEffect(() => {
    if (passage) void load(passage);
  }, [passage, load]);

  const candidates = useMemo(() => takes?.candidates ?? [], [takes]);
  const usable = useMemo(() => candidates.filter((candidate) => candidate.usable), [candidates]);
  const comparison = takes?.comparisonId ? findings.find((finding) => finding.id === takes.comparisonId) : undefined;
  const evidence = useMemo(() => {
    const parsed = comparison ? takeComparisonEvidenceSchema.safeParse(comparison.evidence) : undefined;
    return parsed?.success ? parsed.data : undefined;
  }, [comparison]);
  const memberOf = useCallback(
    (take: PassageTake) => evidence?.members.find((member) => member.item_guid === take.itemGuid && member.take_guid === take.takeGuid),
    [evidence],
  );

  const reaperBlocked =
    reaper === undefined
      ? 'Checking whether REAPER is connected…'
      : reaper.connection !== 'connected'
        ? (reaper.message ?? 'REAPER is not connected.')
        : undefined;
  const playerOf = (slot: Slot) => (slot === 'a' ? playerA : playerB);
  const slotOf = (id: string): Slot | undefined => (slots.a === id ? 'a' : slots.b === id ? 'b' : undefined);
  const byId = (id: string | undefined) => candidates.find((candidate) => candidate.id === id);

  // One at a time: whichever player is playing is the one the narrator hears.
  const stopAll = () => {
    playerA.stop();
    playerB.stop();
  };

  const togglePlay = (take: PassageTake) => {
    setNotice(undefined);
    let slot: Slot = 'a';
    if (mode === 'ab') {
      slot = slotOf(take.id) ?? (!slots.a ? 'a' : !slots.b ? 'b' : playerA.isPlaying ? 'b' : 'a');
    }
    const player = playerOf(slot);
    if (player.isPlaying && slots[slot] === take.id) {
      player.stop();
      return;
    }
    stopAll();
    setSlots((current) => (mode === 'one' ? { a: take.id } : { ...current, [slot]: take.id }));
    player.play(rangeOf(take, memberOf(take)));
  };

  // A/B: the take that is not playing starts where the same word of the playing one is, and the playing one stops.
  const swap = () => {
    const playing: Slot | undefined = playerA.isPlaying ? 'a' : playerB.isPlaying ? 'b' : undefined;
    const from = byId(slots[playing ?? 'b']);
    const to = byId(slots[playing === 'a' ? 'b' : 'a']);
    if (!to) return;
    const target = playing === 'a' ? 'b' : 'a';
    if (playing && from) {
      const fromSide = { range: auditionRangeOf(from, memberOf(from)), member: memberOf(from) };
      const toSide = { range: auditionRangeOf(to, memberOf(to)), member: memberOf(to) };
      const at = swapPosition(playerOf(playing).position(), fromSide, toSide);
      stopAll();
      playerOf(target).play(rangeOf(to, memberOf(to)), at);
    } else {
      playerOf(target).play(rangeOf(to, memberOf(to)));
    }
  };

  const changeMode = (next: string) => {
    stopAll();
    setMode(next === 'ab' ? 'ab' : 'one');
    setSlots({});
  };

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
      } catch (error) {
        setNotice({ tone: 'problem', message: `Could not tell whether REAPER made that lane play: ${apiErrorMessage(error)}` });
        return;
      }
    }
  };

  const retarget = () => {
    if (!here) return;
    stopAll();
    setSlots({});
    setNotice(undefined);
    setPassage(here);
  };

  const paragraphs = takes
    ? takes.firstParagraph === takes.lastParagraph
      ? `¶${takes.firstParagraph + 1}`
      : `¶${takes.firstParagraph + 1}–${takes.lastParagraph + 1}`
    : undefined;
  const title = candidates.length > 0 ? `Takes · ${candidates.length} alternates` : 'Takes';
  const elsewhere = here !== undefined && passage !== undefined && here.paragraphId !== passage.paragraphId;
  const swappable = mode === 'ab' && Boolean(slots.a && slots.b);

  return (
    <>
      <Panel
        title={title}
        actions={paragraphs && takes ? <span className="text-xs text-[var(--text-muted)]">{`${paragraphs} · ${takes.words} words`}</span> : undefined}
      >
        <div className="flex flex-col gap-3">
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            Evidence per word, never a score.
          </p>

          {candidates.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <ToggleGroup
                label="Listen to"
                look="segmented"
                value={mode}
                onChange={changeMode}
                options={[
                  { value: 'one', label: 'One', title: 'Play one take at a time' },
                  { value: 'ab', label: 'A/B', title: 'Put two takes in slots A and B and swap between them at the same word' },
                ]}
              />
              {mode === 'ab' && (
                <>
                  <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    Swap switches A and B at the same word
                  </span>
                  <TooltipTarget text={swappable ? 'Play the other take from the same word' : 'Press play on two takes first: they become A and B'}>
                    <Button variant="secondary" size="sm" onClick={swap} disabled={!swappable} aria-label="Swap A and B">
                      <FontAwesomeIcon icon={faArrowRightArrowLeft} />
                    </Button>
                  </TooltipTarget>
                </>
              )}
            </div>
          )}

          {elsewhere && (
            <div>
              <Button variant="secondary" size="sm" onClick={retarget}>
                Show takes for the paragraph at the playhead
              </Button>
            </div>
          )}

          {!passage && !here && (
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              Play or click a word to see the takes of its paragraph.
            </p>
          )}
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
          {takes && !takes.message && candidates.length === 0 && (
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              This paragraph has only one take, and no retake or repeated read was found for it. Record another, or run Find pickups and duplicates.
            </p>
          )}

          {candidates.length > 0 && (
            <ol aria-label="Takes of this passage" className="flex flex-col gap-2">
              {candidates.map((candidate) => {
                const slot = slotOf(candidate.id);
                const playing = slot !== undefined && playerOf(slot).isPlaying;
                const member = memberOf(candidate);
                const blocked = !candidate.usable ? candidate.reason : reaperBlocked;
                const name = candidate.label.toLowerCase();
                return (
                  <InsetCard as="li" key={candidate.id} tone={playing ? 'accent' : 'neutral'}>
                    <div className="flex items-start gap-2">
                      <TooltipTarget
                        text={
                          candidate.usable
                            ? `${playing ? 'Pause' : 'Play'} ${candidate.label} from its own recording, without REAPER`
                            : (candidate.reason ?? 'This take cannot be heard.')
                        }
                      >
                        <IconButton
                          label={`${playing ? 'Pause' : 'Play'} ${name}`}
                          variant={playing ? 'primary' : 'default'}
                          disabledReason={candidate.usable ? undefined : (candidate.reason ?? 'This take cannot be heard.')}
                          onClick={() => togglePlay(candidate)}
                        >
                          <FontAwesomeIcon icon={playing ? faPause : faPlay} />
                        </IconButton>
                      </TooltipTarget>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          {mode === 'ab' && slot && (
                            <span
                              aria-label={`Slot ${slot.toUpperCase()}`}
                              className="inline-flex size-5 items-center justify-center rounded-[0.25rem] bg-[var(--surface-3)] text-xs leading-none font-bold"
                            >
                              {slot.toUpperCase()}
                            </span>
                          )}
                          <span className="font-semibold">{candidate.label}</span>
                          {candidate.active && <StatusBadge tone="success" label="Plays now" />}
                        </div>
                      </div>
                      {!candidate.active && (
                        <TooltipTarget
                          text={
                            blocked ??
                            (candidate.confirm
                              ? 'Add this read as a new take on the item and make it active, after you confirm'
                              : candidate.action === 'pick_lane'
                                ? 'Make this retake the lane that plays, in one undo step'
                                : 'Make this the item’s active take, in one undo step')
                          }
                        >
                          <Button
                            variant="secondary"
                            size="sm"
                            aria-label={`Use ${name}${candidate.source === 'item_take' ? '' : ` (${SOURCE_LABEL[candidate.source].toLowerCase()})`}`}
                            onClick={() => (candidate.confirm ? setConfirming(candidate) : void use(candidate))}
                            disabled={Boolean(blocked) || action.isBusy}
                            pending={action.isPending(`use-${candidate.id}`)}
                          >
                            Use this take
                          </Button>
                        </TooltipTarget>
                      )}
                    </div>
                    <div
                      className="mt-1 pl-10 text-xs [overflow-wrap:anywhere]"
                      style={{ color: 'var(--text-muted)' }}
                      title={`${SOURCE_LABEL[candidate.source]} · ${candidate.detail}`}
                    >
                      {metaOf(candidate)}
                    </div>
                    {evidence && member?.compared ? (
                      <>
                        <WordWindow evidence={evidence} member={member} />
                        <p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>
                          {evidenceLine(member)}
                        </p>
                      </>
                    ) : (
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                          {candidate.notComparedReason ?? 'Not compared yet: comparing transcribes it (about 20 s).'}
                        </p>
                        {candidate.usable && !candidate.notComparedReason && (
                          <Button variant="secondary" size="sm" onClick={() => setComparing(true)} disabled={usable.length < 2}>
                            Compare
                          </Button>
                        )}
                      </div>
                    )}
                    {!candidate.usable && candidate.reason && (
                      <p className="mt-1 text-xs" style={{ color: 'var(--danger-text)' }}>
                        {candidate.reason}
                      </p>
                    )}
                  </InsetCard>
                );
              })}
            </ol>
          )}

          {candidates.length > 0 && reaperBlocked && reaper !== undefined && (
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              Use this take needs REAPER. {reaperBlocked}
            </p>
          )}
          {(playerA.loadError || playerB.loadError) && (
            <p role="alert" className="text-sm" style={{ color: 'var(--danger-text)' }}>
              A take’s audio couldn’t be played. Check that its source file is still where the project expects it.
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
          {candidates.length > 0 && (
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Raw recordings, no FX or edits applied: REAPER’s processing chain is not heard here.
            </p>
          )}
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
      {comparison &&
        evidence &&
        detailTarget &&
        createPortal(<TakeComparisonView finding={comparison} evidence={evidence} status={reaper} onStatusChange={onReaperStatusChange} />, detailTarget)}
    </>
  );
}
