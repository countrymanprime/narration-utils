import { faLayerGroup } from '@fortawesome/free-solid-svg-icons';
import { describeApiError } from '../../api/errorMessage';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ChapterStatus, ChapterTrackLinks, CoverageState, ManuscriptChapter } from '../../types';
import type { ManuscriptContentKind } from '../../api/contracts/manuscript';
import type { ProductionChapter, ProductionOverview } from '../../api/contracts/production';
import { chapterName } from '../../chapterName';
import { STATUS_LABELS, STATUS_ORDER } from '../../chapterStatus';
import { useApi } from '../../api/ApiContext';
import { useChapterSync } from '../../hooks/useChapterSync';
import { Button } from '../primitives/Button';
import { Panel } from '../primitives/Panel';
import { Select } from '../primitives/Select';
import { StageGrid, type StageGridCell } from '../primitives/StageGrid';
import type { Notify } from '../primitives/Toast';
import { EditingCheckPanel } from '../editing/EditingCheckPanel';
import { useStageRecommendations } from '../stages/useStageRecommendations';
import { useRefreshOnFocus } from '../stages/useRefreshOnFocus';
import { StageEvidence } from '../stages/StageEvidence';
import { StageCheckLine, StageSummaryChips } from '../stages/StageSummary';
import { chapterCheckStatus, chapterCheckStatusText } from './chapterCheckStatus';
import { chapterSyncBatchToastText } from './chapterSyncToastText';
import { ChapterTrackPanel } from './ChapterTrackPanel';
import { CreditsRowPanel } from './CreditsRowPanel';
import { RecordingCheck } from './RecordingCheck';
import { creditsCheckChapter, creditsCheckKind } from './recordingCheckText';
import { RemovedFromRecordingList } from './RemovedFromRecordingList';
import { useCreditsRows, type CreditsKind } from './useCreditsRows';
import { BOARD_COLUMNS, boardCell, creditsCell, isCurrentStage } from './productionFormat';

const MUTED = { color: 'var(--text-muted)' };

const CREDITS_LABEL: Record<CreditsKind, string> = { opening: 'Opening credits', closing: 'Closing credits' };

type Row = { kind: 'chapter'; chapter: ProductionChapter } | { kind: 'credits'; credits: CreditsKind };

const isNarration = (chapter: { contentKind?: string }) => !chapter.contentKind || chapter.contentKind === 'narration';

/**
 * The Production home's chapter pipeline (stage-navigation-and-page-replacement.prd.md Phase 2, mock 01: "every cell opens that
 * stage for the chapter"). It replaces Home's chapter table: the rows are the book's narration chapters between its opening and
 * closing credits, the columns the board's stages, and each cell opens the surface Home's row opened, with the same slide-overs:
 *
 * - Recorded opens the chapter's track slide-over (chapter-track-link-control.prd.md), where the length comes from.
 * - The chapter's current stage (Record for a chapter not started yet) opens its stage suggestion, with the status override Home's
 *   row carried and the way into the recording and editing checks (chapter-stage-recommendations.prd.md).
 * - Record opens the recording check, Edit the editing check, Proof the chapter's Proof view, and Prep the chapter on Script.
 * - A credits row opens its own slide-over (credits-in-chapter-table.prd.md), since credits are not assessed by the stage engine.
 *
 * The figures come from the production overview the page already read (`overview`, read again through `onChanged` after anything
 * here changes a status, a link or a measurement); the slide-overs read the manuscript's own chapter list, as Home's did.
 */
export function ChapterBoard({
  overview,
  notify,
  goToScript,
  goToProofChapter,
  refreshKey,
  onChanged,
}: {
  overview: ProductionOverview;
  notify: Notify;
  /** Opens the manuscript at a chapter, or at a paragraph (its index in the whole manuscript) when one is given. */
  goToScript: (chapter: string, paragraph?: number) => void;
  /** Opens a chapter's Proof view (stage-navigation-and-page-replacement.prd.md Phase 5). */
  goToProofChapter: (chapterId: string) => void;
  /** Changes after a manuscript import or replacement, so the chapter list is read again. */
  refreshKey?: string;
  /** Reads the production overview again. */
  onChanged: () => void;
}) {
  const api = useApi();
  const [chapters, setChapters] = useState<ManuscriptChapter[]>();
  const { rows: creditsRows, setStatus: setCreditsStatus } = useCreditsRows(api, refreshKey, (error) => notify(describeApiError(error), 'error'));
  // Recording coverage (docs/utilities/recording-coverage.md, ADR 0130): the one check the host runs at a time, so the Record cell
  // shows its percent even after its slide-over was sent to the background.
  const [coverage, setCoverage] = useState<CoverageState>({ phase: 'idle', percent: 0, message: '' });
  const [checking, setChecking] = useState<ManuscriptChapter>();
  const [editingChecking, setEditingChecking] = useState<ManuscriptChapter>();
  const [credits, setCredits] = useState<{ kind: CreditsKind; open: boolean }>();
  // A check that completes changes the chapter's measured length, so the list is read again, once per run.
  const [measuredRun, setMeasuredRun] = useState<string>();
  const lastCompleted = useRef<string>(undefined);

  const stages = useStageRecommendations({
    refreshKey: `${refreshKey ?? ''}:${measuredRun ?? ''}`,
    notify,
    onStatus: (chapterId, status) => {
      setChapters((current) => current?.map((c) => (c.id === chapterId ? { ...c, status } : c)));
      onChanged();
    },
  });
  // The chapter whose stage suggestion is open; kept while the view slides shut, so its content does not vanish mid-animation.
  const [why, setWhy] = useState<{ chapterId: string; open: boolean }>();

  // Chapter track links (chapter-track-link-control.prd.md Phase 2): one read of every chapter's link from a single .rpp parse.
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

  // Chapter sync (daw-chapter-track-auto-sync.prd.md Phase 3, S12): one toast per batch that linked something. `lastBatchAt` guards
  // against re-toasting the same batch on a re-render.
  const chapterSync = useChapterSync(api);
  const lastBatchAt = useRef<string>(undefined);
  useEffect(() => {
    const batch = chapterSync?.batch;
    if (!batch || batch.linked.length === 0 || lastBatchAt.current === batch.at) return;
    lastBatchAt.current = batch.at;
    const trackName = (guid: string) => trackLinks?.tracks.find((track) => track.guid === guid)?.name;
    notify(
      chapterSyncBatchToastText(batch, trackName),
      'info',
      {
        label: 'Undo',
        onAction: () => {
          void Promise.all(batch.linked.map((link) => api.chapterSyncUndo(link.trackGuid))).catch((error) => notify(describeApiError(error), 'error'));
        },
      },
      faLayerGroup,
    );
    void loadTrackLinks();
  }, [chapterSync?.batch, trackLinks, api, notify, loadTrackLinks]);

  useEffect(() => {
    if (coverage.phase !== 'complete' || !coverage.runId || lastCompleted.current === coverage.runId) return;
    lastCompleted.current = coverage.runId;
    setMeasuredRun(coverage.runId);
    onChanged();
  }, [coverage.phase, coverage.runId, onChanged]);

  const loadChapters = useCallback(async () => {
    try {
      setChapters(await api.manuscriptChapters());
    } catch (error) {
      setChapters([]);
      notify(describeApiError(error), 'error');
    }
  }, [api, notify]);

  useEffect(() => {
    void loadChapters();
  }, [loadChapters, refreshKey, measuredRun]);

  // home-stage-check-line.prd.md Phase 2 (Q2 A): the narrator saving the project in REAPER while the page stays open.
  useRefreshOnFocus(() => {
    void stages.refresh();
    void loadChapters();
    onChanged();
  }, stages.busy);

  // Every `chaptersync:state` after the first (daw-chapter-track-auto-sync.prd.md Phase 6) may mean the saved project or a stored
  // result changed.
  const sawChapterSync = useRef(false);
  useEffect(() => {
    if (!chapterSync) return;
    if (!sawChapterSync.current) {
      sawChapterSync.current = true;
      return;
    }
    void loadChapters();
    void stages.refresh();
    onChanged();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only chapterSync (a new object per event) should retrigger this
  }, [chapterSync]);

  // Remove from recording / Restore (chapter-track-link-control.prd.md Phase 3): the chapter leaves or rejoins the board. Remove
  // rethrows on failure so the slide-over's confirm stays open for a retry.
  const [restoringId, setRestoringId] = useState('');
  const reloadAfterKind = async () => {
    await loadChapters();
    await loadTrackLinks();
    onChanged();
  };
  const removeFromRecording = async (chapterId: string, kind: ManuscriptContentKind) => {
    try {
      const result = await api.manuscriptSetChapterKind(chapterId, kind);
      notify(`${result.chapter.title} removed from recording.`);
      await reloadAfterKind();
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
      await reloadAfterKind();
    } catch (error) {
      notify(describeApiError(error), 'error');
    } finally {
      setRestoringId('');
    }
  };

  const setStatus = async (chapterId: string, status: ChapterStatus) => {
    try {
      const updated = await api.manuscriptSetChapterStatus(chapterId, status);
      setChapters((current) => current?.map((c) => (c.id === chapterId ? { ...c, status: updated.status } : c)));
      // A status changed by hand retires a confirmation and changes which stage is evaluated.
      void stages.refresh();
      onChanged();
    } catch (error) {
      notify(describeApiError(error), 'error');
    }
  };

  const manuscriptChapter = (chapterId: string) => chapters?.find((chapter) => chapter.id === chapterId);
  const narration = overview.chapters.filter(isNarration);
  const rows: Row[] = [
    ...(creditsRows ? [{ kind: 'credits', credits: 'opening' } as const] : []),
    ...narration.map((chapter) => ({ kind: 'chapter', chapter }) as const),
    ...(creditsRows ? [{ kind: 'credits', credits: 'closing' } as const] : []),
  ];
  const rowName = (row: Row) => (row.kind === 'credits' ? CREDITS_LABEL[row.credits] : chapterName(row.chapter));

  const cell = (rowIndex: number, colIndex: number): StageGridCell => {
    const row = rows[rowIndex];
    const column = BOARD_COLUMNS[colIndex];
    if (row.kind === 'credits') {
      const base = creditsCell(creditsRows![row.credits], column);
      return { ...base, onActivate: () => setCredits({ kind: row.credits, open: true }) };
    }
    const { chapter } = row;
    const running = coverage.phase === 'running' && coverage.chapterId === chapter.id;
    const syncRow = chapterSync?.chapters.find((entry) => entry.chapterId === chapter.id);
    const base = boardCell(chapter, column, {
      checkingPercent: running ? coverage.percent : syncRow?.checking ? null : undefined,
      contradiction: Boolean(stages.state.byChapter.get(chapter.id)?.contradiction),
    });
    const open = (target: ManuscriptChapter | undefined, set: (chapter: ManuscriptChapter) => void) => () => {
      if (target) set(target);
    };
    if (column.kind === 'recorded') {
      const link = trackLinks?.chapters.find((entry) => entry.chapterId === chapter.id);
      return link ? { ...base, onActivate: () => setTrackChapter({ chapterId: chapter.id, open: true }) } : base;
    }
    if (column.kind === 'unavailable') return column.name === 'Prep' ? { ...base, onActivate: () => goToScript(chapter.id) } : base;
    if (isCurrentStage(chapter, column)) return { ...base, onActivate: () => setWhy({ chapterId: chapter.id, open: true }) };
    if (column.stage === 'recording') return { ...base, onActivate: open(manuscriptChapter(chapter.id), setChecking) };
    if (column.stage === 'editing') return { ...base, onActivate: open(manuscriptChapter(chapter.id), setEditingChecking) };
    return { ...base, onActivate: () => goToProofChapter(chapter.id) };
  };

  // The summary chips (chapter-stage-recommendations.prd.md Phase 5) open the first chapter they count.
  const showFirstSuggestion = () => {
    if (stages.state.phase === 'error') {
      void stages.refresh();
      return;
    }
    const first = narration.find((chapter) => {
      const recommendation = stages.state.byChapter.get(chapter.id);
      return recommendation && (recommendation.contradiction || recommendation.verdict === 'recommended');
    });
    if (first) setWhy({ chapterId: first.id, open: true });
  };

  const whyChapter = why ? manuscriptChapter(why.chapterId) : undefined;
  const checkStatusLine = (chapter: ManuscriptChapter) => {
    const link = trackLinks?.chapters.find((entry) => entry.chapterId === chapter.id);
    const syncRow = chapterSync?.chapters.find((entry) => entry.chapterId === chapter.id);
    const running = coverage.phase === 'running' && coverage.chapterId === chapter.id;
    const text = chapterCheckStatusText(
      chapter.title,
      chapterCheckStatus(
        link,
        syncRow,
        running || (syncRow?.checking ?? false),
        running ? coverage.percent : undefined,
        running ? coverage.background : undefined,
      ),
    );
    return `${text.label}${text.detail ? ` · ${text.detail}` : ''}`;
  };

  return (
    <Panel title="Chapter pipeline">
      <p className="mt-1 text-xs" style={MUTED}>
        Every cell opens that stage for the chapter. Recorded is the audio on the chapter&apos;s linked REAPER track, as of the saved project.
      </p>
      <StageSummaryChips state={stages.state} onShow={showFirstSuggestion} />
      <StageCheckLine state={stages.state} onCheckNow={() => void stages.refresh()} />
      {trackLinks && trackLinks.project !== 'ready' && (
        <p className="py-1.5 text-sm" style={MUTED}>
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
      {narration.length === 0 ? (
        <p className="mt-3 text-sm" style={MUTED}>
          No narratable chapters yet.
        </p>
      ) : (
        // tabIndex: the board scrolls sideways in a narrow window, and a scrolling region must be reachable by keyboard.
        <div
          tabIndex={0}
          className="mt-2 overflow-x-auto focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:outline-none focus-visible:ring-inset"
        >
          <StageGrid
            label="Chapter pipeline"
            className="w-full [&_td]:whitespace-nowrap"
            rows={rows.map(rowName)}
            columns={BOARD_COLUMNS.map((column) => column.name)}
            cell={cell}
          />
        </div>
      )}
      {chapters && <RemovedFromRecordingList chapters={chapters} restoringId={restoringId} onRestore={(chapterId) => void restore(chapterId)} />}
      {checking &&
        (() => {
          // A credits row's synthetic chapter (credits-in-chapter-table.prd.md Phase 3, ADR 0333) is never a Proof
          // workspace or a Script paragraph the way a real chapter's is: it opens the Manuscript credits entry instead,
          // the same anchor CreditsRowPanel's "Open in Script" link uses.
          const checkingCreditsKind = creditsCheckKind(checking.id);
          return (
            <RecordingCheck
              key={checking.id}
              chapter={checking}
              coverage={coverage}
              notify={notify}
              close={() => {
                setChecking(undefined);
                // Linking a track in the slide-over changes the evidence without a finished check, so the suggestions are read again.
                void stages.refresh();
              }}
              goToParagraph={checkingCreditsKind ? () => goToScript(`credits-${checkingCreditsKind}`) : (paragraph) => goToScript(checking.id, paragraph)}
              openWorkspace={checkingCreditsKind ? undefined : () => goToProofChapter(checking.id)}
            />
          );
        })()}
      {why && (
        <StageEvidence
          open={why.open}
          chapter={whyChapter}
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
            setWhy({ ...why, open: false });
            if (whyChapter) setChecking(whyChapter);
          }}
          onOpenEditingCheck={() => {
            setWhy({ ...why, open: false });
            if (whyChapter) setEditingChecking(whyChapter);
          }}
          goToParagraph={(paragraph) => goToScript(why.chapterId, paragraph)}
          status={
            whyChapter && (
              <div className="space-y-3 text-sm">
                <Select
                  label={`${whyChapter.title} status`}
                  value={whyChapter.status}
                  options={STATUS_ORDER.map((status) => ({ value: status, label: STATUS_LABELS[status] }))}
                  onChange={(value) => void setStatus(whyChapter.id, value as ChapterStatus)}
                />
                <p style={MUTED}>Recording check: {checkStatusLine(whyChapter)}</p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setWhy({ ...why, open: false });
                      setChecking(whyChapter);
                    }}
                  >
                    Recording check
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setWhy({ ...why, open: false });
                      setEditingChecking(whyChapter);
                    }}
                  >
                    Editing check
                  </Button>
                </div>
              </div>
            )
          }
        />
      )}
      {editingChecking && (
        <EditingCheckPanel
          key={editingChecking.id}
          chapter={editingChecking}
          notify={notify}
          close={() => {
            setEditingChecking(undefined);
            // Accepting, dismissing or deferring an editing candidate changes the evidence the stage suggestions read.
            void stages.refresh();
          }}
        />
      )}
      {trackChapter &&
        (() => {
          const link = trackLinks?.chapters.find((entry) => entry.chapterId === trackChapter.chapterId);
          const trackGuid = link?.track?.trackGuid;
          const trackSummary = trackGuid ? trackLinks?.tracks.find((track) => track.guid === trackGuid) : undefined;
          const measured = overview.chapters.find((chapter) => chapter.id === trackChapter.chapterId)?.recordedSeconds;
          return (
            <ChapterTrackPanel
              open={trackChapter.open}
              chapterId={trackChapter.chapterId}
              chapterTitle={manuscriptChapter(trackChapter.chapterId)?.title ?? ''}
              subtitle={manuscriptChapter(trackChapter.chapterId)?.subtitle}
              link={link}
              trackSummary={trackSummary}
              recordedSeconds={measured ?? undefined}
              savedAt={trackLinks?.savedAt ?? ''}
              notify={notify}
              onClose={() => setTrackChapter({ ...trackChapter, open: false })}
              onChanged={async () => {
                await loadTrackLinks();
                onChanged();
              }}
              onRemoveFromRecording={(kind) => removeFromRecording(trackChapter.chapterId, kind)}
            />
          );
        })()}
      {credits && creditsRows && (
        <CreditsRowPanel
          open={credits.open}
          row={creditsRows[credits.kind]}
          label={CREDITS_LABEL[credits.kind]}
          onStatus={(status) => void setCreditsStatus(credits.kind, status)}
          onCheck={() => {
            // Same pattern as StageEvidence's own "Recording check" button below: close this slide-over, then open
            // RecordingCheck as a sibling, never nested (a reopened row is a fresh mount, never shown stale).
            setCredits({ ...credits, open: false });
            setChecking(creditsCheckChapter(credits.kind, creditsRows[credits.kind].status));
          }}
          onClose={() => setCredits({ ...credits, open: false })}
        />
      )}
    </Panel>
  );
}
