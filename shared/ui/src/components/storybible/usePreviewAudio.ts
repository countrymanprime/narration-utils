import { useCallback, useEffect, useRef, useState } from 'react';
import type { GuidePreview } from '../../types';

export const CANONICAL_PREVIEW = 'canonical';

export const previewKey = (aliasIndex?: number) => (aliasIndex === undefined ? CANONICAL_PREVIEW : `alias:${aliasIndex}`);

type AssetRequiredPreview = Extract<GuidePreview, { status: 'asset_required' }>;

type PreviewAudioOptions = {
  resetKey: unknown;
  requestPreview: (aliasIndex?: number) => Promise<GuidePreview>;
  onAssetRequired: (preview: AssetRequiredPreview, aliasIndex?: number) => void;
  notify: (message: string) => void;
};

/**
 * Owns the one active Story Bible pronunciation preview.  Rendering stays in
 * GuideDetail; this hook only coordinates the asynchronous preview request
 * and the browser Audio lifecycle.
 */
export function usePreviewAudio({ resetKey, requestPreview, onAssetRequired, notify }: PreviewAudioOptions) {
  const [playingPreview, setPlayingPreview] = useState<string>();
  const audioRef = useRef<HTMLAudioElement>();
  const activeKeyRef = useRef<string>();
  const requestRef = useRef(0);
  const callbacksRef = useRef({ requestPreview, onAssetRequired, notify });
  callbacksRef.current = { requestPreview, onAssetRequired, notify };

  const clear = useCallback((audio = audioRef.current) => {
    if (audio && audioRef.current === audio) {
      audio.onended = null;
      audio.onerror = null;
      audio.pause();
      audio.currentTime = 0;
      audioRef.current = undefined;
      activeKeyRef.current = undefined;
    }
    setPlayingPreview(undefined);
  }, []);

  const stop = useCallback(() => {
    requestRef.current += 1;
    clear();
  }, [clear]);

  useEffect(() => stop, [resetKey, stop]);

  const playPreview = useCallback(
    async (aliasIndex?: number) => {
      const target = previewKey(aliasIndex);
      const audio = audioRef.current;
      if (playingPreview === target && audio) {
        audio.pause();
        setPlayingPreview(undefined);
        return;
      }
      if (activeKeyRef.current === target && audio) {
        try {
          await audio.play();
          if (audioRef.current === audio) setPlayingPreview(target);
        } catch (error) {
          callbacksRef.current.notify(String(error));
        }
        return;
      }

      stop();
      const requestId = requestRef.current;
      try {
        const preview = await callbacksRef.current.requestPreview(aliasIndex);
        if (requestId !== requestRef.current) return;
        if (preview.status !== 'ready') {
          callbacksRef.current.onAssetRequired(preview, aliasIndex);
          return;
        }

        const nextAudio = new Audio(preview.url);
        audioRef.current = nextAudio;
        activeKeyRef.current = target;
        nextAudio.onended = () => clear(nextAudio);
        nextAudio.onerror = () => {
          if (audioRef.current !== nextAudio) return;
          clear(nextAudio);
          callbacksRef.current.notify('Preview audio could not be played.');
        };
        try {
          await nextAudio.play();
          if (requestId !== requestRef.current || audioRef.current !== nextAudio) {
            nextAudio.pause();
            return;
          }
          setPlayingPreview(target);
        } catch (error) {
          if (audioRef.current === nextAudio) clear(nextAudio);
          callbacksRef.current.notify(String(error));
        }
      } catch (error) {
        if (requestId === requestRef.current) callbacksRef.current.notify(String(error));
      }
    },
    [clear, playingPreview, stop],
  );

  return { playingPreview, playPreview, stopPreview: stop };
}
