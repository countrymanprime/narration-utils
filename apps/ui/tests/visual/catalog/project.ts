// The `project` rows of STATE_CATALOG (see state-catalog.ts), in the order they are captured.
import type { StateEntry } from '../lib/types';

export const projectStates: StateEntry[] = [
  // Project (pre-app: no project folder attached yet)
  {
    page: 'project',
    state: 'picker-empty',
    description: 'No project open yet - ProjectPicker with a recent-projects list, browse, and create actions',
  },
];
