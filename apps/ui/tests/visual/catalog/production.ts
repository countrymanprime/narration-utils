// The `production` rows of STATE_CATALOG (see state-catalog.ts), in the order they are captured.
import type { StateEntry } from '../lib/types';
import { KEEPS_DESKTOP_SCROLL } from './shared';

export const productionStates: StateEntry[] = [
  // Production (production-tracking.prd.md Phase 4, concept mock 01)
  {
    page: 'production',
    state: 'no-data',
    description:
      'Production before anything is logged or set - every undefined figure a dash with why (no measured time, no contracted amount, no delivery date), the chapter pipeline from the chapters\' statuses and stage suggestions with Prep and Delivery "Not available", and Next up with Start timer',
  },
  {
    page: 'production',
    state: 'on-pace',
    description:
      'Production with a time log, a delivery date 18 days out and a contracted amount (?mockProduction=on-pace) - hours by stage, PFH and the effective rate from logged hours and measured audio only, the running timer on Chapter 6 with Stop timer, and no Start timer while it runs',
  },
  {
    page: 'production',
    state: 'at-risk',
    description:
      'Production 3 days from its delivery date with chapters unfinished (?mockProduction=at-risk) - the delivery date as a warning, a higher PFH from more hours logged, and Next up led by the chapters whose stage is held back',
  },
  {
    page: 'production',
    state: 'plan',
    description:
      "Production's Delivery plan panel (?mockProduction=on-pace) with the ACX 15-minute checkpoint added from its template and not saved yet - the delivery date and contracted amount the figures use, each milestone's name, due date and note with Remove, and the template button off once the checkpoint is listed",
    ...KEEPS_DESKTOP_SCROLL,
  },
  // Status report export (production-tracking.prd.md Phase 5)
  {
    page: 'production',
    state: 'status-report',
    description:
      'Production (?mockProduction=on-pace) after Export status report - the HTML and JSON file names written to narration-utils/production/reports, and that the contracted amount and effective rate were left out (scrolled to the Status report panel)',
    ...KEEPS_DESKTOP_SCROLL,
  },
];
