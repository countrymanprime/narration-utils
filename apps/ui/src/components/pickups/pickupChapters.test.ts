import { describe, expect, it } from 'vitest';
import type { TrackItem, TracksProject } from '../../api/contracts/tracks';
import type { TrackMapping } from '../../api/contracts/chapterTrackMap';
import { chaptersAtPosition } from './pickupChapters';

function item(overrides: Partial<TrackItem>): TrackItem {
  return {
    guid: 'item',
    position: 0,
    length: 10,
    name: 'take.wav',
    sourceKind: 'WAVE',
    sourceFile: 'C:/take.wav',
    sourceAvailable: true,
    supported: true,
    takeGuid: 'take',
    sourceStart: 0,
    playRate: 1,
    ...overrides,
  };
}

function project(tracks: { guid: string; items: TrackItem[] }[]): TracksProject {
  return {
    path: 'C:/book.rpp',
    tracks: tracks.map((track, index) => ({ guid: track.guid, index, name: track.guid, color: '', muted: false, soloed: false, items: track.items })),
  };
}

const link = (trackGuid: string, chapterId: string): TrackMapping => ({ trackGuid, chapterId, chapterTitle: chapterId, confirmedAt: '2026-09-01T12:00:00Z' });
const CHAPTERS = [
  { id: 'c1', title: 'Down the Rabbit-Hole' },
  { id: 'c2', title: 'The Pool of Tears' },
];

describe('chaptersAtPosition', () => {
  it("finds the linked chapter whose track has an item under the pickup, with the pickup's place on the chapter player", () => {
    const tracks = project([{ guid: 't1', items: [item({ guid: 'a', position: 0, length: 10 }), item({ guid: 'b', position: 20, length: 10 })] }]);

    expect(chaptersAtPosition(24.5, tracks, [link('t1', 'c1')], CHAPTERS)).toEqual([{ chapterId: 'c1', title: 'Down the Rabbit-Hole', elapsed: 14.5 }]);
  });

  it('leaves out a track no chapter is linked to, and a gap between items', () => {
    const tracks = project([
      { guid: 't1', items: [item({ position: 0, length: 10 }), item({ position: 20, length: 10 })] },
      { guid: 'loose', items: [item({ position: 0, length: 100 })] },
    ]);

    expect(chaptersAtPosition(15, tracks, [link('t1', 'c1')], CHAPTERS)).toEqual([]);
  });

  it('names every chapter when linked tracks overlap in time, rather than guessing one', () => {
    const tracks = project([
      { guid: 't1', items: [item({ position: 0, length: 60 })] },
      { guid: 't2', items: [item({ position: 30, length: 60 })] },
    ]);

    expect(chaptersAtPosition(45, tracks, [link('t1', 'c1'), link('t2', 'c2')], CHAPTERS).map((match) => match.chapterId)).toEqual(['c1', 'c2']);
  });

  it('skips an item the app cannot play, since the chapter player could not seek to it', () => {
    const tracks = project([{ guid: 't1', items: [item({ position: 0, length: 10, sourceAvailable: false })] }]);

    expect(chaptersAtPosition(5, tracks, [link('t1', 'c1')], CHAPTERS)).toEqual([]);
  });

  it('scales the offset into an item by its play rate, matching the chapter player', () => {
    const tracks = project([{ guid: 't1', items: [item({ position: 10, length: 10, playRate: 2 })] }]);

    expect(chaptersAtPosition(12, tracks, [link('t1', 'c1')], CHAPTERS)[0].elapsed).toBe(4);
  });

  it('drops a link whose chapter is no longer in the manuscript', () => {
    const tracks = project([{ guid: 't1', items: [item({ position: 0, length: 10 })] }]);

    expect(chaptersAtPosition(5, tracks, [link('t1', 'gone')], CHAPTERS)).toEqual([]);
  });
});
