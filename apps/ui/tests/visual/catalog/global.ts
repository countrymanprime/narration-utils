// The `global` rows of STATE_CATALOG (see state-catalog.ts), in the order they are captured.
import type { StateEntry } from '../lib/types';
import { TOOLTIP_CLOSES_ON_RESIZE, FREEZES_THE_CLOCK } from './shared';

export const globalStates: StateEntry[] = [
  // Global overlays (captured once against the Production home, not per-page)
  {
    page: 'global',
    state: 'tooltip',
    description: 'Global tooltip overlay',
    pointer: 'keep',
    sameAs: { of: 'production/info-tooltip', reason: 'The global overlay is captured by hovering the same Production info icon.' },
    ...TOOLTIP_CLOSES_ON_RESIZE,
  },
  {
    page: 'global',
    state: 'toast',
    description: 'Global toast overlay',
    sameAs: {
      of: 'proof-chapter/compare-toast',
      reason: 'The global overlay is captured by asking a Proof chapter view to suggest vocabulary hints, the same flow as its compare-toast.',
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
      of: 'production/no-data',
      reason: 'Only the icon-only rail shows tooltips; the full sidebar has nothing to hover.',
      viewports: ['desktop'],
    },
    ...TOOLTIP_CLOSES_ON_RESIZE,
  },

  // Theme smoke check (the Production home only, not the full page/state matrix - see
  // ADR 0010) - explicit Light/Dark selected via Settings > Appearance,
  // captured on the Production home across every viewport.
  {
    page: 'global',
    state: 'theme-light',
    description: 'The Production home with Light explicitly selected in Settings > Appearance',
  },
  { page: 'global', state: 'theme-dark', description: 'The Production home with Dark explicitly selected in Settings > Appearance' },
];
