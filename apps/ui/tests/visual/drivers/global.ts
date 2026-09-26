// How to reach each `global` state in STATE_CATALOG (see app.drivers.ts).
import { type Driver, clickSettingsCategory, clickVisible, confirmDialog, freezeClock, goToPage } from './shared';

export const globalDrivers: Record<string, Driver> = {
  tooltip: async (page) => {
    await page.getByLabel('More information').hover();
    // TooltipTarget shows its tooltip 1s after hover - wait for it, don't race it.
    await page.getByRole('tooltip').waitFor();
  },
  'nav-rail-tooltip': async (page) => {
    // Only the icon-only rail (small-desktop and tablet widths) wraps its
    // buttons in a tooltip; the full sidebar shows labels already, so
    // hovering there changes nothing visible.
    // Icon-only buttons are the ones carrying an aria-label; the full
    // sidebar's button has the same accessible name from its text instead.
    const railButton = page.locator('button[aria-label="Tracks"]:visible');
    if (await railButton.count()) {
      await railButton.first().hover();
      // TooltipTarget waits 1s after hover before showing (focus shows it
      // immediately), so wait for it rather than screenshotting too early.
      await page.getByRole('tooltip').waitFor({ timeout: 3_000 });
    }
  },
  toast: async (page) => {
    await goToPage(page, 'Proofing');
    // Suggesting hints from the manuscript answers with a toast (adding a term answers with none), and an information toast
    // fades on a real 5 s timer: freeze timers so it cannot race the screenshot.
    await freezeClock(page);
    await clickVisible(page, 'button', 'Suggest from manuscript');
    await page.locator('[data-tone]').first().waitFor();
  },
  'confirm-dialog': async (page) => {
    await goToPage(page, 'Story Bible');
    await page.locator('tr[data-row]').first().click();
    const unlock = page.getByRole('button', { name: 'Unlock entry' });
    if (await unlock.count()) await unlock.click();
    await clickVisible(page, 'button', 'Edit this entry');
    await clickVisible(page, 'button', 'Delete entity');
    await confirmDialog(page, 'Delete entry').waitFor();
    // Base UI's scroll lock only reserves a scrollbar gutter on <html> when the document itself can scroll
    // (app-shell-vertical-overflow.prd.md): with the document locked, a modal over Story Bible - the state that
    // measured a full-height gutter before Phase 1's fix - must leave no inline scrollbar-gutter behind.
    await page.waitForFunction(() => document.documentElement.style.scrollbarGutter === '');
  },
  'theme-light': async (page) => {
    await goToPage(page, 'Settings');
    await clickVisible(page, 'tab', 'Global');
    await clickSettingsCategory(page, 'Appearance');
    await clickVisible(page, 'button', 'Light');
    await goToPage(page, 'Home');
  },
  'theme-dark': async (page) => {
    await goToPage(page, 'Settings');
    await clickVisible(page, 'tab', 'Global');
    await clickSettingsCategory(page, 'Appearance');
    await clickVisible(page, 'button', 'Dark');
    await goToPage(page, 'Home');
  },
};
