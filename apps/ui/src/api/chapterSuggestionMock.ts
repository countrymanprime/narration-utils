import type { ChapterCandidate, ChaptersForTracksEntry, ChaptersForTracksResult, ChapterSuggestion, TrackMapping } from './contracts/chapterTrackMap';
import type { ManuscriptChapter } from './contracts/manuscript';
import type { Track, TracksProject } from './contracts/tracks';
import { nameScore } from './chapterTrackMatchMock';

// The browser mock's stand-in for the host's ChapterSuggestion (apps/desktop/internal/chaptermatch/suggest.go, ADR
// 0113). The mock project's tracks carry no saved arm or selection on the wire, so the caller says which tracks are
// armed. Like the chapter-to-track mock it only covers what the mock project needs: a confirmed link, an exact or
// whole-word-prefix name (several prefixes are the Python matcher's shortest-title pick, only uncertain), and nothing.

type TrackAnswer = Pick<ChapterSuggestion, 'status' | 'chapter' | 'candidates'>;

const chapterCandidate = (chapter: ManuscriptChapter, score: number, source: ChapterCandidate['source']): ChapterCandidate => ({
  chapterId: chapter.id,
  chapterTitle: chapter.title,
  score,
  source,
  region: null,
});

function forTrack(track: Track, chapters: ManuscriptChapter[], mappings: TrackMapping[]): TrackAnswer {
  const exact = chapters.find((chapter) => nameScore(chapter.title, track.name) === 1);
  const prefixed = chapters.filter((chapter) => nameScore(chapter.title, track.name) === 0.95);
  const shortest = [...prefixed].sort((a, b) => a.title.length - b.title.length)[0];
  const best = exact ? chapterCandidate(exact, 1, 'track-name') : shortest && chapterCandidate(shortest, prefixed.length === 1 ? 0.95 : 0.9, 'track-name');
  const candidates = best ? [best] : [];

  const link = mappings.find((mapping) => mapping.trackGuid === track.guid);
  if (link) {
    const linked = chapters.find((chapter) => chapter.id === link.chapterId);
    if (!linked) return { status: 'none', chapter: null, candidates: [] };
    return { status: 'confirmed', chapter: chapterCandidate(linked, 1, 'confirmed'), candidates };
  }
  if (!best) return { status: 'none', chapter: null, candidates };
  return best.score >= 0.95 ? { status: 'matched', chapter: best, candidates } : { status: 'uncertain', chapter: null, candidates };
}

export function mockChapterSuggestion(
  chapters: ManuscriptChapter[],
  project: TracksProject,
  mappings: TrackMapping[],
  armed: readonly string[],
): ChapterSuggestion {
  const picked = project.tracks.filter((track) => armed.includes(track.guid));
  const base = { projectFile: project.path, savedAt: '2026-09-21T10:00:00Z', warnings: [] };
  if (picked.length === 0) return { ...base, basis: 'none', track: null, status: 'none', chapter: null, candidates: [] };
  const answers = picked.map((track) => forTrack(track, chapters, mappings));
  if (picked.length === 1) {
    const [track] = picked;
    return { ...base, basis: 'armed', track: { guid: track.guid, name: track.name, index: track.index }, ...answers[0] };
  }
  const first = answers[0].chapter;
  if (first && answers.every((answer) => answer.chapter?.chapterId === first.chapterId)) {
    const status = answers.every((answer) => answer.status === 'confirmed') ? 'confirmed' : 'matched';
    return { ...base, basis: 'armed', track: null, status, chapter: first, candidates: [first] };
  }
  const offered = answers.flatMap((answer) => (answer.chapter ? [answer.chapter, ...answer.candidates] : answer.candidates));
  const candidates = offered.filter((candidate, index) => offered.findIndex((other) => other.chapterId === candidate.chapterId) === index);
  return { ...base, basis: 'armed', track: null, status: candidates.length ? 'ambiguous' : 'none', chapter: null, candidates };
}

// The browser mock's stand-in for ChaptersForTracks (apps/desktop/chaptermatch.go, diagnostics-delivery-and-cleanup-
// tools PRD Phase 8 remainder): forTrack run over every requested GUID, each resolved to its own track first (a track
// GUID directly, or an item's or its active take's GUID) since the Review page's findings usually carry only one of
// those. A GUID that resolves to no track in the mock project answers with `error` instead of failing the others.
export function mockChaptersForTracks(
  guids: readonly string[],
  chapters: ManuscriptChapter[],
  project: TracksProject,
  mappings: TrackMapping[],
): ChaptersForTracksResult {
  const trackFor = (guid: string): Track | undefined =>
    project.tracks.find((track) => track.guid === guid || track.items.some((item) => item.guid === guid || item.takeGuid === guid));

  const tracks: Record<string, ChaptersForTracksEntry> = {};
  for (const guid of guids) {
    const track = trackFor(guid);
    tracks[guid] = track
      ? { ...forTrack(track, chapters, mappings), warnings: [] }
      : { status: '', chapter: null, candidates: [], warnings: [], error: `"${guid}" is not in the current project` };
  }
  return { projectFile: project.path, savedAt: '2026-09-21T10:00:00Z', tracks };
}
