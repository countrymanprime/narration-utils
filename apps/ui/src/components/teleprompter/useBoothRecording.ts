import { useEffect, useState } from 'react';
import { useApi } from '../../api/ApiContext';
import { boothIsActive, subscribeBoothActive } from './boothActive';

/**
 * Whether the booth is mounted *and* the DAW reports recording (booth-mode-and-companion-panel.prd.md Phase 5): the
 * toast dispatcher's guard for the no-sound, no-notification rule (ADR 0075/0076). Reactive, unlike
 * `useDawRecording` (input-commands-and-pedals.prd.md Phase 10), which reads its own transport subscription into a
 * ref for a gesture-time check only - this hook's caller (App.tsx) needs to notice the moment either half clears,
 * to release whatever toast it queued while this was true.
 */
export function useBoothRecording(): boolean {
  const api = useApi();
  const [boothActive, setBoothActiveState] = useState(boothIsActive());
  const [recording, setRecording] = useState(false);

  useEffect(() => subscribeBoothActive(() => setBoothActiveState(boothIsActive())), []);
  useEffect(() => api.subscribeDawTransport((transport) => setRecording(transport.recording)), [api]);

  return boothActive && recording;
}
