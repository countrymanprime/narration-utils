// The `shell` rows of STATE_CATALOG (see state-catalog.ts), in the order they are captured.
import type { StateEntry } from '../lib/types';
import { REFLOW } from './shared';

export const shellStates: StateEntry[] = [
  // The header's page history (app-navigation-and-zoom-controls.prd.md Phase 1, Q1 A): the default states
  // already show both Back and Forward disabled at the first page, so that needs no row of its own. Captured
  // at the reflow width too (ADR 0061's declared extension, PRD Solution Detail): the header at 390px is what
  // the narrator sees at high zoom, and no shell state was captured there before.
  {
    page: 'shell',
    state: 'history-enabled',
    description: 'Header, after one navigation: Back enabled and focused (its focus ring), Forward disabled',
    ...REFLOW,
  },
  { page: 'shell', state: 'history-forward', description: 'Header, after a Back: both Back and Forward enabled', ...REFLOW },
  // The engine chip (stage-navigation-and-page-replacement.prd.md Phase 1, Q7), replacing the REAPER pill: its three
  // REAPER states are the existing default/`daw-not-linked`/mismatch captures of other pages' headers, so only the
  // two states nothing else reaches get their own row here.
  {
    page: 'shell',
    state: 'engine-builtin',
    description: 'Header engine chip in its "Built-in recorder" state (?mockEngine=builtin) - UI-only, nothing selects it yet',
    ...REFLOW,
  },
  {
    page: 'shell',
    state: 'engine-mismatch',
    description: 'Header engine chip reading "Wrong REAPER project open": a live heartbeat disagrees with the linked file',
    ...REFLOW,
  },
];
