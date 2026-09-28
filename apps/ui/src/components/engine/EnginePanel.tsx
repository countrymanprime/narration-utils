import { useEffect, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faTriangleExclamation } from '@fortawesome/free-solid-svg-icons';
import { useApi } from '../../api/ApiContext';
import { Button } from '../primitives/Button';
import { Panel } from '../primitives/Panel';
import { SlideOver } from '../primitives/SlideOver';
import { StatusBadge } from '../primitives/StatusBadge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../primitives/Table';
import { Toolbar, ToolbarButton } from '../primitives/Toolbar';
import type { Notify } from '../primitives/Toast';
import { useStageRecommendations } from '../stages/useStageRecommendations';
import { ChapterLinksTable } from './ChapterLinksTable';
import { ChapterSyncPanel } from './ChapterSyncPanel';
import { ChapterTagsDialog } from './ChapterTagsDialog';
import { CleanupToolsDialog } from './CleanupToolsDialog';
import { CreateChapterRegionsDialog } from './CreateChapterRegionsDialog';
import { LinkChaptersDialog } from './LinkChaptersDialog';
import { RenderConfigDialog } from './RenderConfigDialog';
import { RetakeLanesDialog } from './RetakeLanesDialog';
import type { ManuscriptChapter, Track, TrackMapping, TracksDiscovery, TracksProject } from '../../types';

function basename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

type Tool = 'link-chapters' | 'render-config' | 'create-regions' | 'chapter-tags' | 'cleanup-tools' | 'retake-lanes';

export type EngineLinkState = {
  dawFileLinked: boolean;
  /** Whether a live REAPER heartbeat has been seen recently (ADR 0092); false also covers "unknown". */
  dawReachable: boolean;
  /** Whether that heartbeat's open project is the linked file; only meaningful when dawReachable is true. */
  dawProjectMatches: boolean;
  /** The shared "link a REAPER project file" action (project-workspace W19): the chip's old click, now the panel's button. */
  onLinkDawFile: () => void;
  linkingDawFile: boolean;
};

/**
 * The engine panel (stage-navigation-and-page-replacement.prd.md Phase 6, Q3 A, ADR 0407), opened from the header's engine
 * chip on any page. It holds what the Tracks page held that is about REAPER rather than a stage: the linked `.rpp` (link,
 * relink, or choose between several), the REAPER tools, chapter sync with its Sync activity (daw-chapter-track-auto-sync
 * Phases 3-4, mockup 02), and the track list with each track's chapter and the Chapter links table. The Tracks page's player
 * is gone: a chapter is heard in its Proof chapter view. Everything loads when the panel opens (a closed SlideOver is not
 * mounted), so the panel costs nothing on a page that never opens it.
 */
export function EnginePanel({ open, onClose, notify, link }: { open: boolean; onClose: () => void; notify: Notify; link: EngineLinkState }) {
  return (
    <SlideOver open={open} title="Audio engine" closeLabel="Close the engine panel" size="wide" headingLevel={2} onClose={onClose}>
      <EnginePanelBody notify={notify} link={link} />
    </SlideOver>
  );
}

function EnginePanelBody({ notify, link }: { notify: Notify; link: EngineLinkState }) {
  const api = useApi();
  const [discovery, setDiscovery] = useState<TracksDiscovery>();
  const [project, setProject] = useState<TracksProject>();
  const [error, setError] = useState('');
  const [chapters, setChapters] = useState<ManuscriptChapter[]>([]);
  const [mappings, setMappings] = useState<TrackMapping[]>([]);
  // Bumped by the chapter-sync panel's own actions (toggle, Link, Undo), so the track list and the Chapter links table re-read
  // the mapping they don't otherwise hear about (chapterTrackSet and chapterSyncSetEnabled send no event of their own).
  const [refresh, setRefresh] = useState(0);
  const [tool, setTool] = useState<Tool>();
  // Read-only here (chapter-stage-recommendations.prd.md Phase 9, D5), so onStatus is a no-op; a Link or a Change below is exactly
  // what resolves an unmapped_track/unconfirmed_mapping cause.
  const stages = useStageRecommendations({ refreshKey: String(refresh), notify, onStatus: () => {} });
  const unmappedCount = Array.from(stages.state.byChapter.values()).filter(
    (chapter) => chapter.causes.includes('unmapped_track') || chapter.causes.includes('unconfirmed_mapping'),
  ).length;

  useEffect(() => {
    let active = true;
    void api
      .manuscriptChapters()
      .then((next) => {
        if (active) setChapters(next);
      })
      .catch(() => {
        // Link chapters is an optional tool: a failed chapter load just leaves its button out (chapters stays empty) instead of
        // raising the panel's error line, which is for the REAPER project the panel exists to show.
      });
    return () => {
      active = false;
    };
  }, [api]);

  useEffect(() => {
    let active = true;
    void api
      .chapterTrackMapList()
      .then((next) => {
        if (active) setMappings(next.mappings);
      })
      .catch(() => {
        // Only names each track's chapter in the list below; without it the column reads "Not linked", and the Chapter links
        // table under it reports its own read failure.
      });
    return () => {
      active = false;
    };
  }, [api, refresh]);

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

  const hasTracks = !!project && project.tracks.length > 0;
  const closeTool = () => setTool(undefined);

  return (
    <div className="space-y-4">
      <ProjectSection discovery={discovery} link={link} onSelectRpp={selectRpp} />
      {error && (
        <p role="alert" className="text-sm" style={{ color: 'var(--danger-text)' }}>
          {error}
        </p>
      )}
      {hasTracks && (
        <Panel title="REAPER tools">
          <Toolbar label="REAPER tools" className="mt-2 flex-wrap">
            {chapters.length > 0 && <ToolbarButton render={<Button variant="ghost" onClick={() => setTool('link-chapters')} />}>Link chapters…</ToolbarButton>}
            <ToolbarButton render={<Button variant="ghost" onClick={() => setTool('render-config')} />}>Prepare chapter render…</ToolbarButton>
            <ToolbarButton render={<Button variant="ghost" onClick={() => setTool('create-regions')} />}>Create chapter regions…</ToolbarButton>
            <ToolbarButton render={<Button variant="ghost" onClick={() => setTool('chapter-tags')} />}>Embed chapter tags…</ToolbarButton>
            <ToolbarButton render={<Button variant="ghost" onClick={() => setTool('cleanup-tools')} />}>Cleanup tools…</ToolbarButton>
            <ToolbarButton render={<Button variant="ghost" onClick={() => setTool('retake-lanes')} />}>Retakes on lanes…</ToolbarButton>
          </Toolbar>
        </Panel>
      )}
      <ChapterSyncPanel notify={notify} onChanged={() => setRefresh((count) => count + 1)} />
      {project && project.tracks.length === 0 && (
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          This REAPER project has no tracks yet.
        </p>
      )}
      {hasTracks && <TrackList tracks={project.tracks} mappings={mappings} />}
      {project && unmappedCount > 0 && (
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          {unmappedCount === 1
            ? 'One chapter can’t get a stage suggestion until its track link is confirmed below.'
            : `${unmappedCount} chapters can’t get a stage suggestion until their track links are confirmed below.`}
        </p>
      )}
      {project && <ChapterLinksTable tracks={project.tracks} refreshKey={refresh} notify={notify} />}
      {tool === 'link-chapters' && project && <LinkChaptersDialog chapters={chapters} tracks={project.tracks} onClose={closeTool} />}
      {tool === 'render-config' && <RenderConfigDialog onClose={closeTool} />}
      {tool === 'create-regions' && project && <CreateChapterRegionsDialog tracks={project.tracks} onClose={closeTool} />}
      {tool === 'chapter-tags' && <ChapterTagsDialog onClose={closeTool} />}
      {tool === 'cleanup-tools' && <CleanupToolsDialog onClose={closeTool} />}
      {tool === 'retake-lanes' && <RetakeLanesDialog onClose={closeTool} />}
    </div>
  );
}

// The linked `.rpp` and its link action (Q3 A: "the linked .rpp (link, relink)"). The panel reads the project folder's `.rpp`
// through its own discovery flow, independent of the manifest link, so the link button is an extra "point at a different file"
// action beside it, not a gate (project-workspace W19: one binding, three call sites - here, Settings' DAW category, an import).
function ProjectSection({ discovery, link, onSelectRpp }: { discovery?: TracksDiscovery; link: EngineLinkState; onSelectRpp: (path: string) => void }) {
  const mismatch = link.dawFileLinked && link.dawReachable && !link.dawProjectMatches;
  return (
    <Panel
      title="REAPER project"
      actions={
        <Button variant="ghost" pending={link.linkingDawFile} onClick={link.onLinkDawFile}>
          {link.dawFileLinked ? 'Link a different REAPER project file' : 'Link a REAPER project file'}
        </Button>
      }
    >
      <div className="mt-2 space-y-2 text-sm">
        {discovery?.selected && (
          <div className="min-w-0">
            <div className="font-medium [overflow-wrap:anywhere]">{basename(discovery.selected)}</div>
            <div className="font-['IBM_Plex_Mono',ui-monospace,monospace] text-xs [overflow-wrap:anywhere]" style={{ color: 'var(--text-muted)' }}>
              {discovery.selected}
            </div>
          </div>
        )}
        {mismatch && (
          <p role="status" style={{ color: 'var(--warn-text)' }}>
            REAPER has a different project open than the one linked here. Link the open project, or switch REAPER to the linked file.
          </p>
        )}
        {!discovery && <p role="status">Looking for the REAPER project file…</p>}
        {discovery && discovery.candidates.length === 0 && (
          <p style={{ color: 'var(--text-muted)' }}>
            <b className="font-semibold" style={{ color: 'var(--text)' }}>
              No REAPER project file found.
            </b>{' '}
            This project folder doesn&rsquo;t contain a .rpp file. Save your REAPER project into the folder, then open this panel again.
          </p>
        )}
        {discovery && !discovery.selected && discovery.candidates.length > 1 && <RppPicker discovery={discovery} onSelect={onSelectRpp} />}
      </div>
    </Panel>
  );
}

function RppPicker({ discovery, onSelect }: { discovery: TracksDiscovery; onSelect: (path: string) => void }) {
  return (
    <div>
      <h3 className="section-label">Choose a REAPER project file</h3>
      <p className="mt-1" style={{ color: 'var(--text-muted)' }}>
        More than one .rpp file was found in this project folder. Choose which one to read tracks from.
      </p>
      <ul className="mt-2 space-y-1.5">
        {discovery.candidates.map((path) => (
          <li key={path}>
            <button
              type="button"
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 text-left font-['IBM_Plex_Mono',ui-monospace,monospace] text-sm [overflow-wrap:anywhere] hover:border-[var(--accent)]"
              onClick={() => onSelect(path)}
            >
              {path}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// The project's tracks with the chapter each one is linked to (Q3 A: "the track list with chapter links"). Read-only: a link is
// made or changed in Chapter links below, or by chapter sync above.
function TrackList({ tracks, mappings }: { tracks: Track[]; mappings: TrackMapping[] }) {
  return (
    <Panel title="Tracks">
      <Table label="Tracks" className="mt-2">
        <TableHead>
          <TableRow>
            <TableHeader>Track</TableHeader>
            <TableHeader>Chapter</TableHeader>
            <TableHeader align="right">Playable items</TableHeader>
          </TableRow>
        </TableHead>
        <TableBody>
          {tracks.map((track, index) => {
            const playable = track.items.filter((item) => item.supported && item.sourceAvailable).length;
            const hasIssue = track.items.some((item) => !item.supported || !item.sourceAvailable);
            const chapterTitles = mappings.filter((mapping) => mapping.trackGuid === track.guid).map((mapping) => mapping.chapterTitle);
            return (
              <TableRow key={track.guid || index}>
                <TableCell>
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="size-[10px] flex-none rounded-full" style={{ backgroundColor: track.color || 'var(--non-text)' }} aria-hidden="true" />
                    <span className="min-w-0 font-medium [overflow-wrap:anywhere]">{track.name || `Track ${track.index + 1}`}</span>
                    {track.muted && <StatusBadge tone="neutral" label="Muted" />}
                  </span>
                </TableCell>
                <TableCell style={{ color: chapterTitles.length > 0 ? undefined : 'var(--text-muted)' }}>
                  {chapterTitles.length > 0 ? chapterTitles.join(', ') : 'Not linked'}
                </TableCell>
                <TableCell align="right">
                  <span className="inline-flex items-center gap-1.5">
                    {hasIssue && (
                      <span title="This track has an item that can't be played" style={{ color: 'var(--danger-text)' }}>
                        <FontAwesomeIcon icon={faTriangleExclamation} aria-label="This track has an item that can't be played" />
                      </span>
                    )}
                    {playable}/{track.items.length}
                  </span>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Panel>
  );
}
