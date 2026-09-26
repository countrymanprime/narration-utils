import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Track } from '../../types';
import { buildPlaylist } from '../workspace/playlist';

const SKIP_SECONDS = 30;

/**
 * Owns playback of one track at a time: its playable items (supported kind,
 * resolved source) play back-to-back in project-time order, and moving
 * between tracks - not items - is the unit of "next"/"previous" navigation,
 * per the product decision this feature was scoped with. trackIndex is
 * controlled by the caller (shared with the track list's own selection)
 * rather than owned here, so selecting a track in the list and navigating
 * with next/previous track are the same state, not two that can drift apart.
 *
 * Each item's played range (`sourceStart` to `sourceStart + length * playRate`) is honoured through the same
 * `buildPlaylist` the chapter workspace's `useChapterPlayback` uses (edit-and-proof-workspace.prd.md Phase 2, "The
 * player"): playback starts at the item's trim point and stops there, instead of playing its source file from 0 to
 * its own end regardless of the trim. `currentTime`/`duration` stay relative to the item (0 at its start), same as
 * before the fix, but now bounded to the shorter of the item's declared span and the source file's real length -
 * a file trimmed to less than its declared span (unexpected, but not impossible) still can't play past its own end.
 */
export function useTrackPlayback(tracks: Track[], trackIndex: number, onTrackIndexChange: (index: number) => void, mediaUrl: (sourceFile: string) => string) {
  const audioRef = useRef<HTMLAudioElement | undefined>(undefined);
  if (!audioRef.current) audioRef.current = new Audio();
  const isPlayingRef = useRef(false);

  const [itemIndex, setItemIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [fileDuration, setFileDuration] = useState(0);
  const [loadError, setLoadError] = useState(false);

  isPlayingRef.current = isPlaying;

  const track = tracks[trackIndex];
  const playlist = useMemo(() => (track ? buildPlaylist(track.items) : []), [track]);
  const segment = playlist[itemIndex];
  // The shorter of the item's declared played span and the source file's real duration (once known, both already in
  // absolute file-time - the file's own end is never offset by where the item starts): a source trimmed shorter
  // than the item declares can't play past its own end either.
  const effectiveEnd = segment ? Math.min(segment.sourceEnd, fileDuration > 0 ? fileDuration : Infinity) : 0;
  const duration = segment ? Math.max(0, effectiveEnd - segment.sourceStart) : 0;

  useEffect(() => setItemIndex(0), [trackIndex]);

  const startPlayback = useCallback((audio: HTMLAudioElement) => {
    audio.play().catch((reason: unknown) => {
      // A newer load interrupting this play() (switching tracks) is expected, not a failure.
      if (reason instanceof DOMException && reason.name === 'AbortError') return;
      setIsPlaying(false);
      setLoadError(true);
    });
  }, []);

  useEffect(() => {
    const audio = audioRef.current!;
    const advance = () => {
      setItemIndex((index) => (index + 1 < playlist.length ? index + 1 : index));
      if (itemIndex + 1 >= playlist.length) setIsPlaying(false);
    };
    const onTimeUpdate = () => {
      const active = playlist[itemIndex];
      if (active && audio.currentTime >= active.sourceEnd) {
        advance();
        return;
      }
      setCurrentTime(active ? audio.currentTime - active.sourceStart : 0);
    };
    const onDuration = () => setFileDuration(audio.duration || 0);
    // The file itself can end before the item's declared sourceEnd (shorter than expected): still advance rather
    // than stall on an item that never reaches the timeupdate check above.
    const onEnded = advance;
    const onError = () => {
      setIsPlaying(false);
      setLoadError(true);
    };
    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('durationchange', onDuration);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('error', onError);
    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('durationchange', onDuration);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('error', onError);
    };
  }, [playlist, itemIndex]);

  useEffect(() => {
    const audio = audioRef.current!;
    setLoadError(false);
    setFileDuration(0);
    if (!segment) {
      audio.pause();
      audio.removeAttribute('src');
      setCurrentTime(0);
      setIsPlaying(false);
      return;
    }
    audio.src = mediaUrl(segment.sourceFile);
    audio.currentTime = segment.sourceStart;
    setCurrentTime(0);
    if (isPlayingRef.current) startPlayback(audio);
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

  const skip = useCallback(
    (seconds: number) => {
      const audio = audioRef.current!;
      const active = playlist[itemIndex];
      // Reads audio.duration live rather than the fileDuration state: skipping is a direct response to a press, and
      // must not wait an extra render for a 'durationchange' that may already have fired before this component saw it.
      if (!active || !Number.isFinite(audio.duration)) return;
      const end = Math.min(active.sourceEnd, audio.duration);
      audio.currentTime = Math.max(active.sourceStart, Math.min(end, audio.currentTime + seconds));
      setCurrentTime(audio.currentTime - active.sourceStart);
    },
    [playlist, itemIndex],
  );

  const goToTrack = useCallback(
    (nextIndex: number) => {
      if (nextIndex < 0 || nextIndex >= tracks.length) return;
      onTrackIndexChange(nextIndex);
    },
    [tracks.length, onTrackIndexChange],
  );

  return {
    isPlaying,
    currentTime,
    duration,
    canPlay: Boolean(segment),
    loadError,
    togglePlay,
    skipForward: () => skip(SKIP_SECONDS),
    skipBackward: () => skip(-SKIP_SECONDS),
    nextTrack: () => goToTrack(trackIndex + 1),
    previousTrack: () => goToTrack(trackIndex - 1),
    hasNextTrack: trackIndex + 1 < tracks.length,
    hasPreviousTrack: trackIndex > 0,
  };
}
