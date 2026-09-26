// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlaylistSegment } from './playlist';
import { useChapterPlayback } from './useChapterPlayback';

class FakeAudio extends EventTarget {
  src = '';
  currentTime = 0;
  duration = Number.NaN;
  playbackRate = 1;
  play = vi.fn().mockResolvedValue(undefined);
  pause = vi.fn();
  removeAttribute = vi.fn();
}

const instances: FakeAudio[] = [];
const audio = () => instances[instances.length - 1];

beforeEach(() => {
  instances.length = 0;
  vi.stubGlobal(
    'Audio',
    class extends FakeAudio {
      constructor() {
        super();
        instances.push(this);
      }
    },
  );
});

afterEach(() => vi.unstubAllGlobals());

const mediaUrl = (sourceFile: string) => `/media?path=${sourceFile}`;

const playlist: PlaylistSegment[] = [
  { itemGuid: '{a}', sourceFile: 'a.wav', sourceStart: 5, sourceEnd: 8, elapsedStart: 0, elapsedEnd: 3, overlapsPrevious: false },
  { itemGuid: '{b}', sourceFile: 'b.wav', sourceStart: 0, sourceEnd: 4, elapsedStart: 3, elapsedEnd: 7, overlapsPrevious: false },
];

describe('useChapterPlayback', () => {
  it('loads the first segment at its own sourceStart, not 0', () => {
    const { result } = renderHook(() => useChapterPlayback(playlist, mediaUrl));
    expect(audio().src).toBe(mediaUrl('a.wav'));
    expect(audio().currentTime).toBe(5);
    expect(result.current.canPlay).toBe(true);
  });

  it('plays on togglePlay', () => {
    const { result } = renderHook(() => useChapterPlayback(playlist, mediaUrl));
    act(() => result.current.togglePlay());
    expect(audio().play).toHaveBeenCalledTimes(1);
    expect(result.current.isPlaying).toBe(true);
  });

  it('advances to the next segment once the current one reaches its own sourceEnd, not the file’s end', () => {
    const { result } = renderHook(() => useChapterPlayback(playlist, mediaUrl));
    act(() => {
      audio().currentTime = 8;
      audio().dispatchEvent(new Event('timeupdate'));
    });
    expect(audio().src).toBe(mediaUrl('b.wav'));
    expect(audio().currentTime).toBe(0);
    expect(result.current.elapsed).toBeCloseTo(3);
  });

  it('advances on the native ended event too, when the real file is shorter than the declared sourceEnd', () => {
    const { result } = renderHook(() => useChapterPlayback(playlist, mediaUrl));
    act(() => {
      audio().currentTime = 7; // short of the declared sourceEnd (8), as if the file itself ended here
      audio().dispatchEvent(new Event('ended'));
    });
    expect(audio().src).toBe(mediaUrl('b.wav'));
    expect(result.current.elapsed).toBeCloseTo(3);
  });

  it('stops at the end of the last segment', () => {
    const { result } = renderHook(() => useChapterPlayback(playlist, mediaUrl));
    act(() => result.current.togglePlay());
    act(() => {
      audio().currentTime = 8;
      audio().dispatchEvent(new Event('timeupdate'));
    });
    act(() => {
      audio().currentTime = 4;
      audio().dispatchEvent(new Event('timeupdate'));
    });
    expect(audio().pause).toHaveBeenCalled();
    expect(result.current.isPlaying).toBe(false);
    expect(result.current.elapsed).toBeCloseTo(7);
  });

  it('stops (not crash) on a native ended event with no next segment', () => {
    const { result } = renderHook(() => useChapterPlayback(playlist, mediaUrl));
    act(() => {
      audio().currentTime = 8;
      audio().dispatchEvent(new Event('timeupdate')); // now on segment b (the last one)
    });
    act(() => result.current.togglePlay());
    act(() => audio().dispatchEvent(new Event('ended')));
    expect(result.current.isPlaying).toBe(false);
  });

  it('reports duration as the playlist’s total played seconds', () => {
    const { result } = renderHook(() => useChapterPlayback(playlist, mediaUrl));
    expect(result.current.duration).toBe(7);
  });

  it('seekToSource jumps within the current segment without reloading it', () => {
    const { result } = renderHook(() => useChapterPlayback(playlist, mediaUrl));
    act(() => result.current.seekToSource('{a}', 7));
    expect(audio().play).not.toHaveBeenCalled();
    expect(audio().currentTime).toBe(7);
  });

  it('seekToSource clamps to the item’s played range', () => {
    const { result } = renderHook(() => useChapterPlayback(playlist, mediaUrl));
    act(() => result.current.seekToSource('{a}', 100));
    expect(audio().currentTime).toBe(8);
  });

  it('seekToSource on another segment switches to it and seeks there, not to its own sourceStart', () => {
    const { result } = renderHook(() => useChapterPlayback(playlist, mediaUrl));
    act(() => result.current.seekToSource('{b}', 2));
    expect(audio().src).toBe(mediaUrl('b.wav'));
    expect(audio().currentTime).toBe(2);
  });

  it('skipForward/skipBack move by SKIP_SECONDS on the elapsed line, crossing a segment boundary', () => {
    const { result } = renderHook(() => useChapterPlayback(playlist, mediaUrl));
    act(() => result.current.skipForward()); // 5s elapsed: into segment b at source time 2
    expect(audio().src).toBe(mediaUrl('b.wav'));
    expect(audio().currentTime).toBe(2);
  });

  it('setSpeed sets playbackRate and preserves pitch', () => {
    const { result } = renderHook(() => useChapterPlayback(playlist, mediaUrl));
    act(() => result.current.setSpeed(1.5));
    expect(audio().playbackRate).toBe(1.5);
    expect(result.current.speed).toBe(1.5);
  });

  it('canPlay is false for an empty playlist', () => {
    const { result } = renderHook(() => useChapterPlayback([], mediaUrl));
    expect(result.current.canPlay).toBe(false);
    expect(result.current.duration).toBe(0);
  });

  it('reports a load error and stops playing on the audio element’s error event', () => {
    const { result } = renderHook(() => useChapterPlayback(playlist, mediaUrl));
    act(() => result.current.togglePlay());
    act(() => audio().dispatchEvent(new Event('error')));
    expect(result.current.loadError).toBe(true);
    expect(result.current.isPlaying).toBe(false);
  });
});
