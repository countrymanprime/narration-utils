import { useCallback, useEffect, useRef, useState } from 'react';
import { useApi } from '../../api/ApiContext';
import { apiErrorMessage } from '../../api/errorMessage';
import { useAssetInstall } from '../../hooks/useAssetInstall';
import type { TeleprompterLocateResult, WhisperInstallJob } from '../../types';

export type LocateState = { kind: 'loading' } | { kind: 'failed'; message: string } | { kind: 'answered'; result: TeleprompterLocateResult };

/**
 * Asks the host where the chapter's recording ends (`TeleprompterLocate`, ADR 0111) once when the read-aloud dialog opens,
 * again for a track the narrator picks, and again after the Whisper model it needed was downloaded. It only reads; the
 * model download it may need waits for the narrator's confirm (`modelInstall` behind `WhisperModelPrompt`).
 *
 * `model` is the session's Whisper model, read when a lookup starts: changing it later does not re-run the transcription.
 */
export function useResumeLocate(chapterId: string, model: string) {
  const api = useApi();
  const [state, setState] = useState<LocateState>({ kind: 'loading' });
  const [asking, setAsking] = useState(false);
  const modelRef = useRef(model);
  useEffect(() => {
    modelRef.current = model;
  }, [model]);
  // Every lookup gets a number, and only the latest one may set the state: a slow answer for a track the narrator has
  // since changed (or for a dialog that closed) is dropped.
  const latest = useRef(0);
  const trackRef = useRef<string | undefined>(undefined);

  const locate = useCallback(
    (trackGuid?: string) => {
      const id = ++latest.current;
      trackRef.current = trackGuid;
      setState({ kind: 'loading' });
      const options = { model: modelRef.current, ...(trackGuid ? { trackGuid } : {}) };
      void api
        .teleprompterLocate(chapterId, options)
        .then((result) => id === latest.current && setState({ kind: 'answered', result }))
        .catch((reason) => id === latest.current && setState({ kind: 'failed', message: apiErrorMessage(reason) }));
    },
    [api, chapterId],
  );

  useEffect(() => {
    locate();
    return () => {
      latest.current += 1;
    };
  }, [locate]);

  const prompt = state.kind === 'answered' && state.result.status === 'asset_required' ? state.result : undefined;
  const modelInstall = useAssetInstall<WhisperInstallJob>({
    start: () => (prompt ? api.whisperInstall(prompt.model.id) : Promise.reject(new Error('Nothing to download.'))),
    state: (jobId) => api.whisperInstallState(jobId),
    cancel: (jobId) => api.whisperInstallCancel(jobId),
    onSuccess: () => {
      setAsking(false);
      locate(trackRef.current);
    },
  });

  const askForModel = () => {
    modelInstall.reset();
    setAsking(true);
  };
  const closeModelPrompt = () => {
    setAsking(false);
    modelInstall.reset();
  };
  const retry = () => locate(trackRef.current);

  // A locate only ever runs Whisper; the shared model prompt names the engine it installs for.
  const modelPrompt = asking && prompt ? { ...prompt, engine: 'whisper' as const } : undefined;
  return { state, locate, retry, prompt: modelPrompt, askForModel, closeModelPrompt, modelInstall };
}
