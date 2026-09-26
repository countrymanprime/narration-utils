// The `proofing` rows of STATE_CATALOG (see state-catalog.ts), in the order they are captured.
import type { StateEntry } from '../lib/types';
import { TOOLTIP_CLOSES_ON_RESIZE, LIVE_PROGRESS_MOVES_ON, FREEZES_THE_CLOCK } from './shared';

export const proofingStates: StateEntry[] = [
  // Proofing
  { page: 'proofing', state: 'setup-default', description: 'Proofing, setup panel default selection' },
  { page: 'proofing', state: 'setup-alt-selection', description: 'Proofing, setup panel alternate model/worker/chunk selection' },
  { page: 'proofing', state: 'running', description: 'Proofing, running panel mid-progress with log', ...LIVE_PROGRESS_MOVES_ON },
  { page: 'proofing', state: 'results-row-expanded', description: 'Proofing, results table with one discrepancy row expanded' },
  {
    page: 'proofing',
    state: 'results-extra-row-expanded',
    description: 'Proofing, results table with an EXTRA (words heard but not written) discrepancy row expanded',
  },
  {
    page: 'proofing',
    state: 'disabled-button',
    description: 'Home with no manuscript - the Proofing action is locked and its tooltip says why',
    pointer: 'keep',
    ...TOOLTIP_CLOSES_ON_RESIZE,
  },
  { page: 'proofing', state: 'toast', description: 'Proofing, a toast visible', ...FREEZES_THE_CLOCK },
  {
    page: 'proofing',
    state: 'no-daw',
    description: 'Proofing setup with no linked REAPER project file (?mockNoDaw=1, PRD W16): Start comparison is disabled',
  },
  {
    page: 'proofing',
    state: 'no-daw-review',
    description:
      'Proofing reviewing the last completed comparison with no linked REAPER project file (?mockNoDaw=1, PRD W16): offline review stays reachable, but every Play recorded audio button and the marker Export button are disabled',
  },
];
