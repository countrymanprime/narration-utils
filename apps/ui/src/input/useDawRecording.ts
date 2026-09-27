import { useCallback, useEffect, useRef } from 'react';
import { useApi } from '../api/ApiContext';

/**
 * The DAW port's live recording state (input-commands-and-pedals.prd.md Phase 10), read from
 * `daw_transport_changed` (daw-port-and-capabilities.prd.md Phase 9, `{playing, recording, position?}`) for
 * `<CommandRouter isRecording>`. Returns a stable function over a ref rather than React state: the router only
 * calls it from inside a gesture handler (Solution Detail, "Router" step 5), so a recording change need not
 * re-render anything mounted under it. `subscribeDawTransport` is pushed only - there is no request for it - so a
 * session with no live heartbeat yet answers `false` (not recording) rather than assuming the worst.
 */
export function useDawRecording(): () => boolean {
  const api = useApi();
  const recordingRef = useRef(false);

  useEffect(() => {
    recordingRef.current = false;
    return api.subscribeDawTransport((transport) => {
      recordingRef.current = transport.recording;
    });
  }, [api]);

  return useCallback(() => recordingRef.current, []);
}
