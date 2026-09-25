// The chapter track button's state (chapter-track-link-control.prd.md Phase 2, Solution Detail's "Button states"
// table): one of seven states from a ChapterTrackLink, each with a distinct look and an accessible name that says
// the state out loud, since colour is never the only signal (WCAG 1.4.1).
import type { ChapterTrackLink } from '../../types';

export type ChapterTrackButtonState =
  | { kind: 'linked'; trackName: string; trackGuid: string }
  | { kind: 'renamed'; trackName: string; trackGuid: string }
  | { kind: 'suggested'; trackName: string; trackGuid: string }
  | { kind: 'ambiguous'; count: number }
  | { kind: 'missing' }
  | { kind: 'not_linked' };

/** Derives the button's state from one chapter's link (the matcher's status, its warnings and its confirmed links).
 * A missing track wins over every other signal: a chapter cannot be "linked" to a track that is gone. */
export function chapterTrackButtonState(link: ChapterTrackLink): ChapterTrackButtonState {
  if (link.warnings.includes('confirmed-track-missing')) return { kind: 'missing' };
  if (link.status === 'ambiguous' || link.warnings.includes('confirmed-links-conflict')) {
    return { kind: 'ambiguous', count: Math.max(link.candidates.length, link.links.length, 2) };
  }
  if (link.status === 'confirmed' && link.track) {
    const state = link.warnings.includes('confirmed-track-renamed') ? 'renamed' : 'linked';
    return { kind: state, trackName: link.track.trackName, trackGuid: link.track.trackGuid };
  }
  if ((link.status === 'matched' || link.status === 'uncertain') && link.track) {
    return { kind: 'suggested', trackName: link.track.trackName, trackGuid: link.track.trackGuid };
  }
  return { kind: 'not_linked' };
}

/** The button's accessible name (Solution Detail's examples: "Track for Chapter 6: CHAPTER SIX, linked"). */
export function chapterTrackButtonLabel(chapterTitle: string, state: ChapterTrackButtonState): string {
  switch (state.kind) {
    case 'linked':
      return `Track for ${chapterTitle}: ${state.trackName}, linked`;
    case 'renamed':
      return `Track for ${chapterTitle}: linked, track renamed to ${state.trackName}`;
    case 'suggested':
      return `Track for ${chapterTitle}: suggested ${state.trackName}, not confirmed`;
    case 'ambiguous':
      return `Track for ${chapterTitle}: ${state.count} possible tracks, choose one`;
    case 'missing':
      return `Track for ${chapterTitle}: linked track is missing`;
    case 'not_linked':
      return `Track for ${chapterTitle}: not linked`;
  }
}
