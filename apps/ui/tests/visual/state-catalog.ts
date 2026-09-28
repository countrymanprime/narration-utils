import type { StateEntry } from './lib/types';
import { projectStates } from './catalog/project';
import { startupStates } from './catalog/startup';
import { scriptStates } from './catalog/script';
import { storybibleStates } from './catalog/storybible';
import { engineStates } from './catalog/engine';
import { boothStates } from './catalog/booth';
import { proofStates } from './catalog/proof';
import { proofChapterStates } from './catalog/proof-chapter';
import { pickupsStates } from './catalog/pickups';
import { masterStates } from './catalog/master';
import { productionStates } from './catalog/production';
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
  ...scriptStates,
  ...storybibleStates,
  ...engineStates,
  ...boothStates,
  ...proofStates,
  ...proofChapterStates,
  ...pickupsStates,
  ...masterStates,
  ...productionStates,
  ...settingsStates,
  ...globalStates,
  ...shellStates,
];
