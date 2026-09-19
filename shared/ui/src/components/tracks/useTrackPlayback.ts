import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Track } from '../../types';

const SKIP_SECONDS = 30;

/**
 * Owns playback of one track at a time: its playable items (supported kind,
 * resolved source) play back-to-back in project-time order, and moving
 * between tracks - not items - is the unit of "next"/"previous" navigation,
 * per the product decision this feature was scoped with. trackIndex is
 * controlled by the caller (shared with the track list's own selection)
 * rather than owned here, so selecting a track in the list and navigating
 * with next/previous track are the same state, not two that can drift apart.
 */
export function useTrackPlayback(tracks: Track[], trackIndex: number, onTrackIndexChange: (index: number) => void, mediaUrl: (sourceFile: string) => string) {
  const audioRef = useRef<HTMLAudioElement | undefined>(undefined);
  if (!audioRef.current) audioRef.current = new Audio();
  const isPlayingRef = useRef(false);

  const [itemIndex, setItemIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [loadError, setLoadError] = useState(false);

  isPlayingRef.current = isPlaying;

  const track = tracks[trackIndex];
  const playableItems = useMemo(
    () => (track ? track.items.filter((entry) => entry.supported && entry.sourceAvailable).sort((a, b) => a.position - b.position) : []),
    [track],
  );
  const item = playableItems[itemIndex];

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
    const onTimeUpdate = () => setCurrentTime(audio.currentTime);
    const onDuration = () => setDuration(audio.duration || 0);
    const onEnded = () => {
      setItemIndex((index) => (index + 1 < playableItems.length ? index + 1 : index));
      if (itemIndex + 1 >= playableItems.length) setIsPlaying(false);
    };
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
  }, [playableItems.length, itemIndex]);

  useEffect(() => {
    const audio = audioRef.current!;
    setLoadError(false);
    if (!item) {
      audio.pause();
      audio.removeAttribute('src');
      setCurrentTime(0);
      setDuration(0);
      setIsPlaying(false);
      return;
    }
    audio.src = mediaUrl(item.sourceFile);
    setCurrentTime(0);
    if (isPlayingRef.current) startPlayback(audio);
  }, [item, mediaUrl, startPlayback]);

  useEffect(() => () => audioRef.current?.pause(), []);

  const play = useCallback(() => {
    if (!item) return;
    startPlayback(audioRef.current!);
    setLoadError(false);
    setIsPlaying(true);
  }, [item, startPlayback]);
  const pause = useCallback(() => {
    audioRef.current!.pause();
    setIsPlaying(false);
  }, []);
  const togglePlay = useCallback(() => (isPlaying ? pause() : play()), [isPlaying, play, pause]);

  const skip = useCallback((seconds: number) => {
    const audio = audioRef.current!;
    if (!Number.isFinite(audio.duration)) return;
    audio.currentTime = Math.max(0, Math.min(audio.duration, audio.currentTime + seconds));
  }, []);

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
    canPlay: Boolean(item),
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
