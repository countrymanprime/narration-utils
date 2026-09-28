import { describe, expect, it } from 'vitest';
import type { TrackItem } from '../../api/contracts/tracks';
import { buildPlaylist, segmentAtElapsed, totalDuration } from './playlist';

function item(overrides: Partial<TrackItem> = {}): TrackItem {
  return {
    guid: '{item-1}',
    position: 0,
    length: 10,
    name: 'Item 1',
    sourceKind: 'audio',
    sourceFile: 'take1.wav',
    sourceAvailable: true,
    supported: true,
    takeGuid: '{take-1}',
    sourceStart: 0,
    playRate: 1,
    ...overrides,
  };
}

describe('buildPlaylist', () => {
  it('honours each item’s played range instead of the whole source file', () => {
    const [segment] = buildPlaylist([item({ sourceStart: 5, length: 3, playRate: 1 })]);
    expect(segment.sourceStart).toBe(5);
    expect(segment.sourceEnd).toBe(8);
  });

  it('scales the source span by the item’s play rate', () => {
    const [segment] = buildPlaylist([item({ sourceStart: 2, length: 4, playRate: 1.5 })]);
    expect(segment.sourceEnd).toBe(2 + 4 * 1.5);
  });

  it('orders items by position, not array order', () => {
    const playlist = buildPlaylist([item({ guid: '{b}', position: 10 }), item({ guid: '{a}', position: 0 })]);
    expect(playlist.map((segment) => segment.itemGuid)).toEqual(['{a}', '{b}']);
  });

  it('filters out unsupported and missing-source items', () => {
    const playlist = buildPlaylist([
      item({ guid: '{ok}' }),
      item({ guid: '{unsupported}', supported: false }),
      item({ guid: '{missing}', sourceAvailable: false }),
    ]);
    expect(playlist.map((segment) => segment.itemGuid)).toEqual(['{ok}']);
  });

  it('skips gaps between items on the elapsed line', () => {
    const playlist = buildPlaylist([item({ guid: '{a}', position: 0, length: 3 }), item({ guid: '{b}', position: 100, length: 4 })]);
    expect(playlist[0]).toMatchObject({ elapsedStart: 0, elapsedEnd: 3 });
    expect(playlist[1]).toMatchObject({ elapsedStart: 3, elapsedEnd: 7 });
  });

  it('flags an item that starts before the previous one ended, but keeps position order', () => {
    const playlist = buildPlaylist([item({ guid: '{a}', position: 0, length: 5 }), item({ guid: '{b}', position: 3, length: 2 })]);
    expect(playlist.map((segment) => segment.itemGuid)).toEqual(['{a}', '{b}']);
    expect(playlist[1].overlapsPrevious).toBe(true);
    expect(playlist[0].overlapsPrevious).toBe(false);
  });

  it('treats a missing play rate (0) as 1x, not a zero-length span', () => {
    const [segment] = buildPlaylist([item({ length: 5, playRate: 0 })]);
    expect(segment.sourceEnd).toBe(segment.sourceStart + 5);
  });
});

describe('totalDuration', () => {
  it('is zero for an empty playlist', () => {
    expect(totalDuration([])).toBe(0);
  });

  it('is the last segment’s elapsed end', () => {
    const playlist = buildPlaylist([item({ guid: '{a}', position: 0, length: 3 }), item({ guid: '{b}', position: 3, length: 4 })]);
    expect(totalDuration(playlist)).toBe(7);
  });
});

describe('segmentAtElapsed', () => {
  const playlist = buildPlaylist([item({ guid: '{a}', position: 0, length: 3 }), item({ guid: '{b}', position: 3, length: 4 })]);

  it('finds the segment owning a point in the middle', () => {
    expect(segmentAtElapsed(playlist, 5)?.segment.itemGuid).toBe('{b}');
    expect(segmentAtElapsed(playlist, 1)?.segment.itemGuid).toBe('{a}');
  });

  it('clamps below zero to the first segment', () => {
    expect(segmentAtElapsed(playlist, -10)?.index).toBe(0);
  });

  it('clamps past the end to the last segment', () => {
    expect(segmentAtElapsed(playlist, 999)?.index).toBe(1);
  });

  it('is undefined for an empty playlist', () => {
    expect(segmentAtElapsed([], 0)).toBeUndefined();
  });
});
