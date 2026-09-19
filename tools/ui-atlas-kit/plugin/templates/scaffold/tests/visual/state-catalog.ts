import type { StateEntry } from './lib/types';

export type { StateEntry };

// Every {page, state} pair captured by app.spec.ts, at every size in viewports.ts. This is the single
// naming authority for screenshots/app/<page>/<state>/<viewport>.png. How to reach each state lives in
// app.drivers.ts. See the ui-state-catalog skill for undriven / sameAs / pointer / mask.
export const STATE_CATALOG: StateEntry[] = [{ page: 'home', state: 'default', description: 'The app on first load' }];
