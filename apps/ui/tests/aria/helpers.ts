import type { Page } from '@playwright/test';
import * as appDrivers from '../visual/app.drivers';
import { APP_DRIVERS } from '../visual/app.drivers';
import { settlePage } from '../visual/helpers/settle';
import { REFLOW_VIEWPORT, VIEWPORTS, type Viewport } from '../visual/viewports';

// The desktop size of the visual suite, its 1024 px width (the icon rail) and its 390 px reflow width (where the navigation is a drawer). The aria suite has
// its own config, so it may open the drawer, which the visual matrix does not (ADR 0037, ADR 0061).
function viewportNamed(name: string): Viewport {
  const found = VIEWPORTS.find((viewport) => viewport.name === name);
  if (!found) throw new Error(`the visual suite has no viewport named "${name}" (tests/visual/viewports.ts): update tests/aria/helpers.ts`);
  return found;
}
export const DESKTOP: Viewport = viewportNamed('desktop');
export const NARROW: Viewport = REFLOW_VIEWPORT;
// Between md and 1400 px the labelled sidebar gives way to an icon-only rail.
export const RAIL: Viewport = viewportNamed('small-desktop');

// Boots the mock-backed app at a size and, when given, drives it to a catalog state with the visual suite's own driver: how a
// state is reached lives in one place (tests/visual/app.drivers.ts), so a renamed button is fixed once.
export async function openApp(page: Page, viewport: Viewport, state?: [page: string, state: string]): Promise<void> {
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  // The visual suite's optional seam (stubbed embeds, a slowed CPU), so both suites boot the app the same way.
  await (appDrivers as { beforeCapture?: (page: Page) => Promise<void> }).beforeCapture?.(page);
  await page.goto('/');
  await settlePage(page);
  if (!state) return;
  const [pageName, stateName] = state;
  const driver = APP_DRIVERS[pageName]?.[stateName];
  if (!driver) throw new Error(`no driver for ${pageName}/${stateName} in tests/visual/app.drivers.ts`);
  await driver(page);
}
