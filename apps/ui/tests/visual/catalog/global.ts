// The `global` rows of STATE_CATALOG (see state-catalog.ts), in the order they are captured.
import type { StateEntry } from '../lib/types';
import { TOOLTIP_CLOSES_ON_RESIZE, FREEZES_THE_CLOCK } from './shared';

export const globalStates: StateEntry[] = [
  // Global overlays (captured once against Home, not per-page)
  {
    page: 'global',
    state: 'tooltip',
    description: 'Global tooltip overlay',
    pointer: 'keep',
    sameAs: { of: 'home/info-tooltip', reason: 'The global overlay is captured by hovering the same Home info icon.' },
    ...TOOLTIP_CLOSES_ON_RESIZE,
  },
  {
    page: 'global',
    state: 'toast',
    description: 'Global toast overlay',
    sameAs: {
      of: 'proofing/toast',
      reason: 'The global overlay is captured by asking Proofing to suggest vocabulary hints, the same flow as the Proofing toast.',
    },
    ...FREEZES_THE_CLOCK,
  },
  {
    page: 'global',
    state: 'confirm-dialog',
    description: 'Global confirm dialog overlay',
    sameAs: { of: 'storybible/delete-confirm', reason: 'The global overlay is captured by opening the same delete-entity confirm dialog.' },
  },
  {
    page: 'global',
    state: 'shortcut-sheet',
    description: 'The "?" shortcut sheet (input-commands-and-pedals.prd.md Phase 7), listing every command grouped by scope',
  },
  {
    page: 'global',
    state: 'nav-rail-tooltip',
    description:
      "Primary navigation - hovering an enabled icon in the icon-only rail shows that page's name; at desktop width there is no icon-only rail, so this is a no-op there",
    pointer: 'keep',
    sameAs: {
      of: 'home/default',
      reason: 'Only the icon-only rail shows tooltips; the full sidebar has nothing to hover.',
      viewports: ['desktop'],
    },
    ...TOOLTIP_CLOSES_ON_RESIZE,
  },

  // Theme smoke check (Home only, not the full page/state matrix - see
  // ADR 0010) - explicit Light/Dark selected via Settings > Appearance,
  // captured on Home across every viewport.
  {
    page: 'global',
    state: 'theme-light',
    description: 'Home with Light explicitly selected in Settings > Appearance',
    sameAs: { of: 'home/default', reason: 'Light is what Home already renders in by default, so explicitly selecting it changes nothing visible.' },
  },
  { page: 'global', state: 'theme-dark', description: 'Home with Dark explicitly selected in Settings > Appearance' },
];
