import type { StateEntry } from './lib/types';
import { projectStates } from './catalog/project';
import { startupStates } from './catalog/startup';
import { homeStates } from './catalog/home';
import { manuscriptStates } from './catalog/manuscript';
import { proofingStates } from './catalog/proofing';
import { storybibleStates } from './catalog/storybible';
import { tracksStates } from './catalog/tracks';
import { workspaceStates } from './catalog/workspace';
import { teleprompterStates } from './catalog/teleprompter';
import { reviewStates } from './catalog/review';
import { deliveryStates } from './catalog/delivery';
import { settingsStates } from './catalog/settings';
import { globalStates } from './catalog/global';
import { shellStates } from './catalog/shell';

export type { StateEntry };

// Every {page, state} pair captured by app.spec.ts, at every size in
// viewports.ts. This is the single naming authority for
// screenshots/app/<page>/<state>/<viewport>.png. app.spec.ts supplies its
// own driver (how to reach the state) keyed by page+state - see
// APP_DRIVERS in app.spec.ts.

// One file per page under catalog/ (their shared row metadata is catalog/shared.ts), in capture order.
export const STATE_CATALOG: StateEntry[] = [
  ...projectStates,
  ...startupStates,
  ...homeStates,
  ...manuscriptStates,
  ...proofingStates,
  ...storybibleStates,
  ...tracksStates,
  ...workspaceStates,
  ...teleprompterStates,
  ...reviewStates,
  ...deliveryStates,
  ...settingsStates,
  ...globalStates,
  ...shellStates,
];
