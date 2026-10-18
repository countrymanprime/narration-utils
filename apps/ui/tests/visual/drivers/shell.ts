// How to reach each `shell` state in STATE_CATALOG (see app.drivers.ts).
import { settlePage } from '../helpers/settle';
import { type Driver, clickVisible, goToPage, productionLoaded, PAGE_HEADING } from './shared';

export const shellDrivers: Record<string, Driver> = {
  // After one in-app move, Back is enabled and Forward
  // is not (the default states already show both disabled at the first page, so they need no row here).
  'history-enabled': async (page) => {
    // Story Bible, not Script: reaching any page by one nav click also enables Back there, so without a further
    // differentiator this state is just a copy of whatever page it landed on - and Script's reader carries its own
    // pre-existing nested-interactive debt (#155, catalogued as flake 3 on #509) this row has no reason to inherit.
    await goToPage(page, 'Story Bible');
    await page.getByRole('list', { name: 'Story Bible entries' }).getByRole('button').first().waitFor();
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
    await page.getByRole('heading', { level: 1, name: PAGE_HEADING.Production, exact: true }).waitFor();
  },
  // The "Built-in recorder" state, reached through the mock flag (?mockEngine=builtin).
  'engine-builtin': async (page) => {
    await page.goto('/?mockEngine=builtin');
    await settlePage(page);
    await productionLoaded(page);
    await page.getByLabel(/^Built-in: Recording happens in the app/).waitFor();
  },
  // The header's mismatch state, simulating a live REAPER heartbeat whose open project disagrees with the
  // linked file - the mock never grows one on its own (see main.tsx).
  'engine-mismatch': async (page) => {
    await page.goto('/?mockDawMismatch=1');
    await settlePage(page);
    await productionLoaded(page);
    await page.getByRole('button', { name: /^REAPER: A different project is open/ }).waitFor();
  },
  // The zoom group at a non-100% level (?mockZoom=125), so the enabled readout, Zoom out and reset can be
  // seen without driving Ctrl+wheel or a click first.
  'zoom-level': async (page) => {
    await page.goto('/?mockZoom=125');
    await settlePage(page);
    await productionLoaded(page);
    await page.getByRole('button', { name: /Reset zoom to 100% \(now 125%\)/ }).waitFor();
  },
  // The jump menu, opened from the header's button as a narrator would.
  'jump-menu-open': async (page) => {
    await productionLoaded(page);
    await page.getByRole('button', { name: /Jump to or run/ }).click();
    await page.getByRole('combobox', { name: 'Jump menu' }).waitFor();
  },
  // A right-click on the page's padding, where no provider owns the target: the shell's fallback menu.
  'context-menu-open': async (page) => {
    await productionLoaded(page);
    await page.locator('main .scroll-chrome-hidden').click({ button: 'right', position: { x: 6, y: 6 } });
    await page.getByRole('menu').waitFor();
  },
  'nav-off-note': async (page) => {
    await page.goto('/?mockNoManuscript=1');
    await settlePage(page);
    // Below `md` the navigation is the drawer; the item is in it. The pointer stays where the press left it, so the note is what is shown.
    const menuButton = page.getByRole('button', { name: 'Open navigation' });
    let scope = page.locator('aside:visible').first();
    if (await menuButton.isVisible()) {
      await menuButton.click();
      scope = page.getByRole('dialog', { name: 'Navigation' });
    }
    // Forced: Playwright reads aria-disabled as "not enabled" and would wait forever, but an off item takes the press (it opens the note).
    await scope.getByRole('button', { name: 'Proof' }).click({ force: true });
    await page.getByRole('dialog', { name: 'Proof is unavailable' }).waitFor();
  },
  'jump-menu-off-pages': async (page) => {
    await page.goto('/?mockNoManuscript=1');
    await settlePage(page);
    await page.getByRole('button', { name: /Jump to or run/ }).click();
    const field = page.getByRole('combobox', { name: 'Jump menu' });
    await field.fill('go to');
    await page.getByRole('option', { name: /^Go to Proof/ }).waitFor();
  },
  'history-panel-open': async (page) => {
    await productionLoaded(page);
    await page.getByRole('button', { name: 'History' }).click();
    await page.getByRole('dialog', { name: 'Undo history' }).waitFor();
  },
};
