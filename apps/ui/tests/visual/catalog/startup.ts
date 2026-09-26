// The `startup` rows of STATE_CATALOG (see state-catalog.ts), in the order they are captured.
import type { StateEntry } from '../lib/types';

export const startupStates: StateEntry[] = [
  // Startup (before the app has a Bootstrap)
  {
    page: 'startup',
    state: 'invalid-payload',
    description: 'Startup error for a Bootstrap that did not match its schema - plain message, technical details, Retry and Copy details (ADR 0069)',
  },
];
