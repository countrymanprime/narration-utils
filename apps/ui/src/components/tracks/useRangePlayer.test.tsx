// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUDITION_POST_ROLL_SECONDS, AUDITION_PRE_ROLL_SECONDS, useRangePlayer } from './useRangePlayer';

class FakeAudio extends EventTarget {
  src = '';
  currentTime = 0;
  duration = Number.NaN;
  play = vi.fn().mockResolvedValue(undefined);
  pause = vi.fn();
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
const range = { sourceFile: 'take1.wav', rangeStart: 10, rangeEnd: 13 };

describe('useRangePlayer', () => {
  it('seeks to rangeStart minus the pre-roll and plays', () => {
    const { result } = renderHook(() => useRangePlayer(mediaUrl));

    act(() => result.current.play(range));

    expect(audio().src).toBe(mediaUrl('take1.wav'));
    expect(audio().currentTime).toBe(10 - AUDITION_PRE_ROLL_SECONDS);
    expect(audio().play).toHaveBeenCalledTimes(1);
    expect(result.current.isPlaying).toBe(true);
  });

  it('clamps the pre-roll seek to zero near the start of the file', () => {
    const { result } = renderHook(() => useRangePlayer(mediaUrl));

    act(() => result.current.play({ ...range, rangeStart: 0.5 }));

    expect(audio().currentTime).toBe(0);
  });

  it('stops itself at rangeEnd plus the post-roll instead of playing the whole file', () => {
    const { result } = renderHook(() => useRangePlayer(mediaUrl));
    act(() => result.current.play(range));

    act(() => {
      audio().currentTime = range.rangeEnd + AUDITION_POST_ROLL_SECONDS;
      audio().dispatchEvent(new Event('timeupdate'));
    });

    expect(audio().pause).toHaveBeenCalledTimes(1);
    expect(result.current.isPlaying).toBe(false);
  });

  it('loops back to the pre-roll start instead of stopping when loop is on', () => {
    const { result } = renderHook(() => useRangePlayer(mediaUrl));
    act(() => result.current.setLoop(true));
    act(() => result.current.play(range));
    audio().play.mockClear();

    act(() => {
      audio().currentTime = range.rangeEnd + AUDITION_POST_ROLL_SECONDS;
      audio().dispatchEvent(new Event('timeupdate'));
    });

    expect(audio().pause).not.toHaveBeenCalled();
    expect(audio().currentTime).toBe(range.rangeStart - AUDITION_PRE_ROLL_SECONDS);
    expect(audio().play).toHaveBeenCalledTimes(1);
    expect(result.current.isPlaying).toBe(true);
  });

  it('stops and flags a load error when the audio element reports one', () => {
    const { result } = renderHook(() => useRangePlayer(mediaUrl));
    act(() => result.current.play(range));

    act(() => {
      audio().dispatchEvent(new Event('error'));
    });

    expect(result.current.isPlaying).toBe(false);
    expect(result.current.loadError).toBe(true);
  });

  it('stop() pauses and clears isPlaying', () => {
    const { result } = renderHook(() => useRangePlayer(mediaUrl));
    act(() => result.current.play(range));

    act(() => result.current.stop());

    expect(audio().pause).toHaveBeenCalledTimes(1);
    expect(result.current.isPlaying).toBe(false);
  });

  it('does not act on a timeupdate before any range has played', () => {
    renderHook(() => useRangePlayer(mediaUrl));

    expect(() => {
      act(() => {
        audio().dispatchEvent(new Event('timeupdate'));
      });
    }).not.toThrow();
  });
});
