import type { ChapterTrackCandidate, ChapterTrackMatch, RecordedEnd, TrackMapping } from './contracts/chapterTrackMap';
import type { ManuscriptChapter } from './contracts/manuscript';
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

const nameScore = (chapterTitle: string, trackName: string): number => {
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

// The mock project's items carry no SOFFS or PLAYRATE on the wire, so the source runs from 0 to the item's own length.
export const mockRecordedEnd = (track: Track): RecordedEnd | null => {
  const last = track.items.reduce<Track['items'][number] | null>(
    (best, item) => (!best || item.position + item.length > best.position + best.length ? item : best),
    null,
  );
  if (!last) return null;
  return {
    projectTime: last.position + last.length,
    itemGuid: last.guid,
    takeGuid: '',
    sourceFile: last.sourceFile,
    sourceStart: 0,
    sourceTime: last.length,
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
