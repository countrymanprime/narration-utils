import { useEffect, useRef, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPlay, faStop } from '@fortawesome/free-solid-svg-icons';
import { useApi } from '../../api/ApiContext';
import { apiErrorMessage } from '../../api/errorMessage';
import type { ManuscriptChapter } from '../../api/contracts/manuscript';
import type { RecorderState, RecorderTake } from '../../api/contracts/recording';
import { Button } from '../primitives/Button';
import { Panel } from '../primitives/Panel';
import { SectionLabel } from '../primitives/SectionLabel';
import { Select } from '../primitives/Select';

/** A composed line id ("p-000001@abc123") back to the manuscript entity id it names (internal/recording.ParseLineID's
 * TS mirror: the last "@" is the separator, so a source checksum can never itself contain one that confuses parsing -
 * SHA-256 hex digests never do). */
function entityIdOf(lineId: string): string {
  const at = lineId.lastIndexOf('@');
  return at <= 0 ? lineId : lineId.slice(0, at);
}

/** Plays one take at a time through the media route, like BuiltinRecorder's own take player. */
function useTakePlayer() {
  const api = useApi();
  const audio = useRef<HTMLAudioElement | undefined>(undefined);
  const [playing, setPlaying] = useState<string>();
  useEffect(() => () => audio.current?.pause(), []);
  const element = () => {
    if (!audio.current) {
      audio.current = new Audio();
      audio.current.preload = 'none';
      audio.current.addEventListener('ended', () => setPlaying(undefined));
    }
    return audio.current;
  };
  return {
    playing,
    toggle: (take: RecorderTake) => {
      const player = element();
      if (playing === take.path) {
        player.pause();
        setPlaying(undefined);
        return;
      }
      player.src = api.mediaUrl(take.path);
      setPlaying(take.path);
      player.play().catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === 'AbortError') return;
        setPlaying(undefined);
      });
    },
  };
}

/**
 * Native takes (native-recording-suite PRD Phase 4, "take review integration"): the built-in recorder's takes
 * already assigned to a line of this chapter, grouped by line, next to REAPER-sourced take review on the same Proof
 * page - one take-review experience whatever the source (Phase 4's goal). The narrator marks one take the "keeper" of
 * its line (Q5: narrator-confirmed, always undoable by marking it again or choosing a different take of the same
 * line) and can assign a not-yet-assigned take to one of this chapter's paragraphs (Phase 3's SetTakeLine, first
 * reachable from the UI here). No editing: this only organizes takes already on disk (D86, record-and-organize only).
 */
export function NativeTakesPanel({ chapter }: { chapter: ManuscriptChapter }) {
  const api = useApi();
  const [state, setState] = useState<RecorderState>();
  const [pendingAssign, setPendingAssign] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const player = useTakePlayer();

  useEffect(() => {
    let live = true;
    const unsubscribe = api.subscribeRecorderState((next) => live && setState(next));
    void api
      .recorderState()
      .then((next) => live && setState(next))
      .catch(() => undefined);
    return () => {
      live = false;
      unsubscribe();
    };
  }, [api]);

  if (!state || state.takes.length === 0) return null;

  const paragraphIds = chapter.paragraphIds ?? [];
  const chapterEntityIds = new Set([chapter.id, ...paragraphIds.map((paragraph) => paragraph.id)]);
  const assigned = state.takes.filter((take) => take.lineId !== null && chapterEntityIds.has(entityIdOf(take.lineId)));
  // Offering not-yet-assigned takes for assignment is an active-recording-engine workflow (D67 mock-first behind
  // every port carries the same spirit here): a REAPER-only project's chapters stay uncluttered by it, while a take
  // already assigned and reviewed here (keeper marked or not) keeps showing regardless of which engine is current.
  const unassigned = state.engine === 'builtin' ? state.takes.filter((take) => take.lineId === null) : [];

  const groups = new Map<string, RecorderTake[]>();
  for (const take of assigned) {
    const key = take.lineId as string;
    groups.set(key, [...(groups.get(key) ?? []), take]);
  }

  const paragraphLabel = (entityId: string): string => {
    if (entityId === chapter.id) return chapter.title;
    const paragraph = paragraphIds.find((candidate) => candidate.id === entityId);
    return paragraph ? `Paragraph ${paragraph.index + 1}` : entityId;
  };

  const run = (takeName: string, action: () => Promise<RecorderState>) => {
    setBusy(takeName);
    setError(undefined);
    void action()
      .then(setState)
      .catch((reason: unknown) => setError(apiErrorMessage(reason)))
      .finally(() => setBusy(undefined));
  };

  if (assigned.length === 0 && (unassigned.length === 0 || paragraphIds.length === 0)) return null;

  return (
    <Panel title="Native takes">
      {[...groups.entries()].map(([lineId, takes]) => (
        <div key={lineId} className="mt-3 first:mt-0">
          <SectionLabel as="h3">{paragraphLabel(entityIdOf(lineId))}</SectionLabel>
          <ul aria-label={`Native takes of ${paragraphLabel(entityIdOf(lineId))}`} className="mt-1 divide-y divide-[var(--border)] text-sm">
            {takes.map((take) => {
              const playing = player.playing === take.path;
              return (
                <li key={take.name} className="flex items-center gap-2 py-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`${playing ? 'Stop' : 'Play'} ${take.name}`}
                    aria-pressed={playing}
                    onClick={() => player.toggle(take)}
                  >
                    <FontAwesomeIcon icon={playing ? faStop : faPlay} />
                  </Button>
                  <span className="min-w-0 flex-1 truncate">{take.name}</span>
                  <Button
                    variant="ghost"
                    aria-pressed={take.keeper}
                    pending={busy === take.name}
                    onClick={() => run(take.name, () => api.recorderSetTakeKeeper(take.name, !take.keeper))}
                  >
                    {take.keeper ? 'Keeper ✓ (undo)' : 'Mark keeper'}
                  </Button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      {unassigned.length > 0 && paragraphIds.length > 0 && (
        <div className="mt-3 first:mt-0">
          <SectionLabel as="h3">Not yet assigned to a line</SectionLabel>
          <ul aria-label="Native takes not yet assigned to a line" className="mt-1 divide-y divide-[var(--border)] text-sm">
            {unassigned.map((take) => {
              const playing = player.playing === take.path;
              return (
                <li key={take.name} className="flex flex-wrap items-center gap-2 py-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`${playing ? 'Stop' : 'Play'} ${take.name}`}
                    aria-pressed={playing}
                    onClick={() => player.toggle(take)}
                  >
                    <FontAwesomeIcon icon={playing ? faStop : faPlay} />
                  </Button>
                  <span className="min-w-0 flex-1 truncate">{take.name}</span>
                  <Select
                    label={`${take.name}'s line`}
                    value={pendingAssign[take.name] ?? ''}
                    onChange={(value) => setPendingAssign((prev) => ({ ...prev, [take.name]: value }))}
                    options={[
                      { value: '', label: 'Choose a paragraph…' },
                      ...paragraphIds.map((paragraph) => ({ value: paragraph.id, label: `Paragraph ${paragraph.index + 1}` })),
                    ]}
                  />
                  <Button
                    variant="ghost"
                    disabled={!pendingAssign[take.name]}
                    pending={busy === take.name}
                    onClick={() => run(take.name, () => api.recorderSetTakeLine(take.name, pendingAssign[take.name] ?? ''))}
                  >
                    Assign
                  </Button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm" style={{ color: 'var(--danger-text)' }}>
          {error}
        </p>
      )}
    </Panel>
  );
}
