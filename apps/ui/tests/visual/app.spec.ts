// ui-atlas-kit 0.3.3 vendored: do not edit here. Change plugin/templates/core in the kit and run `ui-atlas sync`.
import { test } from '@playwright/test';
import { APP_DRIVERS } from './app.drivers';
import { captureState } from './lib/capture';
import { STATE_CATALOG } from './state-catalog';
import { VIEWPORTS } from './viewports';

// Screenshots the real app (booted by the webServer in
// playwright.config.ts) at every {page, state, viewport}. One test per
// combination so a failure names exactly what broke and the others still run.
// How each state is reached lives in app.drivers.ts; what is checked about each
// capture lives in lib/capture.ts and, across the whole run, global-setup.ts.
for (const entry of STATE_CATALOG) {
  const driver = APP_DRIVERS[entry.page]?.[entry.state];
  for (const viewport of [...VIEWPORTS, ...(entry.extraViewports ?? [])]) {
    const title = `${entry.page} / ${entry.state} / ${viewport.name}`;
    if (!driver) {
      // Allowed only with a stated reason (src/visualSuite.test.ts enforces it).
      test.skip(title, async () => {});
      continue;
    }
    test(title, async ({ page }) => {
      await captureState(page, entry, viewport, driver);
    });
  }
}
