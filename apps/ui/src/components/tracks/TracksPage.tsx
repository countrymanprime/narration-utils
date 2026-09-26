import { useEffect, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faBackward, faBackwardStep, faForward, faForwardStep, faPause, faPlay, faTriangleExclamation } from '@fortawesome/free-solid-svg-icons';
import { useApi } from '../../api/ApiContext';
import { Heading } from '../primitives/Heading';
import { Panel } from '../primitives/Panel';
import { Button } from '../primitives/Button';
import type { Notify } from '../primitives/Toast';
import { ChapterLinksTable } from './ChapterLinksTable';
import { ChapterSyncPanel } from './ChapterSyncPanel';
import { useTrackPlayback } from './useTrackPlayback';
import { LinkChaptersDialog } from './LinkChaptersDialog';
import { PickupsDialog } from './PickupsDialog';
import { RenderConfigDialog } from './RenderConfigDialog';
import { CleanupToolsDialog } from './CleanupToolsDialog';
import { RetakeLanesDialog } from './RetakeLanesDialog';
import { ChapterTagsDialog } from './ChapterTagsDialog';
import type { ManuscriptChapter, Track, TracksDiscovery, TracksProject } from '../../types';

function basename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const whole = Math.floor(seconds);
  const minutes = Math.floor(whole / 60);
  const remaining = whole % 60;
  return `${minutes}:${remaining.toString().padStart(2, '0')}`;
}

function RppPicker({ discovery, onSelect }: { discovery: TracksDiscovery; onSelect: (path: string) => void }) {
  return (
    <Panel title="Choose a REAPER project file">
      <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
        More than one .rpp file was found in this project folder. Choose which one to read tracks from.
      </p>
      <ul className="mt-3 space-y-1.5">
        {discovery.candidates.map((path) => (
          <li key={path}>
            <button
              type="button"
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 text-left font-['IBM_Plex_Mono',ui-monospace,monospace] text-sm hover:border-[var(--accent)]"
              onClick={() => onSelect(path)}
            >
              {path}
            </button>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

// The Tracks page's own entry point to the shared DAW-link binding (PRD project-workspace-and-daw-link.prd.md, Open
// Question W19: one binding, three call sites - the pill, here, and Settings' DAW category). Tracks reads its .rpp
// through its own discovery flow, independent of the manifest link, so this is offered as an extra "point at a
// different file" action, not a gate on the page.
function DawFileLink({ dawFileLinked, onLinkDawFile }: { dawFileLinked: boolean; onLinkDawFile: () => void }) {
  return (
    <Button variant="ghost" className="text-xs" onClick={onLinkDawFile}>
      {dawFileLinked ? 'Link a different REAPER project file' : 'Link a REAPER project file'}
    </Button>
  );
}

function TrackRow({ track, active, onSelect }: { track: Track; active: boolean; onSelect: () => void }) {
  const playableCount = track.items.filter((item) => item.supported && item.sourceAvailable).length;
  const hasIssue = track.items.some((item) => !item.supported || !item.sourceAvailable);
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        className={`flex w-full items-center gap-2.5 rounded-md border px-3 py-2.5 text-left transition ${active ? 'border-[var(--accent)] bg-[var(--surface-2)]' : 'border-[var(--border)] bg-[var(--surface)] hover:border-[var(--accent)]'}`}
      >
        <span className="size-[10px] flex-none rounded-full" style={{ backgroundColor: track.color || 'var(--non-text)' }} aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate font-medium">{track.name || `Track ${track.index + 1}`}</span>
        {track.muted && <span className="section-label flex-none">Muted</span>}
        {hasIssue && (
          <span title="This track has an item that can't be played" className="flex-none" style={{ color: 'var(--danger-text)' }}>
            <FontAwesomeIcon icon={faTriangleExclamation} />
          </span>
        )}
        <span className="flex-none text-xs" style={{ color: 'var(--text-muted)' }}>
          {playableCount}/{track.items.length}
        </span>
      </button>
    </li>
  );
}

function Transport({ tracks, activeIndex, onActiveIndexChange }: { tracks: Track[]; activeIndex: number; onActiveIndexChange: (index: number) => void }) {
  const api = useApi();
  const player = useTrackPlayback(tracks, activeIndex, onActiveIndexChange, api.mediaUrl);
  const activeTrack = tracks[activeIndex];
  return (
    <Panel>
      <div className="font-semibold">{activeTrack?.name || 'No track selected'}</div>
      {!player.canPlay && (
        <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
          {activeTrack ? 'This track has no playable audio.' : 'Select a track to play it.'}
        </p>
      )}
      {player.loadError && (
        <p role="alert" className="mt-1 text-sm" style={{ color: 'var(--danger-text)' }}>
          This track&rsquo;s audio couldn&rsquo;t be played. Check that its source files are still where the project expects them.
        </p>
      )}
      <div className="mt-3 flex items-center justify-center gap-3">
        <Button variant="ghost" onClick={player.previousTrack} disabled={!player.hasPreviousTrack} aria-label="Previous track">
          <FontAwesomeIcon icon={faBackwardStep} />
        </Button>
        <Button variant="ghost" onClick={player.skipBackward} disabled={!player.canPlay} aria-label="Skip back 30 seconds">
          <FontAwesomeIcon icon={faBackward} /> 30s
        </Button>
        <Button onClick={player.togglePlay} disabled={!player.canPlay} aria-label={player.isPlaying ? 'Pause' : 'Play'}>
          <FontAwesomeIcon icon={player.isPlaying ? faPause : faPlay} />
        </Button>
        <Button variant="ghost" onClick={player.skipForward} disabled={!player.canPlay} aria-label="Skip forward 30 seconds">
          30s <FontAwesomeIcon icon={faForward} />
        </Button>
        <Button variant="ghost" onClick={player.nextTrack} disabled={!player.hasNextTrack} aria-label="Next track">
          <FontAwesomeIcon icon={faForwardStep} />
        </Button>
      </div>
      {player.canPlay && (
        <div className="mt-2 text-center font-['IBM_Plex_Mono',ui-monospace,monospace] text-sm" style={{ color: 'var(--text-muted)' }}>
          {formatTime(player.currentTime)} / {formatTime(player.duration)}
        </div>
      )}
    </Panel>
  );
}

export function TracksPage({ dawFileLinked, onLinkDawFile, notify }: { dawFileLinked: boolean; onLinkDawFile: () => void; notify: Notify }) {
  const api = useApi();
  const [discovery, setDiscovery] = useState<TracksDiscovery>();
  const [project, setProject] = useState<TracksProject>();
  const [error, setError] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [chapters, setChapters] = useState<ManuscriptChapter[]>([]);
  // Bumped by the chapter-sync panel's own actions (toggle, Link), so the Chapter links table below re-reads the
  // mapping it doesn't otherwise hear about (chapterTrackSet and chapterSyncSetEnabled send no event of their own).
  const [chapterSyncRefresh, setChapterSyncRefresh] = useState(0);
  const [linkChaptersOpen, setLinkChaptersOpen] = useState(false);
  const [pickupsOpen, setPickupsOpen] = useState(false);
  const [renderConfigOpen, setRenderConfigOpen] = useState(false);
  const [cleanupToolsOpen, setCleanupToolsOpen] = useState(false);
  const [retakeLanesOpen, setRetakeLanesOpen] = useState(false);
  const [chapterTagsOpen, setChapterTagsOpen] = useState(false);

  useEffect(() => {
    let active = true;
    void api
      .manuscriptChapters()
      .then((next) => {
        if (active) setChapters(next);
      })
      .catch(() => {
        // Link chapters is an optional, secondary action on this page: a failed chapter load just leaves the button hidden
        // (chapters stays empty) instead of raising the page's own error banner, which is reserved for the tracks it exists to show.
      });
    return () => {
      active = false;
    };
  }, [api]);

  useEffect(() => {
    let active = true;
    void api
      .tracksDiscover()
      .then((next) => {
        if (active) setDiscovery(next);
      })
      .catch((reason) => {
        if (active) setError(String(reason));
      });
    return () => {
      active = false;
    };
  }, [api]);

  useEffect(() => {
    if (!discovery?.selected) return;
    let active = true;
    void api
      .tracksList()
      .then((next) => {
        if (active) {
          setProject(next);
          setError('');
          setActiveIndex(0);
        }
      })
      .catch((reason) => {
        if (active) setError(String(reason));
      });
    return () => {
      active = false;
    };
  }, [api, discovery?.selected]);

  const selectRpp = (path: string) => {
    setError('');
    void api
      .tracksSelect(path)
      .then((next) => setDiscovery(next))
      .catch((reason) => setError(String(reason)));
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <Heading title="Tracks">{discovery?.selected ? basename(discovery.selected) : 'Detected from the project’s REAPER file.'}</Heading>
        </div>
        {project && project.tracks.length > 0 && (
          <div className="flex min-w-0 flex-wrap gap-2">
            {chapters.length > 0 && (
              <Button variant="ghost" onClick={() => setLinkChaptersOpen(true)}>
                Link chapters…
              </Button>
            )}
            <Button variant="ghost" onClick={() => setPickupsOpen(true)}>
              Pickups…
            </Button>
            <Button variant="ghost" onClick={() => setRenderConfigOpen(true)}>
              Prepare chapter render…
            </Button>
            <Button variant="ghost" onClick={() => setChapterTagsOpen(true)}>
              Embed chapter tags…
            </Button>
            <Button variant="ghost" onClick={() => setCleanupToolsOpen(true)}>
              Cleanup tools…
            </Button>
            <Button variant="ghost" onClick={() => setRetakeLanesOpen(true)}>
              Retakes on lanes…
            </Button>
          </div>
        )}
      </div>
      <DawFileLink dawFileLinked={dawFileLinked} onLinkDawFile={onLinkDawFile} />
      <ChapterSyncPanel notify={notify} onChanged={() => setChapterSyncRefresh((count) => count + 1)} />
      {linkChaptersOpen && project && <LinkChaptersDialog chapters={chapters} tracks={project.tracks} onClose={() => setLinkChaptersOpen(false)} />}
      {pickupsOpen && <PickupsDialog onClose={() => setPickupsOpen(false)} />}
      {renderConfigOpen && <RenderConfigDialog onClose={() => setRenderConfigOpen(false)} />}
      {chapterTagsOpen && <ChapterTagsDialog onClose={() => setChapterTagsOpen(false)} />}
      {cleanupToolsOpen && <CleanupToolsDialog onClose={() => setCleanupToolsOpen(false)} />}
      {retakeLanesOpen && <RetakeLanesDialog onClose={() => setRetakeLanesOpen(false)} />}
      {error && (
        <p role="alert" className="text-sm" style={{ color: 'var(--danger-text)' }}>
          {error}
        </p>
      )}
      {discovery && discovery.candidates.length === 0 && (
        <Panel title="No REAPER project file found">
          <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
            This project folder doesn&rsquo;t contain a .rpp file. Save your REAPER project into the folder, then reopen this page.
          </p>
        </Panel>
      )}
      {discovery && !discovery.selected && discovery.candidates.length > 1 && <RppPicker discovery={discovery} onSelect={selectRpp} />}
      {project && project.tracks.length === 0 && (
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          This REAPER project has no tracks yet.
        </p>
      )}
      {project && project.tracks.length > 0 && (
        <>
          <Transport tracks={project.tracks} activeIndex={activeIndex} onActiveIndexChange={setActiveIndex} />
          <ul className="space-y-1.5">
            {project.tracks.map((track, index) => (
              <TrackRow key={track.guid || index} track={track} active={index === activeIndex} onSelect={() => setActiveIndex(index)} />
            ))}
          </ul>
        </>
      )}
      {project && <ChapterLinksTable tracks={project.tracks} refreshKey={chapterSyncRefresh} notify={notify} />}
    </div>
  );
}
