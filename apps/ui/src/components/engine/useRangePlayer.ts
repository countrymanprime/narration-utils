import { useCallback, useEffect, useRef, useState } from 'react';

// Fixed lead-in/trail-off around a matched span, matching the "pre/post roll" Q7 of
// take-review-pickups-duplicates-take-intelligence.prd.md asks for. Not a setting (YAGNI): nothing
// in the PRD calls for narrator tuning, and a constant keeps both audition sides consistent.
export const AUDITION_PRE_ROLL_SECONDS = 1.5;
export const AUDITION_POST_ROLL_SECONDS = 1.5;

export type AuditionRange = {
  sourceFile: string;
  rangeStart: number;
  rangeEnd: number;
};

/**
 * Plays one raw source range - a take-review finding member's own source file and matched span -
 * with a fixed pre/post roll, through the same `/media` route the audio engine panel player streams from
 * (Q7: no REAPER mutation, the app already has read access to the file). Two independent instances
 * (one per audition side) give the side-by-side A/B comparison; each stops itself at
 * `rangeEnd + AUDITION_POST_ROLL_SECONDS` instead of playing to the end of the whole source file,
 * and can loop back to `rangeStart - AUDITION_PRE_ROLL_SECONDS`.
 */
export function useRangePlayer(
  mediaUrl: (sourceFile: string) => string,
  // Proof's Play ±3 s (mock 04) plays a note with 3 s either side; every audition keeps the fixed roll above.
  roll: { pre: number; post: number } = { pre: AUDITION_PRE_ROLL_SECONDS, post: AUDITION_POST_ROLL_SECONDS },
) {
  const audioRef = useRef<HTMLAudioElement | undefined>(undefined);
  if (!audioRef.current) audioRef.current = new Audio();

  const [range, setRange] = useState<AuditionRange>();
  const [isPlaying, setIsPlaying] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [loop, setLoop] = useState(false);

  const rangeRef = useRef(range);
  rangeRef.current = range;
  const loopRef = useRef(loop);
  loopRef.current = loop;
  const rollRef = useRef(roll);
  rollRef.current = roll;

  useEffect(() => {
    const audio = audioRef.current!;
    const onTimeUpdate = () => {
      const active = rangeRef.current;
      if (!active) return;
      const stopAt = active.rangeEnd + rollRef.current.post;
      if (audio.currentTime < stopAt) return;
      if (loopRef.current) {
        audio.currentTime = Math.max(0, active.rangeStart - rollRef.current.pre);
        audio.play().catch((reason: unknown) => {
          // A newer play() interrupting this one (the narrator switched reads mid-loop) is expected, not a failure.
          if (reason instanceof DOMException && reason.name === 'AbortError') return;
          setIsPlaying(false);
          setLoadError(true);
        });
      } else {
        audio.pause();
        setIsPlaying(false);
      }
    };
    const onError = () => {
      setIsPlaying(false);
      setLoadError(true);
    };
    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('error', onError);
    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('error', onError);
    };
  }, []);

  // Unmount (dialog closed): stop playback rather than leaving audio running behind a closed dialog.
  useEffect(() => () => audioRef.current?.pause(), []);

  const play = useCallback(
    (next: AuditionRange) => {
      const audio = audioRef.current!;
      setLoadError(false);
      setRange(next);
      audio.src = mediaUrl(next.sourceFile);
      audio.currentTime = Math.max(0, next.rangeStart - rollRef.current.pre);
      setIsPlaying(true);
      audio.play().catch((reason: unknown) => {
        // A newer play() interrupting this one (switching reads quickly) is expected, not a failure.
        if (reason instanceof DOMException && reason.name === 'AbortError') return;
        setIsPlaying(false);
        setLoadError(true);
      });
    },
    [mediaUrl],
  );

  const stop = useCallback(() => {
    audioRef.current!.pause();
    setIsPlaying(false);
  }, []);

  return { isPlaying, loadError, loop, setLoop, play, stop, activeRange: range };
}
