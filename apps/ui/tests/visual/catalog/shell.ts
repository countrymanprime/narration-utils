// The `shell` rows of STATE_CATALOG (see state-catalog.ts), in the order they are captured.
import type { StateEntry } from '../lib/types';
import { REFLOW } from './shared';

export const shellStates: StateEntry[] = [
  // The header's page history (app-navigation-and-zoom-controls.prd.md Phase 1, Q1 A): the default states
  // already show both Back and Forward disabled at the first page, so that needs no row of its own. Captured
  // at the reflow width too (ADR 0061's declared extension, PRD Solution Detail): the header at 390px is what
  // the narrator sees at high zoom, and no shell state was captured there before.
  { page: 'shell', state: 'history-enabled', description: 'Header, after one navigation: Back enabled, Forward disabled', ...REFLOW },
  { page: 'shell', state: 'history-forward', description: 'Header, after a Back: both Back and Forward enabled', ...REFLOW },
];
