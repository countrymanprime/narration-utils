import { test } from '@playwright/test';
import { APP_DRIVERS } from './app.drivers';
import { captureAcrossViewports, captureState } from './lib/capture';
import { STATE_CATALOG } from './state-catalog';
import { VIEWPORTS } from './viewports';

// Screenshots the real app (booted by the webServer in playwright.config.ts) at every {page, state, viewport}. One test per
// {page, state}: it loads the app and drives to the state once, then resizes through the viewports of the default matrix
// (a row's extraViewports each get a fresh load), with a step per viewport so a failure still names the viewport, and
// every viewport is captured and checked even when an earlier one fails. A row with `reloadPerViewport` keeps one test per
// viewport, each on a freshly loaded page (the old shape), for a state whose driving or rendering depends on the width it
// was reached at. How each state is reached lives in
// app.drivers.ts; what is checked about each capture lives in lib/capture.ts and, across the whole run, run-checks.ts.
for (const entry of STATE_CATALOG) {
  const driver = APP_DRIVERS[entry.page]?.[entry.state];
  const viewports = [...VIEWPORTS, ...(entry.extraViewports ?? [])];
  const title = `${entry.page} / ${entry.state}`;
  if (!driver) {
    // Allowed only with a stated reason (src/visualSuite.test.ts enforces it).
    test.skip(title, async () => {});
    continue;
  }
  if (entry.reloadPerViewport) {
    for (const viewport of viewports) {
      test(`${title} / ${viewport.name}`, async ({ page }) => {
        await captureState(page, entry, viewport, driver);
      });
    }
    continue;
  }
  test(title, async ({ page }) => {
    await captureAcrossViewports(page, entry, VIEWPORTS, entry.extraViewports ?? [], driver);
  });
}
