import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { EnginePanelLink } from '../engine/EnginePanelContext';
import { useApi } from '../../api/ApiContext';
import { apiErrorMessage, describeApiError } from '../../api/errorMessage';
import { chapterName } from '../../chapterName';
import { formatWhen } from '../production/recordingCheckText';
import { RecordingCheck } from '../production/RecordingCheck';
import { Button } from '../primitives/Button';
import { Heading } from '../primitives/Heading';
import { Panel } from '../primitives/Panel';
import type { Notify } from '../primitives/Toast';
import type { CoverageState, Discrepancy, Finding, FindingReviewStatus, ManuscriptChapter, TrackItem, TranscriptState } from '../../types';
import type { WorkspaceAlignmentResult, WorkspaceToken } from '../../api/contracts/workspace';
import { CommandScope } from '../../input/router';
import { useCommand } from '../../input/useCommand';
import { buildFlags, type Flag } from './flags';
import { overlayFindings } from './findingFlags';
import { buildPlaylist } from './playlist';
import { buildTokenIndex, currentTokenIndex, seekTargetForToken } from './tokenAtTime';
import { useChapterPlayback } from './useChapterPlayback';
import { useWorkspaceReaper } from './useWorkspaceReaper';
import { TransportBar } from './TransportBar';
import { ScriptView } from './ScriptView';
import { FlagsPanel, type CompareFlagActions, type FlagDecisionResult } from './FlagsPanel';
import { CompareRun } from './CompareRun';
import { overlayDiscrepancies } from './compareFlags';
import { PreviewPanel } from './PreviewPanel';
import { ProofingStagePanel } from './ProofingStagePanel';
import { usePickupsState } from '../pickups/usePickupsState';
import { FindingDetail } from './FindingDetail';
import { FindingsList } from './FindingsList';
import { NotesHeader, SourcesLine } from './NotesHeader';
import { NotesStrip } from './NotesStrip';
import { RecordingCheckCard } from './RecordingCheckCard';
import { resolutionCounts } from './resolution';
import { useReaperStatus } from './useReaperStatus';

/** How long before a clicked word's start the app player starts, so the narrator hears it in context (EP5). */
const PRE_ROLL_SECONDS = 1;

const CHECK_STATE_LABEL: Record<WorkspaceAlignmentResult['state'], string> = {
  current: 'Check current',
  stale: 'Check stale',
  never: 'Not checked yet',
};

type ChapterViewProps = {
  notify: Notify;
  /** The app-wide Transcript Compare state (App's bootstrap plus the host's transcript event). */
  transcript: TranscriptState;
  /** PRD project-workspace-and-daw-link.prd.md, W16: the compare run and its REAPER actions need a linked project file. */
  dawFileLinked: boolean;
  goToManuscript: (chapter: string, paragraph?: number) => void;
  /** Opens a Story Bible entry, for a note about one (a note's detail, as on the book level). */
  goToStoryBible: (entityId: string) => void;
  /** Changes after a manuscript import or replacement, so the stage panel reads again (chapter-stage-recommendations.prd.md Phase 8). */
  refreshKey: string;
};

/**
 * Proof's chapter view, `/proof/:chapterId`, led by mock 04 (D85 #2 on #509, ADR 0470): the Sources line, a strip of the
 * chapter's notes over its recording (NotesStrip), the chapter's notes table and a note's detail with Play ±3 s, and the
 * recording-check card (D85 #11). Under it, as before (stage-navigation-and-page-replacement.prd.md Phase 5): the chapter
 * workspace of edit-and-proof-workspace.prd.md at its new address, with the retired Proofing page folded in. It plays
 * the chapter's recorded audio in the app, honouring each item's played range, follows the script with a karaoke
 * highlight and auto-scroll, shows the check's flags inline, and seeks on a click (EP5), with Go to/Loop in REAPER
 * for the word at the playhead (Phase 3, `useWorkspaceReaper`). The chapter's stored findings are overlaid on the same
 * flags (Phase 4, `overlayFindings`) and reviewed in place through the same `findingsReview` binding the book's notes
 * use, and `?finding=<id>` selects the flag that finding backs. Transcript Compare runs from here against this chapter
 * (CompareRun) and its discrepancies become flags too (`overlayDiscrepancies`), with the Preview and stage panels
 * beside it. One component per chapter (keyed by the id), so nothing selected on one chapter carries to the next.
 */
export function ProofChapterPage(props: ChapterViewProps) {
  const { chapterId = '' } = useParams<{ chapterId: string }>();
  return <ChapterView key={chapterId} chapterId={chapterId} {...props} />;
}

function ChapterView({ chapterId, notify, transcript, dawFileLinked, goToManuscript, goToStoryBible, refreshKey }: ChapterViewProps & { chapterId: string }) {
  const api = useApi();
  const pickups = usePickupsState();
  const reaperStatus = useReaperStatus();
  // The note open in mock 04's detail, by id, so a re-read of the chapter's findings shows its latest version.
  const [selectedFindingId, setSelectedFindingId] = useState<string>();
  const [searchParams] = useSearchParams();

  const [chapter, setChapter] = useState<ManuscriptChapter>();
  const [linkedTrackGuid, setLinkedTrackGuid] = useState<string>();
  const [trackItems, setTrackItems] = useState<TrackItem[]>();
  const [alignment, setAlignment] = useState<WorkspaceAlignmentResult>();
  const [loadError, setLoadError] = useState('');
  const [coverage, setCoverage] = useState<CoverageState>({ phase: 'idle', percent: 0, message: '' });
  const [checking, setChecking] = useState(false);
  const [selectedFlagIndex, setSelectedFlagIndex] = useState<number>();
  const [findings, setFindings] = useState<Finding[]>([]);
  const [lastCompleted, setLastCompleted] = useState<TranscriptState>();
  const [reviewingLast, setReviewingLast] = useState(false);

  // The last completed comparison, offered for review without running again (PRD W16: it needs no linked project file).
  useEffect(() => {
    void api
      .transcriptLastCompleted()
      .then(setLastCompleted)
      .catch(() => {});
  }, [api]);

  useEffect(() => api.subscribeCoverage(setCoverage), [api]);

  const loadAlignment = useCallback(() => {
    api
      .workspaceAlignment(chapterId)
      .then(setAlignment)
      .catch((reason: unknown) => setLoadError(String(reason)));
  }, [api, chapterId]);

  // Chapter findings for the text overlay (edit-and-proof-workspace.prd.md Phase 4): read fresh whenever the chapter
  // changes, or after a decision made here (below) so the flag it backs shows its new status straight away. A
  // failure here never blocks the page - the check-derived flags (Phase 2) still show with nothing lost.
  const loadFindings = useCallback(() => {
    api
      .findingsList({ chapterId })
      .then((page) => setFindings(page.findings))
      .catch(() => undefined);
  }, [api, chapterId]);
  useEffect(loadFindings, [loadFindings]);

  useEffect(() => {
    let active = true;
    Promise.all([api.manuscriptChapters(), api.chapterTrackMapList(), api.tracksList()])
      .then(([chapters, mapping, project]) => {
        if (!active) return;
        setChapter(chapters.find((candidate) => candidate.id === chapterId));
        const trackGuid = mapping.mappings.find((entry) => entry.chapterId === chapterId)?.trackGuid;
        setLinkedTrackGuid(trackGuid);
        setTrackItems(project.tracks.find((track) => track.guid === trackGuid)?.items ?? []);
      })
      .catch((reason: unknown) => {
        if (active) setLoadError(String(reason));
      });
    return () => {
      active = false;
    };
  }, [api, chapterId]);

  useEffect(loadAlignment, [loadAlignment]);

  const playlist = useMemo(() => buildPlaylist(trackItems ?? []), [trackItems]);
  const player = useChapterPlayback(playlist, api.mediaUrl);

  const tokenIndexByItem = useMemo(() => buildTokenIndex(alignment?.tokens ?? []), [alignment?.tokens]);
  const currentToken = currentTokenIndex(tokenIndexByItem, alignment?.items ?? [], player.currentItemGuid, player.currentSourceTime);
  const checkFlags = useMemo(() => buildFlags(alignment?.tokens ?? [], alignment?.extras ?? []), [alignment?.tokens, alignment?.extras]);
  // The compare run's results for this chapter: the live run's once it succeeds, or the last completed one while the
  // narrator reviews it. A run covers the selected REAPER audio, so rows for other chapters are left out here.
  const compareResults = reviewingLast ? lastCompleted : transcript.phase === 'success' ? transcript : undefined;
  const compareRows = useMemo<Discrepancy[]>(
    () => (chapter ? (compareResults?.rows ?? []).filter((row) => row.chapter === chapter.title) : []),
    [compareResults?.rows, chapter],
  );
  const flags = useMemo(
    () =>
      overlayDiscrepancies(
        overlayFindings(checkFlags, findings, alignment?.items ?? [], alignment?.tokens ?? []),
        compareRows,
        alignment?.tokens ?? [],
        chapter?.paragraphIds ?? [],
      ),
    [checkFlags, findings, alignment?.items, alignment?.tokens, compareRows, chapter?.paragraphIds],
  );
  const compareActions: CompareFlagActions = {
    canJump: dawFileLinked,
    jump: (row) => void api.transcriptJump(row.id).catch((error) => notify(describeApiError(error), 'error')),
    addEquivalence: (row) =>
      void api.transcriptAddEquivalence(row.id).then(
        (message) => notify(message),
        (error) => notify(describeApiError(error), 'error'),
      ),
    showInManuscript: (row) => goToManuscript(row.chapter || '', row.paragraph || 0),
  };
  const reaper = useWorkspaceReaper(chapterId, currentToken, alignment?.tokens ?? []);

  const seekToken = useCallback(
    (token: WorkspaceToken) => {
      const target = seekTargetForToken(token, alignment?.items ?? [], PRE_ROLL_SECONDS);
      if (!target) return;
      player.seekToSource(target.itemGuid, target.sourceTime);
      if (!player.isPlaying) player.play();
    },
    [alignment?.items, player],
  );

  // ?t=<seconds> (a deep link to a word, App Navigation "Navigation and deep links"): seek once the playlist is
  // ready, then forget it - a later reload of the same URL should not keep pinning playback there.
  const appliedDeepLinkRef = useRef(false);
  useEffect(() => {
    if (appliedDeepLinkRef.current || playlist.length === 0) return;
    const seconds = Number(searchParams.get('t'));
    if (Number.isFinite(seconds) && seconds >= 0) player.seekToElapsed(seconds);
    appliedDeepLinkRef.current = true;
    // player is stable across renders (its identity comes from useChapterPlayback's own refs/state, not this
    // effect's business), and re-running this on every player change would re-seek on every playback tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playlist.length, searchParams]);

  const selectFlag = useCallback(
    (index: number) => {
      setSelectedFlagIndex(index);
      const flag = flags[index];
      if (flag?.seekTokenIndex !== undefined) seekToken(alignment!.tokens[flag.seekTokenIndex]);
    },
    [flags, alignment, seekToken],
  );

  // ?finding=<id> (Navigation and deep links; "Open in workspace" from Proof's notes, the Production board and Script, Phase 4):
  // selects the flag that finding backs and seeks the app player to it, once its flag exists - a finding whose
  // overlay flag isn't ready yet on the first render (findings and the alignment load separately) is retried on
  // every render until it is, then forgotten so a later selection by hand is never fought.
  const appliedFindingLinkRef = useRef(false);
  useEffect(() => {
    if (appliedFindingLinkRef.current) return;
    const findingId = searchParams.get('finding');
    if (!findingId) {
      appliedFindingLinkRef.current = true;
      return;
    }
    const index = flags.findIndex((flag) => flag.findingId === findingId);
    if (index === -1) return;
    appliedFindingLinkRef.current = true;
    setSelectedFindingId(findingId);
    selectFlag(index);
  }, [flags, searchParams, selectFlag]);

  const selectedFinding = findings.find((finding) => finding.id === selectedFindingId);

  const stepWord = useCallback(
    (direction: -1 | 1) => {
      const tokens = alignment?.tokens ?? [];
      const timed = tokens.filter((token) => token.start !== undefined);
      if (timed.length === 0) return;
      const from = currentToken;
      const candidates =
        direction === 1
          ? timed.filter((token) => from === undefined || token.i > from)
          : [...timed].reverse().filter((token) => from !== undefined && token.i < from);
      const next = candidates[0] ?? (direction === -1 ? timed[timed.length - 1] : undefined);
      if (next) seekToken(next);
    },
    [alignment?.tokens, currentToken, seekToken],
  );

  const stepParagraph = useCallback(
    (direction: -1 | 1) => {
      const paragraphs = alignment?.paragraphs ?? [];
      const currentParagraphId = alignment?.tokens.find((token) => token.i === currentToken)?.p;
      const index = paragraphs.findIndex((paragraph) => paragraph.id === currentParagraphId);
      const nextIndex = Math.max(0, Math.min(paragraphs.length - 1, (index === -1 ? 0 : index) + direction));
      const nextParagraph = paragraphs[nextIndex];
      const firstTimedToken = alignment?.tokens.find((token) => token.p === nextParagraph?.id && token.start !== undefined);
      if (firstTimedToken) seekToken(firstTimedToken);
    },
    [alignment?.paragraphs, alignment?.tokens, currentToken, seekToken],
  );

  // A flag's decision (Phase 4): the same findingsReview binding the Review page uses, so a decision made here shows
  // there too (and the other way round - loadFindings re-reads the store, picking up a decision made elsewhere since
  // this page was opened). The evidence version and finding id come from the flag itself (set by overlayFindings from
  // the finding it was built from), never guessed.
  const decideFlag = useCallback(
    async (flag: Flag, status: FindingReviewStatus, note: string): Promise<FlagDecisionResult> => {
      if (!flag.findingId) return { ok: false, message: 'This flag has no finding to decide on.' };
      try {
        await api.findingsReview({ id: flag.findingId, evidenceVersion: flag.evidenceVersion ?? '', status, note });
        loadFindings();
        return { ok: true };
      } catch (error) {
        return { ok: false, message: apiErrorMessage(error) };
      }
    },
    [api, loadFindings],
  );

  // workspace.* page commands (input-commands-and-pedals.prd.md Phase 3), replacing the old window `keydown`
  // listener: the registry (src/input/) applies the "not while typing" and modifier rules once, in one place,
  // instead of this page repeating them. `workspace.play` is `noisy: true` in the catalog (silenced while the DAW
  // records, Phase 10 - not this phase's job to wire that up).
  useCommand('workspace.play', () => player.togglePlay());
  useCommand('workspace.word.prev', () => stepWord(-1));
  useCommand('workspace.word.next', () => stepWord(1));
  useCommand('workspace.paragraph.prev', () => stepParagraph(-1));
  useCommand('workspace.paragraph.next', () => stepParagraph(1));
  useCommand('workspace.flag.prev', () => selectFlag(Math.max(0, (selectedFlagIndex ?? 0) - 1)));
  useCommand('workspace.flag.next', () => selectFlag(selectedFlagIndex === undefined ? 0 : Math.min(flags.length - 1, selectedFlagIndex + 1)));

  let content: ReactNode;
  if (loadError) {
    content = (
      <p role="alert" className="text-sm" style={{ color: 'var(--danger-text)' }}>
        {loadError}
      </p>
    );
  } else if (chapter === undefined) {
    content = null; // still loading, or the id doesn't resolve to a chapter
  } else {
    content = (
      <div className="mx-auto max-w-7xl space-y-4">
        <nav aria-label="Breadcrumb" className="text-sm" style={{ color: 'var(--text-muted)' }}>
          <Link to="/proof">Proof</Link> <span aria-hidden="true">&rsaquo;</span> {chapterName(chapter)}
        </nav>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
            <Heading title={`Proof · ${chapterName(chapter)}`} />
            <SourcesLine analyzers={[...new Set(findings.map((finding) => finding.analyzer))]} proofer={pickups.total > 0} />
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm" style={{ color: 'var(--text-muted)' }}>
            {alignment && <span className="section-label">{CHECK_STATE_LABEL[alignment.state]}</span>}
            {alignment?.basis && <span>as of last save {formatWhen(alignment.basis.modifiedAt)}</span>}
            <Button variant="secondary" onClick={() => setChecking(true)}>
              {alignment?.state === 'never' ? 'Check recording' : 'Check again'}
            </Button>
          </div>
        </div>
        {alignment?.needsAlignAgain && (
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            This chapter was last checked before the app could read its word alignment. Run Check again to see flags and word-by-word playback.
          </p>
        )}
        {!linkedTrackGuid && (
          <Panel title="No linked track">
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              This chapter isn&rsquo;t linked to a REAPER track yet. Link one from the Chapter links table in the audio engine panel, then open this chapter
              again. <EnginePanelLink />
            </p>
          </Panel>
        )}
        {alignment?.state === 'never' && (
          <Panel>
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              This chapter hasn&rsquo;t been checked yet. Run Check recording to see its script, follow along, and see any flags.
            </p>
          </Panel>
        )}
        <NotesStrip findings={findings} items={trackItems ?? []} selectedId={selectedFindingId} onSelect={(finding) => setSelectedFindingId(finding.id)} />
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
          <FindingsList
            page={{ findings, total: findings.length }}
            selectedId={selectedFindingId}
            onSelect={(finding) => setSelectedFindingId(finding.id)}
            filtered={false}
            onClearFilters={() => undefined}
            showChapter={false}
            header={<NotesHeader total={findings.length} counts={resolutionCounts(findings)} pickups={pickups} />}
          />
          <div className="flex min-w-0 flex-col gap-4">
            {selectedFinding ? (
              <FindingDetail
                // One detail per note, so a note typed on one never shows on the next; a refreshed note keeps it.
                key={selectedFinding.id}
                finding={selectedFinding}
                hasManuscript
                onChanged={(_finding, decided) => decided && loadFindings()}
                goToManuscript={goToManuscript}
                goToStoryBible={goToStoryBible}
                // A chapter's notes are about its recording; a delivery check is about a rendered file and is never one of them.
                goToMaster={() => undefined}
                reaperStatus={reaperStatus.status}
                onReaperStatusChange={reaperStatus.refresh}
                onCompared={loadFindings}
              />
            ) : (
              findings.length > 0 && (
                <Panel>
                  <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                    Select a note, or a pin on the strip, to see it and play it with 3 s either side.
                  </p>
                </Panel>
              )
            )}
            <RecordingCheckCard chapter={chapter} alignment={alignment} flags={checkFlags} />
          </div>
        </div>
        {alignment && alignment.state !== 'never' && <TransportBar player={player} reaper={reaper} />}
        {alignment && (alignment.state !== 'never' || flags.length > 0) && (
          <div className={alignment.state !== 'never' ? 'grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]' : 'max-w-md'}>
            {alignment.state !== 'never' && (
              <ScriptView
                paragraphs={alignment.paragraphs}
                tokens={alignment.tokens}
                extras={alignment.extras}
                currentTokenIndex={currentToken}
                isPlaying={player.isPlaying}
                onSeekToken={seekToken}
              />
            )}
            <FlagsPanel
              flags={flags}
              tokens={alignment.tokens}
              selectedIndex={selectedFlagIndex}
              onSelect={selectFlag}
              onPlayFromFlag={(flag: Flag) => flag.seekTokenIndex !== undefined && seekToken(alignment.tokens[flag.seekTokenIndex])}
              reaper={reaper}
              onDecide={decideFlag}
              compare={compareRows.length > 0 ? compareActions : undefined}
            />
          </div>
        )}
        <CompareRun
          chapterTitle={chapterName(chapter, 'short')}
          state={transcript}
          notify={notify}
          dawFileLinked={dawFileLinked}
          lastCompleted={lastCompleted}
          reviewingLast={reviewingLast}
          onReviewLast={() => {
            setSelectedFlagIndex(undefined);
            setReviewingLast(true);
          }}
          onCloseLast={() => {
            setSelectedFlagIndex(undefined);
            setReviewingLast(false);
          }}
          foundHere={compareRows.length}
        />
        <PreviewPanel notify={notify} goToManuscript={goToManuscript} />
        <ProofingStagePanel
          notify={notify}
          chapter={chapter}
          goToManuscript={goToManuscript}
          refreshKey={refreshKey}
          onStatusChanged={(status) => setChapter((current) => (current ? { ...current, status } : current))}
          onOpenFinding={(findingId) => {
            const index = flags.findIndex((flag) => flag.findingId === findingId);
            if (index !== -1) selectFlag(index);
          }}
        />
        {checking && (
          <RecordingCheck
            chapter={chapter}
            coverage={coverage}
            notify={notify}
            close={() => {
              setChecking(false);
              loadAlignment();
            }}
            goToParagraph={(index) => {
              const targetId = chapter.paragraphIds?.find((entry) => entry.index === index)?.id;
              if (targetId) document.getElementById(`workspace-paragraph-${targetId}`)?.scrollIntoView?.({ block: 'center' });
            }}
          />
        )}
      </div>
    );
  }

  return <CommandScope kind="page">{content}</CommandScope>;
}
