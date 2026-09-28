import { useEffect } from 'react';
import { RedirectKeepingLocation } from '../layout/RedirectKeepingLocation';
import { useOpenEnginePanel } from './EnginePanelContext';

/**
 * `/tracks`, retired by the engine panel (stage-navigation-and-page-replacement.prd.md Phase 6, ADR 0407). It lands on Proof
 * (Q8 A: its chapter picker is where a narrator now goes to hear a chapter), query and hash kept, and opens the engine panel
 * over it, since that is where the Tracks page's project, track list and REAPER tools went: an old bookmark or a link still
 * pointing here reaches both.
 */
export function RetiredTracksRoute() {
  const openEnginePanel = useOpenEnginePanel();
  useEffect(() => openEnginePanel(), [openEnginePanel]);
  return <RedirectKeepingLocation to="/proof" />;
}
