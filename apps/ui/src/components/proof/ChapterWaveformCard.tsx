import { useEffect, useMemo, useState } from 'react';
import { useApi } from '../../api/ApiContext';
import type { WorkspaceAlignmentResult, WorkspacePeaksResult } from '../../api/contracts/workspace';
import type { TrackItem } from '../../api/contracts/tracks';
import type { ManuscriptChapter } from '../../types';
import { chapterName } from '../../chapterName';
import { Button } from '../primitives/Button';
import { Panel } from '../primitives/Panel';
import { Select } from '../primitives/Select';
import { buildFlags } from './flags';
import { buildPlaylist, totalDuration } from './playlist';
import { WaveformStrip } from './WaveformStrip';

type Loaded = { chapterId: string; items: TrackItem[]; alignment: WorkspaceAlignmentResult; peaks: WorkspacePeaksResult };

/**
 * Proof's waveform card at the book level (mock 04; ADR 0715, replacing the Rejected 0651 and 0652): the waveform belongs to
 * the chapter being viewed and follows this card's chapter selector, since each chapter is its own track and notes never span
 * chapters. It draws the same stored peaks and flags as the chapter view (`WaveformStrip`, the one waveform component), and a
 * chapter with no recording gets an honest empty state rather than an invented picture.
 */
export function ChapterWaveformCard({
  chapters,
  chapterId,
  onChapterChange,
  onOpenChapter,
  notesFiltered = false,
  onShowAllChapters,
}: {
  chapters: readonly ManuscriptChapter[];
  chapterId: string;
  onChapterChange: (chapterId: string) => void;
  onOpenChapter: (chapterId: string) => void;
  /** The notes table below is narrowed to this chapter: the card says so and offers the way back. */
  notesFiltered?: boolean;
  onShowAllChapters?: () => void;
}) {
  const api = useApi();
  const [loaded, setLoaded] = useState<Loaded>();
  const [failed, setFailed] = useState<string>();

  useEffect(() => {
    if (!chapterId) return;
    let active = true;
    setLoaded(undefined);
    setFailed(undefined);
    Promise.all([api.chapterTrackMapList(), api.tracksList(), api.workspaceAlignment(chapterId), api.workspacePeaks(chapterId)])
      .then(([mapping, project, alignment, peaks]) => {
        if (!active) return;
        const trackGuid = mapping.mappings.find((entry) => entry.chapterId === chapterId)?.trackGuid;
        setLoaded({ chapterId, items: project.tracks.find((track) => track.guid === trackGuid)?.items ?? [], alignment, peaks });
      })
      .catch(() => active && setFailed("Couldn't load this chapter's waveform."));
    return () => {
      active = false;
    };
  }, [api, chapterId]);

  const current = loaded?.chapterId === chapterId ? loaded : undefined;
  const playlist = useMemo(() => buildPlaylist(current?.items ?? []), [current]);
  const flags = useMemo(() => buildFlags(current?.alignment.tokens ?? [], current?.alignment.extras ?? []), [current]);
  const selected = chapters.find((chapter) => chapter.id === chapterId);

  if (chapters.length === 0) {
    return (
      <Panel label="Chapter waveform">
        <p className="text-sm text-[var(--text-muted)]">No chapters to show a waveform for yet.</p>
      </Panel>
    );
  }

  const duration = totalDuration(playlist);
  const noRecording = current !== undefined && playlist.length === 0 && failed === undefined;
  const chapterLabel = selected ? chapterName(selected) : 'This chapter';

  return (
    <Panel label="Chapter waveform" flush>
      <div className="px-3 py-2">
        {failed ? (
          <p role="alert" className="text-sm text-[var(--text-muted)]">
            {failed}
          </p>
        ) : noRecording ? (
          <PlaceholderWaveform label={`${chapterLabel} has no recording to draw yet`} />
        ) : current ? (
          <WaveformStrip
            bare
            playlist={playlist}
            alignmentItems={current.alignment.items}
            peaks={current.peaks}
            tokens={current.alignment.tokens}
            flags={flags}
            elapsed={0}
            duration={duration}
          />
        ) : null}
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs text-[var(--text-muted)]">0:00</span>
          <ChapterPicker chapters={chapters} chapterId={chapterId} onChapterChange={onChapterChange} onOpenChapter={onOpenChapter} />
          {notesFiltered && (
            <span className="flex flex-wrap items-center gap-2 text-xs text-[var(--text-muted)]">
              Notes below: this chapter only
              <Button variant="secondary" onClick={onShowAllChapters}>
                Show all chapters
              </Button>
            </span>
          )}
          <span className="ml-auto font-mono text-xs text-[var(--text-muted)]">{formatClock(duration)}</span>
        </div>
      </div>
    </Panel>
  );
}

// A fixed, deterministic bar pattern: it is drawn in grey and labelled as a placeholder, never as this chapter's audio.
const PLACEHOLDER_BARS = Array.from({ length: 96 }, (_, index) => 0.18 + 0.62 * Math.abs(Math.sin(index * 0.55) * Math.cos(index * 0.17)));

/** What the card draws for a chapter with no recording (ADR 0750, D100): a greyed-out waveform with an honest label. */
function PlaceholderWaveform({ label }: { label: string }) {
  return (
    <figure className="m-0 flex flex-col gap-1">
      <svg
        role="img"
        aria-label="Placeholder waveform, not this chapter's audio"
        viewBox="0 0 96 52"
        preserveAspectRatio="none"
        className="h-[52px] w-full opacity-40"
      >
        {PLACEHOLDER_BARS.map((bar, index) => (
          <rect key={index} x={index + 0.15} y={26 - 26 * bar} width={0.7} height={52 * bar} fill="var(--text-muted)" />
        ))}
      </svg>
      <figcaption className="text-sm text-[var(--text-muted)]">
        {label}. The grey shape is a placeholder, not this chapter's audio. Link a track to it, or record it, and its waveform appears here.
      </figcaption>
    </figure>
  );
}

function formatClock(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

/** The card's chapter selector and the button that opens that chapter's own view (`/proof/:chapterId`). */
function ChapterPicker({
  chapters,
  chapterId,
  onChapterChange,
  onOpenChapter,
}: {
  chapters: readonly ManuscriptChapter[];
  chapterId: string;
  onChapterChange: (chapterId: string) => void;
  onOpenChapter: (chapterId: string) => void;
}) {
  return (
    <>
      <Select
        label="Chapter to open"
        value={chapterId}
        onChange={onChapterChange}
        options={chapters.map((chapter) => ({ value: chapter.id, label: chapterName(chapter) }))}
      />
      <Button variant="secondary" disabled={!chapterId} onClick={() => onOpenChapter(chapterId)}>
        Open chapter
      </Button>
    </>
  );
}
