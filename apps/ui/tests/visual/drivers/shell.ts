// How to reach each `shell` state in STATE_CATALOG (see app.drivers.ts).
import { settlePage } from '../helpers/settle';
import { type Driver, clickVisible, goToPage, homeLoaded, PAGE_HEADING } from './shared';

export const shellDrivers: Record<string, Driver> = {
  // app-navigation-and-zoom-controls.prd.md Phase 1: after one in-app move, Back is enabled and Forward
  // is not (the default states already show both disabled at the first page, so they need no row here).
  'history-enabled': async (page) => {
    // Story Bible, not Script: reaching any page by one nav click also enables Back there, so without a further
    // differentiator this state is just a copy of whatever page it landed on - and Script's reader carries its own
    // pre-existing nested-interactive debt (#155, catalogued as flake 3 on #509) this row has no reason to inherit.
    await goToPage(page, 'Story Bible');
    await page.locator('tr[data-row]').first().waitFor();
    // Focus Back for its ring and tooltip: a bare Shift press, with no Tab and no destination, flips Chromium's
    // input-modality heuristic to keyboard without moving focus anywhere, so the following script .focus() still
    // matches :focus-visible (button:focus-visible, components.css) instead of landing as a plain, invisible focus.
    await page.keyboard.press('Shift');
    await page.getByRole('button', { name: 'Back' }).focus();
    await page.getByRole('tooltip', { name: 'Back (Alt+Left)' }).waitFor();
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
