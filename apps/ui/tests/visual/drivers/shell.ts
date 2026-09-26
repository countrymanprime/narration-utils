// How to reach each `shell` state in STATE_CATALOG (see app.drivers.ts).
import { type Driver, clickVisible, goToPage, PAGE_HEADING } from './shared';

export const shellDrivers: Record<string, Driver> = {
  // app-navigation-and-zoom-controls.prd.md Phase 1: after one in-app move, Back is enabled and Forward
  // is not (the default states already show both disabled at the first page, so they need no row here).
  'history-enabled': async (page) => {
    await goToPage(page, 'Manuscript');
  },
  // After a Back from that page, both Back and Forward are enabled.
  'history-forward': async (page) => {
    await goToPage(page, 'Manuscript');
    await clickVisible(page, 'button', 'Back');
    await page.getByRole('heading', { level: 1, name: PAGE_HEADING.Home, exact: true }).waitFor();
  },
};
