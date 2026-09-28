// The `pickups` rows of STATE_CATALOG: the Pickups page (stage-navigation-and-page-replacement.prd.md Phase 7; the Tracks
// page's Pickups dialog, `tracks/pickups-*`, until then) (see state-catalog.ts), in the order they are captured.
import type { StateEntry } from '../lib/types';

export const pickupsStates: StateEntry[] = [
  {
    page: 'pickups',
    state: 'empty',
    description: 'Pickups, before any import - "No pickups yet", Next and Export disabled, and the pickup session slot saying it is not available yet',
  },
  {
    page: 'pickups',
    state: 'imported',
    description: 'Pickups after a completed proofer CSV import - remaining count and the import summary shown',
  },
  {
    page: 'pickups',
    state: 'import-errors',
    description: 'Pickups after importing a CSV with an unusable row - the row error listed, the usable row still counted',
  },
  {
    page: 'pickups',
    state: 'next',
    description:
      'Pickups after "Next pickup" with no chapter linked to a track - the pickup\'s time, tag and note, "Not on a linked chapter track" in place of a Proof link, "Punch from here" (gated on the DAW port\'s punch capability, booth-actions-enablement PRD Phase 3 - experimental and off by default, shown disabled here) and "Mark this pickup done"',
  },
  {
    page: 'pickups',
    state: 'next-in-chapter',
    description:
      'Pickups after "Next pickup" with Chapter 1 linked to its track (?mockChapterLink=confirmed) - the pickup\'s "Open Chapter 1 — Down the Rabbit-Hole in Proof" link to the chapter view at the pickup\'s own time',
  },
  {
    page: 'pickups',
    state: 'next-punch-enabled',
    description:
      'Pickups after "Next pickup" with the punch capability turned on directly (booth-actions-enablement PRD Phase 3, ?mockPunchCapabilityOn=1) - "Punch from here" enabled, moving REAPER\'s edit cursor straight to the pickup\'s own position with no preview step',
  },
  {
    page: 'pickups',
    state: 'error',
    description: 'Pickups when REAPER reports a problem - inline error message (reached via the ?mockPickups=error mock seam)',
  },
];
