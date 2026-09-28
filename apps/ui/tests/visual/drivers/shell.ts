// How to reach each `shell` state in STATE_CATALOG (see app.drivers.ts).
import { settlePage } from '../helpers/settle';
import { type Driver, clickVisible, goToPage, homeLoaded, PAGE_HEADING } from './shared';

export const shellDrivers: Record<string, Driver> = {
  // app-navigation-and-zoom-controls.prd.md Phase 1: after one in-app move, Back is enabled and Forward
  // is not (the default states already show both disabled at the first page, so they need no row here).
  'history-enabled': async (page) => {
    await goToPage(page, 'Script');
    // Reaching any page by one nav click also enables Back there, so the header alone is what tells this state apart
    // from the page it landed on: focus Back for its on-button focus ring (button:focus-visible, components.css), a
    // plain style on the button itself rather than a portalled popup that would need its own axe debt declaration.
    // A Tab first, regardless of where it lands: Chromium only matches :focus-visible for a later script .focus() once
    // the page's last real input was a key press, not the click the nav just made.
    await page.keyboard.press('Tab');
    await page.getByRole('button', { name: 'Back' }).focus();
  },
  // After a Back from that page, both Back and Forward are enabled.
  'history-forward': async (page) => {
    await goToPage(page, 'Script');
    await clickVisible(page, 'button', 'Back');
    await page.getByRole('heading', { level: 1, name: PAGE_HEADING.Home, exact: true }).waitFor();
  },
  // stage-navigation-and-page-replacement.prd.md Phase 1 (Q7): the UI-only "Built-in recorder" state, reachable only
  // through the mock flag since nothing on the host selects it yet.
  'engine-builtin': async (page) => {
    await page.goto('/?mockEngine=builtin');
    await settlePage(page);
    await homeLoaded(page);
    await page.getByLabel('Built-in recorder').waitFor();
  },
  // Phase 1: the header's mismatch state, simulating a live REAPER heartbeat whose open project disagrees with the
  // linked file (Phase 7, ADR 0092) - the mock never grows one on its own (see main.tsx).
  'engine-mismatch': async (page) => {
    await page.goto('/?mockDawMismatch=1');
    await settlePage(page);
    await homeLoaded(page);
    await page.getByRole('button', { name: /Wrong REAPER project open/ }).waitFor();
  },
};
