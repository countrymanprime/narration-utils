import type {
  ChapterTrackCandidate,
  ChapterTrackLinks,
  ChapterTrackLinksProject,
  ChapterTrackMatch,
  ChapterTrackSummary,
  RecordedEnd,
  TrackMapping,
} from './contracts/chapterTrackMap';
import type { ManuscriptChapter, RecordedUnavailable } from './contracts/manuscript';
import type { Track, TracksProject } from './contracts/tracks';

// The browser mock's stand-in for the host's chapter-to-track matcher (apps/desktop/internal/chaptermatch, ADR 0110).
// It covers only what the mock project needs to show every status: a confirmed link, an exact or whole-word-prefix
// name match (spelled-out numbers up to twenty read as digits, so "Chapter One" finds the "Chapter 1" track), a tie,
// and nothing. The real matcher (number-word merge, homophones, fuzzy fallback, regions) lives in Go only.

const NUMBER_WORDS = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
  'twenty',
];

const tokens = (text: string): string[] =>
  (text.toLowerCase().match(/[a-z0-9']+/g) ?? []).map((token) => {
    const number = NUMBER_WORDS.indexOf(token);
    return number >= 0 ? String(number) : token;
  });

export const nameScore = (chapterTitle: string, trackName: string): number => {
  const title = tokens(chapterTitle);
  const name = tokens(trackName);
  if (name.length === 0) return 0;
  if (name.join(' ') === title.join(' ')) return 1;
  return name.every((token, index) => title[index] === token) ? 0.95 : 0;
};

const candidate = (track: Track, score: number, source: ChapterTrackCandidate['source']): ChapterTrackCandidate => ({
  trackGuid: track.guid,
  trackName: track.name,
  trackIndex: track.index,
  score,
  source,
  region: null,
});

// The item's played range from the wire: from sourceStart for length * playRate seconds of source (tracks.RecordedEnd).
export const mockRecordedEnd = (track: Track): RecordedEnd | null => {
  const last = track.items.reduce<Track['items'][number] | null>(
    (best, item) => (!best || item.position + item.length > best.position + best.length ? item : best),
    null,
  );
  if (!last) return null;
  return {
    projectTime: last.position + last.length,
    itemGuid: last.guid,
    takeGuid: last.takeGuid,
    sourceFile: last.sourceFile,
    sourceStart: last.sourceStart,
    sourceTime: last.sourceStart + last.length * last.playRate,
    sourceAvailable: last.sourceAvailable,
    supported: last.supported,
    approximate: false,
  };
};

export function mockChapterTrackMatch(chapterId: string, chapters: ManuscriptChapter[], project: TracksProject, mappings: TrackMapping[]): ChapterTrackMatch {
  const chapter = chapters.find((entry) => entry.id === chapterId);
  if (!chapter) throw new Error('that chapter is not part of the current manuscript');
  const linkedElsewhere = new Set(mappings.filter((mapping) => mapping.chapterId !== chapterId).map((mapping) => mapping.trackGuid));
  const linked = project.tracks.filter((track) => mappings.some((mapping) => mapping.chapterId === chapterId && mapping.trackGuid === track.guid));
  const candidates = project.tracks
    .filter((track) => !linkedElsewhere.has(track.guid))
    .map((track) => candidate(track, nameScore(chapter.title, track.name), 'track-name'))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.trackIndex - b.trackIndex);

  const base = {
    chapterId,
    chapterTitle: chapter.title,
    projectFile: project.path,
    savedAt: '2026-09-21T10:00:00Z',
    tracks: project.tracks.map((track) => ({ guid: track.guid, name: track.name, index: track.index })),
  };
  const withTrack = (track: Track, chosen: ChapterTrackCandidate, status: ChapterTrackMatch['status']): ChapterTrackMatch => ({
    ...base,
    status,
    track: chosen,
    candidates,
    warnings: [],
    recordedEnd: mockRecordedEnd(track),
  });

  if (linked.length === 1) return withTrack(linked[0], candidate(linked[0], 1, 'confirmed'), 'confirmed');
  if (linked.length > 1) {
    const conflict = linked.map((track) => candidate(track, 1, 'confirmed'));
    return { ...base, status: 'ambiguous', track: null, candidates: conflict, warnings: ['confirmed-links-conflict'], recordedEnd: null };
  }
  if (candidates.length === 0) return { ...base, status: 'none', track: null, candidates, warnings: [], recordedEnd: null };
  if (candidates.length > 1 && candidates[0].score - candidates[1].score < 0.05) {
    return { ...base, status: 'ambiguous', track: null, candidates, warnings: [], recordedEnd: null };
  }
  const best = project.tracks.find((track) => track.guid === candidates[0].trackGuid);
  return best ? withTrack(best, candidates[0], 'matched') : { ...base, status: 'none', track: null, candidates: [], warnings: [], recordedEnd: null };
}

const summarizeTrack = (track: Track, mappings: TrackMapping[]): ChapterTrackSummary => {
  const ends = track.items.map((item) => item.position + item.length);
  return {
    guid: track.guid,
    index: track.index,
    name: track.name,
    color: track.color,
    muted: track.muted,
    soloed: track.soloed,
    itemCount: track.items.length,
    playableCount: track.items.filter((item) => item.sourceAvailable && item.supported).length,
    missingSourceCount: track.items.filter((item) => !item.sourceAvailable).length,
    unsupportedCount: track.items.filter((item) => item.sourceAvailable && !item.supported).length,
    span: track.items.length ? { start: Math.min(...track.items.map((item) => item.position)), end: Math.max(...ends) } : null,
    linkedChapterId: mappings.find((mapping) => mapping.trackGuid === track.guid)?.chapterId ?? '',
  };
};

const PROJECT_MESSAGE: Record<ChapterTrackLinksProject, string> = {
  ready: '',
  none: 'No REAPER project (.rpp) file was found in this project folder.',
  choose: 'Choose which REAPER project file to use on the Tracks page.',
  error: 'Could not read the REAPER project file.',
};

/** The mock's ChapterTrackLinks (chapter-track-link-control PRD Phase 1): every narration chapter's match against the
 * mock project, from mockChapterTrackMatch, plus each track's facts. A link to a track the project no longer has is
 * reported as missing, as the host does. */
export function mockChapterTrackLinks(
  chapters: ManuscriptChapter[],
  project: TracksProject,
  mappings: TrackMapping[],
  state: ChapterTrackLinksProject,
): ChapterTrackLinks {
  const ready = state === 'ready';
  const present = new Set(project.tracks.map((track) => track.guid));
  return {
    project: state,
    message: PROJECT_MESSAGE[state],
    projectFile: ready ? project.path : '',
    savedAt: ready ? '2026-09-21T10:00:00Z' : '',
    tracks: ready ? project.tracks.map((track) => summarizeTrack(track, mappings)) : [],
    chapters: chapters
      .filter((chapter) => chapter.contentKind !== 'reference' && chapter.contentKind !== 'opening')
      .map((chapter) => {
        const links = mappings.filter((mapping) => mapping.chapterId === chapter.id);
        if (!ready) {
          return { chapterId: chapter.id, chapterTitle: chapter.title, status: 'none', track: null, candidates: [], warnings: [], links, recordedEnd: null };
        }
        const match = mockChapterTrackMatch(chapter.id, chapters, project, mappings);
        const warnings = links.some((link) => !present.has(link.trackGuid)) ? [...match.warnings, 'confirmed-track-missing' as const] : match.warnings;
        return {
          chapterId: chapter.id,
          chapterTitle: chapter.title,
          status: match.status,
          track: match.track,
          candidates: match.candidates,
          warnings,
          links,
          recordedEnd: match.recordedEnd,
        };
      }),
  };
}

/** The mock's recorded length for a chapter (actual-recorded-column PRD Phase 2), by the host's rule: only a chapter with
 * one confirmed link to a track in the project has seconds, the union of its items (the mock has no mutes or lanes on
 * the wire); every other chapter says why not. */
export function mockRecordedLength(
  chapterId: string,
  project: TracksProject,
  mappings: TrackMapping[],
  projectReadable: boolean,
): { recordedSeconds: number } | { recordedUnavailable: RecordedUnavailable } {
  const links = mappings.filter((mapping) => mapping.chapterId === chapterId);
  if (links.length === 0) return { recordedUnavailable: 'unlinked' };
  if (!projectReadable) return { recordedUnavailable: 'no_project' };
  if (links.length > 1) return { recordedUnavailable: 'multiple_tracks' };
  const track = project.tracks.find((candidate) => candidate.guid === links[0].trackGuid);
  if (!track) return { recordedUnavailable: 'track_missing' };
  const spans = track.items.map((item) => [item.position, item.position + item.length]).sort((a, b) => a[0] - b[0]);
  let total = 0;
  let current: number[] | null = null;
  for (const span of spans) {
    if (current && span[0] <= current[1]) {
      current[1] = Math.max(current[1], span[1]);
      continue;
    }
    if (current) total += current[1] - current[0];
    current = [...span];
  }
  if (current) total += current[1] - current[0];
  return { recordedSeconds: total };
}
