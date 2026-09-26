import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { segmentAtElapsed, totalDuration, type PlaylistSegment } from './playlist';

export const SKIP_SECONDS = 5;
export const SPEED_OPTIONS = [0.75, 1, 1.25, 1.5, 1.75, 2] as const;
export type PlaybackSpeed = (typeof SPEED_OPTIONS)[number];

/**
 * Plays a chapter's playlist (edit-and-proof-workspace.prd.md Phase 2, "The player"): one segment after another on
 * one `Audio` element, seeking to each segment's `sourceStart` on switch and stopping at its `sourceEnd` (via
 * `timeupdate`, since the browser's own `ended` only fires at the source file's own end - the same technique
 * `useRangePlayer` uses for a fixed range). Built on `useTrackPlayback`'s pattern (one ref-held `Audio`, native
 * events, `startPlayback`'s AbortError handling), extended to many segments and a narrator-chosen speed (EP17).
 */
export function useChapterPlayback(playlist: PlaylistSegment[], mediaUrl: (sourceFile: string) => string) {
  const audioRef = useRef<HTMLAudioElement | undefined>(undefined);
  if (!audioRef.current) audioRef.current = new Audio();
  const isPlayingRef = useRef(false);
  // Set by seekTo before a segment switch, so the segment-load effect below seeks to it instead of the segment's own
  // sourceStart. Cleared once consumed.
  const pendingSeekRef = useRef<number | undefined>(undefined);

  const [segmentIndex, setSegmentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [sourceTime, setSourceTime] = useState(0);
  const [loadError, setLoadError] = useState(false);
  const [speed, setSpeedState] = useState<PlaybackSpeed>(1);

  isPlayingRef.current = isPlaying;

  const segment = playlist[segmentIndex];
  const duration = useMemo(() => totalDuration(playlist), [playlist]);
  const elapsed = segment ? segment.elapsedStart + Math.max(0, sourceTime - segment.sourceStart) : 0;

  const startPlayback = useCallback((audio: HTMLAudioElement) => {
    audio.play().catch((reason: unknown) => {
      // A newer load interrupting this play() (switching segments, or a new seek) is expected, not a failure.
      if (reason instanceof DOMException && reason.name === 'AbortError') return;
      setIsPlaying(false);
      setLoadError(true);
    });
  }, []);

  // Advance to the next segment, or stop at the chapter's end, once the current one reaches its played range's end -
  // the trim `useTrackPlayback` used to ignore (it played the item's whole source file from 0).
  useEffect(() => {
    const audio = audioRef.current!;
    const advance = () => {
      const active = playlist[segmentIndex];
      if (segmentIndex + 1 < playlist.length) {
        setSegmentIndex((index) => index + 1);
      } else {
        audio.pause();
        setIsPlaying(false);
        if (active) setSourceTime(active.sourceEnd);
      }
    };
    const onTimeUpdate = () => {
      const active = playlist[segmentIndex];
      if (!active) return;
      if (audio.currentTime >= active.sourceEnd) {
        advance();
        return;
      }
      setSourceTime(audio.currentTime);
    };
    // The source file itself can end before the segment's declared sourceEnd (shorter than expected): still advance
    // rather than stall on a segment that never reaches the timeupdate check above (useTrackPlayback's same fix).
    const onEnded = advance;
    const onError = () => {
      setIsPlaying(false);
      setLoadError(true);
    };
    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('error', onError);
    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('error', onError);
    };
  }, [playlist, segmentIndex]);

  useEffect(() => {
    const audio = audioRef.current!;
    setLoadError(false);
    if (!segment) {
      audio.pause();
      audio.removeAttribute('src');
      setSourceTime(0);
      setIsPlaying(false);
      return;
    }
    audio.src = mediaUrl(segment.sourceFile);
    audio.playbackRate = speed;
    const startAt = pendingSeekRef.current ?? segment.sourceStart;
    pendingSeekRef.current = undefined;
    audio.currentTime = startAt;
    setSourceTime(startAt);
    if (isPlayingRef.current) startPlayback(audio);
    // speed is intentionally not a dependency: changing it while a segment is already loaded is handled by setSpeed
    // below, without reloading (and re-seeking) the source.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segment, mediaUrl, startPlayback]);

  useEffect(() => () => audioRef.current?.pause(), []);

  const play = useCallback(() => {
    if (!segment) return;
    startPlayback(audioRef.current!);
    setLoadError(false);
    setIsPlaying(true);
  }, [segment, startPlayback]);

  const pause = useCallback(() => {
    audioRef.current!.pause();
    setIsPlaying(false);
  }, []);

  const togglePlay = useCallback(() => (isPlaying ? pause() : play()), [isPlaying, play, pause]);

  /** Seeks to a point in the item named by itemGuid, at its own source time (already pre-rolled by the caller, EP5).
   * Clamped to the item's played range. No-op for an item not on the current playlist (stale, or not this track). */
  const seekToSource = useCallback(
    (itemGuid: string, targetSourceTime: number) => {
      const index = playlist.findIndex((candidate) => candidate.itemGuid === itemGuid);
      if (index === -1) return;
      const target = playlist[index];
      const clamped = Math.max(target.sourceStart, Math.min(target.sourceEnd, targetSourceTime));
      if (index === segmentIndex) {
        audioRef.current!.currentTime = clamped;
        setSourceTime(clamped);
      } else {
        pendingSeekRef.current = clamped;
        setSegmentIndex(index);
      }
    },
    [playlist, segmentIndex],
  );

  /** Seeks by a point on the app's own elapsed line (the transport's back/forward buttons), clamped to [0, duration]. */
  const seekToElapsed = useCallback(
    (targetElapsed: number) => {
      const located = segmentAtElapsed(playlist, targetElapsed);
      if (!located) return;
      seekToSource(located.segment.itemGuid, located.segment.sourceStart + (targetElapsed - located.segment.elapsedStart));
    },
    [playlist, seekToSource],
  );

  const skip = useCallback((seconds: number) => seekToElapsed(elapsed + seconds), [elapsed, seekToElapsed]);

  const setSpeed = useCallback((next: PlaybackSpeed) => {
    setSpeedState(next);
    const audio = audioRef.current!;
    audio.playbackRate = next;
    // Pitch-kept speed (EP17): the browser's own time-stretcher, not REAPER's - "the app plays raw sources".
    (audio as HTMLAudioElement & { preservesPitch?: boolean; mozPreservesPitch?: boolean }).preservesPitch = true;
    (audio as HTMLAudioElement & { preservesPitch?: boolean; mozPreservesPitch?: boolean }).mozPreservesPitch = true;
  }, []);

  return {
    isPlaying,
    elapsed,
    duration,
    canPlay: Boolean(segment),
    loadError,
    speed,
    currentItemGuid: segment?.itemGuid,
    currentSourceTime: sourceTime,
    togglePlay,
    play,
    pause,
    skipBack: () => skip(-SKIP_SECONDS),
    skipForward: () => skip(SKIP_SECONDS),
    seekToSource,
    seekToElapsed,
    setSpeed,
  };
}
