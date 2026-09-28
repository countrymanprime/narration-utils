import { useEffect, useState } from 'react';
import { useApi } from '../../api/ApiContext';

/**
 * Whether the Booth is showing *and* the DAW reports recording (booth-mode-and-companion-panel.prd.md Phase 5): the
 * toast dispatcher's guard for the no-sound, no-notification rule (ADR 0075/0076). `boothShowing` is App.tsx's own
 * reading of the route (stage-navigation-and-page-replacement.prd.md Phase 4: the Booth is a page, so the route says
 * whether it shows). Reactive, unlike `useDawRecording` (input-commands-and-pedals.prd.md Phase 10), which reads its own
 * transport subscription into a ref for a gesture-time check only - this hook's caller needs to notice the moment either
 * half clears, to release whatever toast it queued while this was true.
 */
export function useBoothRecording(boothShowing: boolean): boolean {
  const api = useApi();
  const [recording, setRecording] = useState(false);
  useEffect(() => api.subscribeDawTransport((transport) => setRecording(transport.recording)), [api]);
  return boothShowing && recording;
}
