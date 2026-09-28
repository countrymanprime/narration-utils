import { describe, expect, it } from 'vitest';
import { buildFlagMarkers, buildWaveformSegments } from './waveformLayout';
import type { PlaylistSegment } from './playlist';
import type { WorkspaceItem, WorkspacePeaksResult, WorkspaceToken } from '../../api/contracts/workspace';
import type { Flag } from './flags';

function segment(overrides: Partial<PlaylistSegment> = {}): PlaylistSegment {
  return { itemGuid: 'g1', sourceFile: 'a.wav', sourceStart: 0, sourceEnd: 5, elapsedStart: 0, elapsedEnd: 5, overlapsPrevious: false, ...overrides };
}

describe('buildWaveformSegments', () => {
  it('lays a segment out in elapsed seconds, matching the playlist', () => {
    const segments = buildWaveformSegments([segment({ elapsedStart: 5, elapsedEnd: 15 })], [], undefined);
    expect(segments).toEqual([{ itemGuid: 'g1', start: 5, end: 15, label: 'Item 1', entry: undefined }]);
  });

  it("joins a segment to its WorkspacePeaks entry by the alignment item's index, not the playlist's own order", () => {
    const items: WorkspaceItem[] = [{ index: 3, itemGuid: 'g1', live: true }];
    const peaks: WorkspacePeaksResult = {
      chapterId: 'c',
      items: [{ index: 3, peaks: { startSeconds: 0, bucketsPerSecond: 50, buckets: 1, minMax: 'AAA=', sampleRate: 8000, channels: 1 } }],
    };
    const [result] = buildWaveformSegments([segment()], items, peaks);
    expect(result.entry?.index).toBe(3);
  });

  it('still gives an unmatched segment a slot, with no entry', () => {
    const peaks: WorkspacePeaksResult = { chapterId: 'c', items: [{ index: 0, reason: 'this item is no longer in the REAPER project' }] };
    const [result] = buildWaveformSegments([segment({ itemGuid: 'g2' })], [{ index: 0, itemGuid: 'g1', live: true }], peaks);
    expect(result.entry).toBeUndefined();
  });

  it('numbers segments by playlist order, one label per item', () => {
    const segments = buildWaveformSegments(
      [segment({ itemGuid: 'g1', elapsedStart: 0, elapsedEnd: 2 }), segment({ itemGuid: 'g2', elapsedStart: 2, elapsedEnd: 4 })],
      [],
      undefined,
    );
    expect(segments.map((s) => s.label)).toEqual(['Item 1', 'Item 2']);
  });
});

function flag(overrides: Partial<Flag> = {}): Flag {
  return { id: 'f1', kind: 'misread', label: 'Misread', tokenStart: 0, tokenEnd: 0, seekTokenIndex: 0, ...overrides };
}

describe('buildFlagMarkers', () => {
  const items: WorkspaceItem[] = [{ index: 0, itemGuid: 'g1', live: true }];
  const playlist: PlaylistSegment[] = [segment({ itemGuid: 'g1', sourceStart: 10, sourceEnd: 20, elapsedStart: 0, elapsedEnd: 10 })];

  it("places a flag at its seek token's elapsed time, with its own tone and label", () => {
    const tokens: WorkspaceToken[] = [{ i: 0, w: 0, text: 'x', status: 'misread', item: 0, start: 15, end: 15.5 }];
    const [marker] = buildFlagMarkers([flag()], tokens, items, playlist);
    expect(marker).toEqual({ id: 'f1', at: 5, tone: 'info', label: 'Misread' });
  });

  it('skips a flag with no seek target (a pure skip run)', () => {
    expect(buildFlagMarkers([flag({ seekTokenIndex: undefined })], [], items, playlist)).toEqual([]);
  });

  it('skips a flag whose token has no time or item', () => {
    const tokens: WorkspaceToken[] = [{ i: 0, w: 0, text: 'x', status: 'skip' }];
    expect(buildFlagMarkers([flag()], tokens, items, playlist)).toEqual([]);
  });
});
