import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useApi } from '../../api/ApiContext';
import { chapterName } from '../../chapterName';
import { formatWhen } from '../home/recordingCheckText';
import { RecordingCheck } from '../home/RecordingCheck';
import { Button } from '../primitives/Button';
import { Heading } from '../primitives/Heading';
import { Panel } from '../primitives/Panel';
import type { Notify } from '../primitives/Toast';
import type { CoverageState, ManuscriptChapter, TrackItem } from '../../types';
import type { WorkspaceAlignmentResult, WorkspaceToken } from '../../api/contracts/workspace';
import { CommandScope } from '../../input/router';
import { useCommand } from '../../input/useCommand';
import { buildFlags, type Flag } from './flags';
import { buildPlaylist } from './playlist';
import { buildTokenIndex, currentTokenIndex, seekTargetForToken } from './tokenAtTime';
import { useChapterPlayback } from './useChapterPlayback';
import { TransportBar } from './TransportBar';
import { ScriptView } from './ScriptView';
import { FlagsPanel } from './FlagsPanel';

/** How long before a clicked word's start the app player starts, so the narrator hears it in context (EP5). */
const PRE_ROLL_SECONDS = 1;

const CHECK_STATE_LABEL: Record<WorkspaceAlignmentResult['state'], string> = {
  current: 'Check current',
  stale: 'Check stale',
  never: 'Not checked yet',
};

/**
 * The chapter workspace (edit-and-proof-workspace.prd.md, Phase 2 MVP): a chapter route under Tracks
 * (`/tracks/chapter/:chapterId`, EP1 A) that plays the chapter's recorded audio in the app, honouring each item's
 * played range, follows the script with a karaoke highlight and auto-scroll, shows the check's flags inline, and
 * seeks on a click (EP5). Reviewing a flag, "Go to"/"Loop" in REAPER, the waveform, takes and effects are later
 * phases (3 to 9) - their controls are not shown here rather than shown disabled with nothing behind them.
 */
export function WorkspacePage({ notify }: { notify: Notify }) {
  const api = useApi();
  const { chapterId = '' } = useParams<{ chapterId: string }>();
  const [searchParams] = useSearchParams();

  const [chapter, setChapter] = useState<ManuscriptChapter>();
  const [linkedTrackGuid, setLinkedTrackGuid] = useState<string>();
  const [trackItems, setTrackItems] = useState<TrackItem[]>();
  const [alignment, setAlignment] = useState<WorkspaceAlignmentResult>();
  const [loadError, setLoadError] = useState('');
  const [coverage, setCoverage] = useState<CoverageState>({ phase: 'idle', percent: 0, message: '' });
  const [checking, setChecking] = useState(false);
  const [selectedFlagIndex, setSelectedFlagIndex] = useState<number>();

  useEffect(() => api.subscribeCoverage(setCoverage), [api]);

  const loadAlignment = useCallback(() => {
    api
      .workspaceAlignment(chapterId)
      .then(setAlignment)
      .catch((reason: unknown) => setLoadError(String(reason)));
  }, [api, chapterId]);

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
  const flags = useMemo(() => buildFlags(alignment?.tokens ?? [], alignment?.extras ?? []), [alignment?.tokens, alignment?.extras]);

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
      <div className="mx-auto max-w-4xl space-y-4">
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          <Link to="/tracks">Tracks</Link> <span aria-hidden="true">&rsaquo;</span> Chapter workspace
        </p>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <Heading title={chapterName(chapter)} />
          <div className="flex flex-wrap items-center gap-2 text-sm" style={{ color: 'var(--text-muted)' }}>
            {alignment && <span className="section-label">{CHECK_STATE_LABEL[alignment.state]}</span>}
            {alignment?.basis && <span>as of last save {formatWhen(alignment.basis.modifiedAt)}</span>}
            <Button variant="ghost" onClick={() => setChecking(true)}>
              {alignment?.state === 'never' ? 'Check recording' : 'Check again'}
            </Button>
          </div>
        </div>
        {alignment?.needsAlignAgain && (
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            This chapter was last checked before the workspace could read its word alignment. Run Check again to see flags and word-by-word playback.
          </p>
        )}
        {!linkedTrackGuid && (
          <Panel title="No linked track">
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              This chapter isn&rsquo;t linked to a REAPER track yet. Link one from the Chapter links table on Tracks, then reopen this workspace.
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
        {alignment && alignment.state !== 'never' && (
          <>
            <TransportBar player={player} />
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
              <ScriptView
                paragraphs={alignment.paragraphs}
                tokens={alignment.tokens}
                extras={alignment.extras}
                currentTokenIndex={currentToken}
                isPlaying={player.isPlaying}
                onSeekToken={seekToken}
              />
              <FlagsPanel
                flags={flags}
                tokens={alignment.tokens}
                selectedIndex={selectedFlagIndex}
                onSelect={selectFlag}
                onPlayFromFlag={(flag: Flag) => flag.seekTokenIndex !== undefined && seekToken(alignment.tokens[flag.seekTokenIndex])}
              />
            </div>
          </>
        )}
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
