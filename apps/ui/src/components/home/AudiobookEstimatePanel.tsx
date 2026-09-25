import { describeApiError } from '../../api/errorMessage';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faChevronDown, faChevronUp, faTriangleExclamation } from '@fortawesome/free-solid-svg-icons';
import type { ChapterStatus, ChapterTrackLinks, CoverageState, ManuscriptChapter, RecordedUnavailable } from '../../types';
import type { ManuscriptContentKind } from '../../api/contracts/manuscript';
import { estimateFinishedHours } from '../../state';
import { chapterName } from '../../chapterName';
import { TitleSubtitle } from '../primitives/TitleSubtitle';
import { ChapterTrackButton } from './ChapterTrackButton';
import { ChapterTrackPanel } from './ChapterTrackPanel';
import { RemovedFromRecordingList } from './RemovedFromRecordingList';
import { useCreditsSeconds } from './useCreditsSeconds';
import { useCreditsRows, type CreditsKind } from './useCreditsRows';
import { useApi } from '../../api/ApiContext';
import { useChapterSync } from '../../hooks/useChapterSync';
import { chapterSyncBatchToastText } from './chapterSyncToastText';
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from '../primitives/Collapsible';
import { MeterBar } from '../primitives/MeterBar';
import { Panel } from '../primitives/Panel';
import { Select } from '../primitives/Select';
import { STATUS_COLOR, STATUS_LABELS, STATUS_ORDER } from '../../chapterStatus';
import { Tooltip, TooltipTarget } from '../primitives/Tooltip';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../primitives/Table';
import type { Notify } from '../primitives/Toast';
import { Button } from '../primitives/Button';
import { RecordingCheck } from './RecordingCheck';
import { useStageRecommendations } from '../stages/useStageRecommendations';
import { StageSuggestion } from '../stages/StageSuggestion';
import { StageEvidence } from '../stages/StageEvidence';
import { StageCheckLine, StageSummaryChips } from '../stages/StageSummary';

const fmtHours = (hours: number) => {
  const whole = Math.floor(hours);
  const minutes = Math.round((hours - whole) * 60);
  return whole > 0 ? `${whole}h ${minutes}m` : `${minutes}m`;
};

// Credits (audiobook-credits-templates.prd.md, Phase 2, Open Question C9): unlike the narration stats above, credits
// are typically well under a minute, and fmtHours alone rounds anything under 30s down to "0m" - a narrator would
// read that as "no credits time" rather than "eighteen seconds". Show seconds below a minute; fall back to fmtHours'
// hour/minute format once a template runs a minute or longer.
const fmtCreditsSeconds = (seconds: number) => (seconds < 60 ? `${Math.round(seconds)}s` : fmtHours(seconds / 3600));

// Actual recorded (actual-recorded-column.prd.md Phase 3, AR2): a chapter just started can have a few seconds on its
// track, which fmtHours alone would round down to "0m" - show seconds under a minute, same convention as fmtCreditsSeconds.
const fmtRecordedTime = (seconds: number) => (seconds < 60 ? `${Math.round(seconds)}s` : fmtHours(seconds / 3600));

// Why a chapter has no Actual recorded time, named for the dash's tooltip and accessible name (AR3). The mockup's wording
// for `track_missing` ("Linked track is not in the saved project", 02-dash-reason-tooltip.webp) is the spec; the others
// match its noun-phrase style.
const RECORDED_UNAVAILABLE_REASON: Record<RecordedUnavailable, string> = {
  unlinked: 'No REAPER track linked',
  multiple_tracks: 'Linked to more than one REAPER track',
  track_missing: 'Linked track is not in the saved project',
  no_project: 'No REAPER project is open',
};

// Credits rows (credits-in-chapter-table.prd.md Phase 2): Opening credits first, Closing credits last (CT6), not
// manuscript chapters, so they are never in narrationChapters and never touch stages, coverage or manuscriptSetChapterStatus.
const CREDITS_LABEL: Record<CreditsKind, string> = { opening: 'Opening credits', closing: 'Closing credits' };
const CREDITS_CHECK_DISABLED_REASON = 'The recording check reads manuscript chapters; credits are not checked yet';

// A single unresolved token reads as its own name (matching the mockup, 04-unresolved-token-warning.webp); several
// fall back to the count-and-list wording CreditsEntry/CreditsPanel already use elsewhere.
const unresolvedWarning = (unresolved: string[]): string | undefined => {
  if (unresolved.length === 0) return undefined;
  if (unresolved.length === 1) return `${unresolved[0]} not filled in`;
  return `${unresolved.length} tokens not filled in: ${unresolved.join(', ')}`;
};

export type StatusTotal = { count: number; hours: number; words: number };

// Keep the progress bar's domain model independent from its rendering.  This
// prevents a row-level status change from creating duplicate visual segments.
export function rollupChapterStatuses(chapters: ManuscriptChapter[]): Record<ChapterStatus, StatusTotal> {
  const empty = Object.fromEntries(STATUS_ORDER.map((status) => [status, { count: 0, hours: 0, words: 0 }])) as Record<ChapterStatus, StatusTotal>;
  return chapters.reduce((totals, chapter) => {
    const total = totals[chapter.status];
    total.count += 1;
    total.words += chapter.wordCount;
    total.hours += estimateFinishedHours(chapter.wordCount);
    return totals;
  }, empty);
}

export function AudiobookEstimatePanel({
  notify,
  goToManuscript,
  refreshKey,
}: {
  notify: Notify;
  /** Opens the manuscript at a chapter, or at a paragraph (its index in the whole manuscript) when one is given. */
  goToManuscript: (chapter: string, paragraph?: number) => void;
  // The owning Home page changes this after a manuscript import/replacement.
  // Chapter estimates are derived from a separate request, so they cannot
  // rely on the Bootstrap payload alone to invalidate their cached rows.
  refreshKey?: string;
}) {
  const api = useApi();
  const [chapters, setChapters] = useState<ManuscriptChapter[]>();
  const [breakdownOpen, setBreakdownOpen] = useState(false);
  // Credits stat (Phases 2 and 5): undefined while loading or on failure, in which case the row is simply left out.
  const creditsSeconds = useCreditsSeconds(api, refreshKey);
  // Credits table rows (credits-in-chapter-table.prd.md Phase 2): Opening credits first, Closing credits last.
  const { rows: creditsRows, setStatus: setCreditsStatus } = useCreditsRows(api, refreshKey, (error) => notify(describeApiError(error), 'error'));
  // Recording coverage (docs/utilities/recording-coverage.md, ADR 0130): the live state of the one check the host runs at a time, so a row
  // shows its percent even after its dialog was sent to the background, and the chapter whose check dialog is open.
  const [coverage, setCoverage] = useState<CoverageState>({ phase: 'idle', percent: 0, message: '' });
  const [checking, setChecking] = useState<ManuscriptChapter>();
  // A check that completes changes the chapter's measured recordedFraction, so the list is read again, once per run.
  const [measuredRun, setMeasuredRun] = useState<string>();
  const lastCompleted = useRef<string>(undefined);

  // Stage suggestions (chapter-stage-recommendations.prd.md Phase 5), read again after an import and after a recording check ends. `why`
  // is the chapter whose evidence view is open; it is kept while the view slides shut, so the content does not vanish mid-animation.
  const stages = useStageRecommendations({
    refreshKey: `${refreshKey ?? ''}:${measuredRun ?? ''}`,
    notify,
    onStatus: (chapterId, status) => setChapters((current) => current?.map((c) => (c.id === chapterId ? { ...c, status } : c))),
  });
  const [why, setWhy] = useState<{ chapterId: string; open: boolean }>();

  // Chapter track links (chapter-track-link-control.prd.md Phase 2): one read of every narration chapter's link
  // state and track facts from a single .rpp parse (Phase 1's ChapterTrackLinks), so twenty rows never each parse the
  // saved project on their own. `trackChapter` is the row whose ChapterTrackPanel is open; kept while the panel
  // slides shut so its content does not vanish mid-animation, matching `why` above.
  const [trackLinks, setTrackLinks] = useState<ChapterTrackLinks>();
  const [trackChapter, setTrackChapter] = useState<{ chapterId: string; open: boolean }>();
  const loadTrackLinks = useCallback(async () => {
    try {
      setTrackLinks(await api.chapterTrackLinks());
    } catch (error) {
      notify(describeApiError(error), 'error');
    }
  }, [api, notify]);

  useEffect(() => api.subscribeCoverage(setCoverage), [api]);

  useEffect(() => {
    void loadTrackLinks();
  }, [loadTrackLinks, refreshKey, measuredRun]);

  // Chapter sync (daw-chapter-track-auto-sync.prd.md Phase 3, S12): one toast per batch that linked something, never
  // for `newTracks` (listed quietly elsewhere, not built yet). `lastBatchAt` guards against re-toasting the same
  // batch on a re-render, since the subscription and the state it carries both outlive any one render.
  const chapterSync = useChapterSync(api);
  const lastBatchAt = useRef<string>(undefined);
  useEffect(() => {
    const batch = chapterSync?.batch;
    if (!batch || batch.linked.length === 0 || lastBatchAt.current === batch.at) return;
    lastBatchAt.current = batch.at;
    const trackName = (guid: string) => trackLinks?.tracks.find((track) => track.guid === guid)?.name;
    notify(chapterSyncBatchToastText(batch, trackName), 'info', {
      label: 'Undo',
      onAction: () => {
        void Promise.all(batch.linked.map((link) => api.chapterSyncUndo(link.trackGuid))).catch((error) => notify(describeApiError(error), 'error'));
      },
    });
    void loadTrackLinks();
  }, [chapterSync?.batch, trackLinks, api, notify, loadTrackLinks]);

  useEffect(() => {
    if (coverage.phase !== 'complete' || !coverage.runId || lastCompleted.current === coverage.runId) return;
    lastCompleted.current = coverage.runId;
    setMeasuredRun(coverage.runId);
  }, [coverage.phase, coverage.runId]);

  const loadChapters = useCallback(async () => {
    try {
      setChapters(await api.manuscriptChapters());
    } catch (error) {
      // Say why the estimate is empty: an empty table alone reads as a manuscript with no chapters.
      setChapters([]);
      notify(describeApiError(error), 'error');
    }
  }, [api, notify]);

  useEffect(() => {
    void loadChapters();
  }, [loadChapters, refreshKey, measuredRun]);

  // Remove from recording / Restore (chapter-track-link-control.prd.md Phase 3): both re-read the chapter list (the
  // row leaves or rejoins the table) and ChapterTrackLinks (a removal clears the chapter's link). Remove rethrows on
  // failure so the slide-over's confirm dialog knows to stay open for a retry, matching every other action there.
  const [restoringId, setRestoringId] = useState('');
  const removeFromRecording = async (chapterId: string, kind: ManuscriptContentKind) => {
    try {
      const result = await api.manuscriptSetChapterKind(chapterId, kind);
      notify(`${result.chapter.title} removed from recording.`);
      await loadChapters();
      await loadTrackLinks();
    } catch (error) {
      notify(describeApiError(error), 'error');
      throw error;
    }
  };
  const restore = async (chapterId: string) => {
    setRestoringId(chapterId);
    try {
      const result = await api.manuscriptSetChapterKind(chapterId, 'narration');
      notify(`${result.chapter.title} restored.`);
      await loadChapters();
      await loadTrackLinks();
    } catch (error) {
      notify(describeApiError(error), 'error');
    } finally {
      setRestoringId('');
    }
  };

  const creditsTableRow = (kind: CreditsKind) => {
    const row = creditsRows![kind];
    const label = CREDITS_LABEL[kind];
    if (!row.template) {
      return (
        <TableRow key={`credits-${kind}`}>
          <TableCell>
            <div className="font-medium">{label}</div>
            <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Not set up ·{' '}
              <Link className="hover:underline" to="/settings#credits">
                Add {kind === 'opening' ? 'an opening' : 'a closing'} template in Settings › Credits
              </Link>
            </div>
          </TableCell>
          {trackLinks?.project === 'ready' && <TableCell />}
          <TableCell align="right" className="font-['IBM_Plex_Mono',ui-monospace,monospace]">
            —
          </TableCell>
          <TableCell align="right" className="font-['IBM_Plex_Mono',ui-monospace,monospace]">
            —
          </TableCell>
          <TableCell align="right" className="font-['IBM_Plex_Mono',ui-monospace,monospace]">
            —
          </TableCell>
          <TableCell />
          <TableCell />
        </TableRow>
      );
    }
    const warning = unresolvedWarning(row.unresolved);
    return (
      <TableRow key={`credits-${kind}`}>
        <TableCell>
          <div>
            <Link className="font-medium hover:underline" to={`/manuscript#credits-${kind}`}>
              {label}
            </Link>
          </div>
          <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
            <span>{row.template.name}</span>
            {warning && (
              <>
                {' · '}
                <FontAwesomeIcon icon={faTriangleExclamation} aria-hidden="true" style={{ color: 'var(--danger-text)' }} /> <span>{warning}</span>
              </>
            )}
          </div>
        </TableCell>
        {trackLinks?.project === 'ready' && <TableCell />}
        <TableCell align="right" className="font-['IBM_Plex_Mono',ui-monospace,monospace]">
          {(row.words ?? 0).toLocaleString()}
        </TableCell>
        <TableCell align="right" className="font-['IBM_Plex_Mono',ui-monospace,monospace]">
          {fmtCreditsSeconds(row.estimatedSeconds ?? 0)}
        </TableCell>
        <TableCell align="right" className="font-['IBM_Plex_Mono',ui-monospace,monospace]">
          —
        </TableCell>
        <TableCell>
          <Select
            label={`${label} status`}
            value={row.status}
            options={STATUS_ORDER.map((status) => ({ value: status, label: STATUS_LABELS[status] }))}
            onChange={(value) => void setCreditsStatus(kind, value as ChapterStatus)}
          />
        </TableCell>
        <TableCell align="right">
          <TooltipTarget text={CREDITS_CHECK_DISABLED_REASON}>
            <Button variant="ghost" className="px-3 py-1 whitespace-nowrap" disabled aria-label={`Check recording of ${label}`}>
              Check
            </Button>
          </TooltipTarget>
        </TableCell>
      </TableRow>
    );
  };

  if (!chapters) return null;
  const narrationChapters = chapters.filter((chapter) => (chapter.contentKind ?? 'narration') === 'narration');
  if (narrationChapters.length === 0)
    return <Panel>No narratable manuscript chapters found yet. Select a manuscript from Home to see an audiobook estimate.</Panel>;

  const totalWords = narrationChapters.reduce((sum, c) => sum + c.wordCount, 0);
  const finishedHours = estimateFinishedHours(totalWords);
  // Actual recorded (actual-recorded-column.prd.md Phase 3, AR1): summed only from chapters with a linked track's
  // recorded seconds - never a status or word-share guess, so it drops when nothing is linked yet.
  const recordedChapters = narrationChapters.filter((c) => c.recordedSeconds !== undefined);
  const recordedSecondsTotal = recordedChapters.reduce((sum, c) => sum + (c.recordedSeconds ?? 0), 0);
  const recordedTooltip = `From ${recordedChapters.length} of ${narrationChapters.length} chapters with a linked track, as of the saved REAPER project. Nothing here is estimated.`;
  const stats = [
    { label: 'Est. finished audio', value: fmtHours(finishedHours) },
    { label: 'Actual recorded', value: recordedChapters.length > 0 ? fmtRecordedTime(recordedSecondsTotal) : '—', tooltip: recordedTooltip },
    { label: 'Est. record time', value: fmtHours(finishedHours * 3) },
    { label: 'Est. edit time', value: fmtHours(finishedHours * 2) },
    { label: 'Est. proof time', value: fmtHours(finishedHours * 1) },
    // Credits time is separate from the narration total above (never folded into finishedHours/narratableWordCount,
    // Phase 2 Success Metric "the narration total is unchanged") and only shown once it is known.
    ...(creditsSeconds !== undefined ? [{ label: 'Credits', value: fmtCreditsSeconds(creditsSeconds) }] : []),
  ];
  const finalizedCount = narrationChapters.filter((c) => c.status === 'finalized').length;
  const statusTotals = rollupChapterStatuses(narrationChapters);

  return (
    <Collapsible
      open={breakdownOpen}
      onOpenChange={setBreakdownOpen}
      className="rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow)]"
    >
      <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-[1.1rem] py-[0.85rem]">
        <div>
          <h2 className="text-sm font-semibold">Audiobook estimate</h2>
          <div className="mt-0.5 flex items-center text-xs" style={{ color: 'var(--text-muted)' }}>
            {totalWords.toLocaleString()} words · {narrationChapters.length} chapters · ~155 words/min narrated{' '}
            <Tooltip text="Fixed industry rule of thumb (~9,300 words per finished hour). Record, edit, and proof use standard multipliers of that finished length." />
          </div>
          <StageSummaryChips state={stages.state} onShow={() => setBreakdownOpen(true)} />
        </div>
        <TooltipTarget text={breakdownOpen ? 'Hide per-chapter breakdown' : 'Show per-chapter breakdown'}>
          <CollapsibleTrigger label={breakdownOpen ? 'Hide per-chapter breakdown' : 'Show per-chapter breakdown'}>
            <FontAwesomeIcon icon={breakdownOpen ? faChevronUp : faChevronDown} />
          </CollapsibleTrigger>
        </TooltipTarget>
      </div>
      <div className="space-y-4 p-[1.1rem]">
        <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${stats.length}, minmax(0, 1fr))` }}>
          {stats.map((stat) => (
            <div key={stat.label}>
              <div className="flex items-center font-['Barlow_Condensed',sans-serif] text-[0.72rem] font-semibold tracking-[0.08em] text-[var(--text-muted)] uppercase">
                {stat.label}
                {stat.tooltip && <Tooltip text={stat.tooltip} label={`About ${stat.label}`} />}
              </div>
              <div className="mt-1 font-['IBM_Plex_Mono',ui-monospace,monospace] text-2xl font-semibold">{stat.value}</div>
            </div>
          ))}
        </div>
        <div>
          <div className="mb-1.5 flex justify-between text-xs">
            <span className="font-['Barlow_Condensed',sans-serif] text-[0.72rem] font-semibold tracking-[0.08em] text-[var(--text-muted)] uppercase">
              Recording progress
            </span>
            <span className="font-['IBM_Plex_Mono',ui-monospace,monospace]" style={{ color: 'var(--text-muted)' }}>
              {finalizedCount} of {narrationChapters.length} chapters finalized
              {creditsRows && ` · credits ${[creditsRows.opening, creditsRows.closing].filter((row) => row.status === 'finalized').length} of 2`}
            </span>
          </div>
          <MeterBar
            label="Recording progress"
            segments={[...STATUS_ORDER]
              .reverse()
              .filter((status) => statusTotals[status].count > 0)
              .map((status) => ({
                key: status,
                widthPercent: (statusTotals[status].words / totalWords) * 100,
                color: STATUS_COLOR[status],
                tooltip: `${STATUS_LABELS[status]}: ${statusTotals[status].count} chapter${statusTotals[status].count === 1 ? '' : 's'} · ~${fmtHours(statusTotals[status].hours)} finished audio`,
              }))}
          />
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs" style={{ color: 'var(--text-muted)' }}>
            {STATUS_ORDER.map((status) => (
              <span key={status} className="flex items-center gap-1.5">
                <span className="size-2 flex-none rounded-full" style={{ background: STATUS_COLOR[status] }} />
                {STATUS_LABELS[status]}
              </span>
            ))}
          </div>
        </div>
        <CollapsiblePanel className="overflow-x-auto border-t border-[var(--border)] pt-1">
          <StageCheckLine state={stages.state} onCheckNow={() => void stages.refresh()} />
          {trackLinks && trackLinks.project !== 'ready' && (
            <p className="px-[1.1rem] py-1.5 text-sm" style={{ color: 'var(--text-muted)' }}>
              {trackLinks.message}
              {trackLinks.project === 'choose' && (
                <>
                  {' '}
                  <Link className="font-semibold underline" to="/tracks">
                    Choose it on Tracks
                  </Link>
                  {' to see chapter tracks.'}
                </>
              )}
            </p>
          )}
          <Table label="Chapters">
            <TableHead>
              <TableRow>
                <TableHeader>Chapter</TableHeader>
                {trackLinks?.project === 'ready' && <TableHeader>Track</TableHeader>}
                <TableHeader align="right">Words</TableHeader>
                <TableHeader align="right">Est. finished length</TableHeader>
                <TableHeader
                  align="right"
                  info="The audio on the chapter’s linked REAPER track: its unmuted items, overlaps counted once, as of the saved project. A dash means no track is linked."
                >
                  Actual recorded
                </TableHeader>
                <TableHeader>Status</TableHeader>
                <TableHeader hiddenLabel="Recording check" />
              </TableRow>
            </TableHead>
            <TableBody>
              {creditsRows && creditsTableRow('opening')}
              {narrationChapters.map((chapter) => {
                const finished = estimateFinishedHours(chapter.wordCount);
                const running = coverage.phase === 'running' && coverage.chapterId === chapter.id;
                return (
                  <TableRow key={chapter.id}>
                    <TableCell>
                      <div>
                        <Link
                          className="hover:underline"
                          to={`/manuscript#c${encodeURIComponent(chapter.id)}`}
                          aria-label={chapterName(chapter)}
                          onClick={(event) => {
                            if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                            event.preventDefault();
                            goToManuscript(chapter.id);
                          }}
                        >
                          <TitleSubtitle title={chapter.title} subtitle={chapter.subtitle} />
                        </Link>
                      </div>
                    </TableCell>
                    {trackLinks?.project === 'ready' && (
                      <TableCell>
                        {(() => {
                          const link = trackLinks.chapters.find((entry) => entry.chapterId === chapter.id);
                          if (!link) return null;
                          const trackGuid = link.track?.trackGuid;
                          const trackSummary = trackGuid ? trackLinks.tracks.find((track) => track.guid === trackGuid) : undefined;
                          return (
                            <ChapterTrackButton
                              chapterTitle={chapter.title}
                              link={link}
                              trackColor={trackSummary?.color}
                              onClick={() => setTrackChapter({ chapterId: chapter.id, open: true })}
                            />
                          );
                        })()}
                      </TableCell>
                    )}
                    <TableCell align="right" className="font-['IBM_Plex_Mono',ui-monospace,monospace]">
                      {chapter.wordCount.toLocaleString()}
                    </TableCell>
                    <TableCell align="right" className="font-['IBM_Plex_Mono',ui-monospace,monospace]">
                      {fmtHours(finished)}
                    </TableCell>
                    <TableCell align="right" className="font-['IBM_Plex_Mono',ui-monospace,monospace]">
                      {chapter.recordedSeconds !== undefined ? (
                        fmtRecordedTime(chapter.recordedSeconds)
                      ) : (
                        <TooltipTarget text={RECORDED_UNAVAILABLE_REASON[chapter.recordedUnavailable ?? 'unlinked']}>
                          <span aria-label={RECORDED_UNAVAILABLE_REASON[chapter.recordedUnavailable ?? 'unlinked']}>—</span>
                        </TooltipTarget>
                      )}
                    </TableCell>
                    <TableCell>
                      <Select
                        label={`${chapter.title} status`}
                        value={chapter.status}
                        options={STATUS_ORDER.map((status) => ({ value: status, label: STATUS_LABELS[status] }))}
                        onChange={async (value) => {
                          try {
                            const updated = await api.manuscriptSetChapterStatus(chapter.id, value as ChapterStatus);
                            setChapters((current) =>
                              current?.map((c) =>
                                c.id === chapter.id
                                  ? {
                                      ...c,
                                      ...updated,
                                      wordCount: c.wordCount,
                                      subtitle: c.subtitle,
                                      recordedFraction: c.recordedFraction,
                                      // A status update doesn't re-read the linked track (actual-recorded-column.prd.md Phase 1,
                                      // "status is inert"): keep the row's own recorded time and reason.
                                      recordedSeconds: c.recordedSeconds,
                                      recordedUnavailable: c.recordedUnavailable,
                                    }
                                  : c,
                              ),
                            );
                            // A status changed by hand retires a confirmation and changes which stage is evaluated.
                            void stages.refresh();
                          } catch (error) {
                            notify(describeApiError(error), 'error');
                          }
                        }}
                      />
                      <StageSuggestion
                        title={chapter.title}
                        recommendation={stages.state.byChapter.get(chapter.id)}
                        phase={stages.state.phase}
                        isPending={(decision) => stages.isPending(decision, chapter.id)}
                        busy={stages.busy}
                        onDecide={(decision) => {
                          const recommendation = stages.state.byChapter.get(chapter.id);
                          if (recommendation) void stages.decide(decision, recommendation);
                        }}
                        onWhy={() => setWhy({ chapterId: chapter.id, open: true })}
                      />
                    </TableCell>
                    <TableCell align="right">
                      <Button
                        variant="ghost"
                        className="px-3 py-1 whitespace-nowrap"
                        // The visible words start the name (label in name), and the chapter tells twelve Check buttons apart.
                        aria-label={
                          running ? `Checking ${Math.floor(coverage.percent)}%, recording of ${chapter.title}` : `Check recording of ${chapter.title}`
                        }
                        onClick={() => setChecking(chapter)}
                      >
                        {running ? `Checking ${Math.floor(coverage.percent)}%` : 'Check'}
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
              {creditsRows && creditsTableRow('closing')}
            </TableBody>
          </Table>
          <RemovedFromRecordingList chapters={chapters} restoringId={restoringId} onRestore={(chapterId) => void restore(chapterId)} />
        </CollapsiblePanel>
      </div>
      {checking && (
        <RecordingCheck
          key={checking.id}
          chapter={checking}
          coverage={coverage}
          notify={notify}
          close={() => {
            setChecking(undefined);
            // Linking a track in the dialog changes the evidence without a finished check, so the suggestions are read again.
            void stages.refresh();
          }}
          goToParagraph={(paragraph) => goToManuscript(checking.id, paragraph)}
        />
      )}
      {why && (
        <StageEvidence
          open={why.open}
          chapter={narrationChapters.find((chapter) => chapter.id === why.chapterId)}
          recommendation={stages.state.byChapter.get(why.chapterId)}
          phase={stages.state.phase}
          error={stages.state.error}
          isPending={(decision) => stages.isPending(decision, why.chapterId)}
          busy={stages.busy}
          onDecide={(decision) => {
            const recommendation = stages.state.byChapter.get(why.chapterId);
            if (recommendation) void stages.decide(decision, recommendation);
          }}
          onClose={() => setWhy({ ...why, open: false })}
          onCheckNow={() => void stages.refresh()}
          onOpenCheck={() => {
            const chapter = narrationChapters.find((item) => item.id === why.chapterId);
            setWhy({ ...why, open: false });
            if (chapter) setChecking(chapter);
          }}
          goToParagraph={(paragraph) => goToManuscript(why.chapterId, paragraph)}
        />
      )}
      {trackChapter &&
        (() => {
          const chapter = narrationChapters.find((item) => item.id === trackChapter.chapterId);
          const link = trackLinks?.chapters.find((entry) => entry.chapterId === trackChapter.chapterId);
          const trackGuid = link?.track?.trackGuid;
          const trackSummary = trackGuid ? trackLinks?.tracks.find((track) => track.guid === trackGuid) : undefined;
          return (
            <ChapterTrackPanel
              open={trackChapter.open}
              chapterId={trackChapter.chapterId}
              chapterTitle={chapter?.title ?? ''}
              link={link}
              trackSummary={trackSummary}
              savedAt={trackLinks?.savedAt ?? ''}
              notify={notify}
              onClose={() => setTrackChapter({ ...trackChapter, open: false })}
              onChanged={loadTrackLinks}
              onRemoveFromRecording={(kind) => removeFromRecording(trackChapter.chapterId, kind)}
            />
          );
        })()}
    </Collapsible>
  );
}
