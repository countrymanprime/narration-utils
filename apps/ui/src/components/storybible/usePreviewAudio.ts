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
 * The reason behind a rejection. Wails rejects with the host's error text as a
 * plain string; the browser rejects with a DOMException or Error. Neither should
 * reach the narrator as "Error: ..." or "[object Object]".
 */
function rejectionReason(error: unknown): string {
  const reason =
    error instanceof DOMException ? `${error.name}: ${error.message}` : error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  return reason.trim() || 'unknown error';
}

const sentence = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** Pausing a pending play() (stop, another alias, a new entry) rejects it on purpose; that is not a failure. */
const isDeliberateAbort = (error: unknown) => error instanceof DOMException && error.name === 'AbortError';

/** Decodes the host's base64 WAV, or says (through `fail`) why it cannot be played. */
function decodePreview(audioBase64: string, fail: (message: string) => void): Uint8Array<ArrayBuffer> | undefined {
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = Uint8Array.from(atob(audioBase64), (character) => character.charCodeAt(0));
  } catch {
    fail('The preview audio was not valid. Try playing it again.');
    return undefined;
  }
  if (bytes.length === 0) {
    fail('The preview audio was empty. Try playing it again.');
    return undefined;
  }
  return bytes;
}

/**
 * Owns the one active Story Bible pronunciation preview.  Rendering stays in
 * GuideDetail; this hook only coordinates the asynchronous preview request
 * and the browser Audio lifecycle.  Every failure ends in the idle state with a
 * message that names its cause, so pressing play again always retries.
 */
export function usePreviewAudio({ resetKey, requestPreview, onAssetRequired, notify }: PreviewAudioOptions) {
  const [playingPreview, setPlayingPreview] = useState<string>();
  const audioRef = useRef<HTMLAudioElement | undefined>(undefined);
  const activeKeyRef = useRef<string | undefined>(undefined);
  const objectUrlRef = useRef<string | undefined>(undefined);
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
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = undefined;
      }
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
          if (audioRef.current === audio && !isDeliberateAbort(error))
            callbacksRef.current.notify(`Preview audio could not be played (${rejectionReason(error)}).`);
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

        const bytes = decodePreview(preview.audioBase64, callbacksRef.current.notify);
        if (!bytes) return;
        const objectUrl = URL.createObjectURL(new Blob([bytes], { type: preview.mimeType }));
        objectUrlRef.current = objectUrl;
        const nextAudio = new Audio(objectUrl);
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
          // Already stopped, replaced, or reported through onerror: nothing more to say.
          if (audioRef.current !== nextAudio) return;
          clear(nextAudio);
          if (!isDeliberateAbort(error)) callbacksRef.current.notify(`Preview audio could not be played (${rejectionReason(error)}).`);
        }
      } catch (error) {
        if (requestId === requestRef.current) callbacksRef.current.notify(sentence(rejectionReason(error)));
      }
    },
    [clear, playingPreview, stop],
  );

  return { playingPreview, playPreview, stopPreview: stop };
}
