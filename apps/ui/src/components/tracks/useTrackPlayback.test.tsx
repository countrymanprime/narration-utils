// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTrackPlayback } from './useTrackPlayback';
import { WIRE_TRACKS_PROJECT } from '../../api/mockFixtures';

class FakeAudio extends EventTarget {
  src = '';
  currentTime = 0;
  duration = Number.NaN;
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

const tracks = WIRE_TRACKS_PROJECT.tracks;
const mediaUrl = (sourceFile: string) => sourceFile;

describe('useTrackPlayback', () => {
  it('stops and flags a load error when the audio element reports one', () => {
    const { result } = renderHook(() => useTrackPlayback(tracks, 0, vi.fn(), mediaUrl));
    act(() => result.current.togglePlay());
    expect(result.current.isPlaying).toBe(true);

    act(() => {
      audio().dispatchEvent(new Event('error'));
    });

    expect(result.current.isPlaying).toBe(false);
    expect(result.current.loadError).toBe(true);
  });

  it('clears a previous load error once playback is retried', () => {
    const { result } = renderHook(() => useTrackPlayback(tracks, 0, vi.fn(), mediaUrl));
    act(() => result.current.togglePlay());
    act(() => {
      audio().dispatchEvent(new Event('error'));
    });

    act(() => result.current.togglePlay());

    expect(result.current.loadError).toBe(false);
    expect(result.current.isPlaying).toBe(true);
  });

  it('clamps skipping to the start and end of the loaded audio', () => {
    const { result } = renderHook(() => useTrackPlayback(tracks, 0, vi.fn(), mediaUrl));
    audio().duration = 100;

    audio().currentTime = 90;
    act(() => result.current.skipForward());
    expect(audio().currentTime).toBe(100);

    audio().currentTime = 10;
    act(() => result.current.skipBackward());
    expect(audio().currentTime).toBe(0);
  });

  it('does not seek before the audio has loaded', () => {
    const { result } = renderHook(() => useTrackPlayback(tracks, 0, vi.fn(), mediaUrl));

    act(() => result.current.skipForward());

    expect(audio().currentTime).toBe(0);
  });

  it('moves between tracks through the caller and stops at both ends', () => {
    const onTrackIndexChange = vi.fn();
    const first = renderHook(() => useTrackPlayback(tracks, 0, onTrackIndexChange, mediaUrl));
    expect(first.result.current.hasPreviousTrack).toBe(false);
    act(() => first.result.current.previousTrack());
    expect(onTrackIndexChange).not.toHaveBeenCalled();
    act(() => first.result.current.nextTrack());
    expect(onTrackIndexChange).toHaveBeenLastCalledWith(1);

    const last = renderHook(() => useTrackPlayback(tracks, tracks.length - 1, onTrackIndexChange, mediaUrl));
    expect(last.result.current.hasNextTrack).toBe(false);
    onTrackIndexChange.mockClear();
    act(() => last.result.current.nextTrack());
    expect(onTrackIndexChange).not.toHaveBeenCalled();
  });
});
