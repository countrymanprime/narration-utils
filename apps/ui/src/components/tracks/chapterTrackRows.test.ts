import { describe, expect, it } from 'vitest';
import { chapterTrackRows } from './chapterTrackRows';
import type { ManuscriptChapter, Track, TrackMapping } from '../../types';

function chapter(overrides: Partial<ManuscriptChapter> = {}): ManuscriptChapter {
  return { id: 'chapter-1', title: 'Chapter One', index: 0, wordCount: 10, status: 'not_started', ...overrides };
}

function track(overrides: Partial<Track> = {}): Track {
  return { guid: 'guid-1', index: 0, name: 'Chapter 1', color: '', muted: false, soloed: false, items: [], ...overrides };
}

function mapping(overrides: Partial<TrackMapping> = {}): TrackMapping {
  return { trackGuid: 'guid-1', chapterId: 'chapter-1', chapterTitle: 'Chapter One', confirmedAt: '2026-01-01T00:00:00Z', ...overrides };
}

describe('chapterTrackRows', () => {
  it('reports a chapter with no confirmed mapping as unlinked', () => {
    const rows = chapterTrackRows([chapter()], [track()], []);

    expect(rows).toEqual([{ chapter: chapter(), state: 'unlinked' }]);
  });

  it('reports a chapter whose confirmed track still exists as linked, with the track name', () => {
    const rows = chapterTrackRows([chapter()], [track()], [mapping()]);

    expect(rows).toEqual([{ chapter: chapter(), mapping: mapping(), trackName: 'Chapter 1', state: 'linked' }]);
  });

  it('reports a chapter whose confirmed track no longer exists as missing_track, with no track name', () => {
    const rows = chapterTrackRows([chapter()], [track({ guid: 'a-different-guid' })], [mapping()]);

    expect(rows).toEqual([{ chapter: chapter(), mapping: mapping(), trackName: undefined, state: 'missing_track' }]);
  });

  it('hides reference chapters, which have no audio to link', () => {
    const rows = chapterTrackRows([chapter({ id: 'chapter-2', contentKind: 'reference' })], [track()], []);

    expect(rows).toEqual([]);
  });

  it('uses the first confirmed mapping when more than one points at the same chapter', () => {
    const first = mapping({ trackGuid: 'guid-1' });
    const second = mapping({ trackGuid: 'guid-2' });
    const rows = chapterTrackRows([chapter()], [track({ guid: 'guid-1' }), track({ guid: 'guid-2', name: 'Other' })], [first, second]);

    expect(rows).toEqual([{ chapter: chapter(), mapping: first, trackName: 'Chapter 1', state: 'linked' }]);
  });
});
