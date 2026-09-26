import type { Page } from '@playwright/test';
import { THEME_STORAGE_KEY } from '../../src/theme/theme';
import type { Driver } from './drivers/shared';
import { projectDrivers } from './drivers/project';
import { startupDrivers } from './drivers/startup';
import { homeDrivers } from './drivers/home';
import { manuscriptDrivers } from './drivers/manuscript';
import { proofingDrivers } from './drivers/proofing';
import { storybibleDrivers } from './drivers/storybible';
import { tracksDrivers } from './drivers/tracks';
import { workspaceDrivers } from './drivers/workspace';
import { reviewDrivers } from './drivers/review';
import { deliveryDrivers } from './drivers/delivery';
import { teleprompterDrivers } from './drivers/teleprompter';
import { settingsDrivers } from './drivers/settings';
import { globalDrivers } from './drivers/global';
import { shellDrivers } from './drivers/shell';

// How to reach each {page, state} in STATE_CATALOG. Driven entirely through
// real UI interaction (clicks, hovers, drag-selection) using accessible-name
// selectors, since the app has no data-testid convention and its state lives
// in React, not globals. Kept apart from app.spec.ts (which registers Playwright
// tests at import time) so Vitest can check it against the catalog.
export type { Driver } from './drivers/shared';

// The accessibility rules an app state is known to violate (axe-debt.ts). Declaring the list turns on the axe gate of the vendored
// lib/capture.ts: every captured state is checked, and a violation the list does not declare fails it (docs/adr/0064). Read by name
// through a namespace import Knip cannot follow, hence @public.
/** @public */
export { AXE_DEBT as axeDebt } from './axe-debt';

// The document never scrolls: the page area (AppShell.tsx) is the app's one scroll container, and nothing under #root
// lays out against the document (app-shell-vertical-overflow.prd.md, ADR 0009 stays the rule for the page area itself).
// Turns on the vendored lib/capture.ts's vertical-overflow and escaped-absolute checks, with no per-row escape hatch.
/** @public */
export const documentScroll = 'locked';

// Two switches for a run of the suite, both off by default. The vendored lib/capture.ts calls this by name before every
// capture (a namespace import Knip cannot follow, hence @public).
//
// UI_CPU_THROTTLE=<factor> makes the page's CPU that many times slower (a busy CI runner is often 3 to 5 times slower than
// a developer machine), so a driver that races the render photographs the wrong page or times out here, on demand, instead
// of once in a while on CI.
//
// UI_THEME=dark (or light) starts every capture in that theme, so the whole suite can be looked at in dark: the app reads the
// same localStorage key the theme picker writes (theme/theme.ts). The suite still fails at its end on `theme-dark` and
// `reader-dark` matching their default states: that check is for the default run, so copy `screenshots/app` aside and use the PNGs.
/** @public */
export async function beforeCapture(page: Page): Promise<void> {
  await startInRequestedTheme(page);
  await throttleRequestedCpu(page);
}

async function startInRequestedTheme(page: Page): Promise<void> {
  const theme = process.env.UI_THEME;
  if (!theme) return;
  // A mistyped value must not turn into a light run that gets filed as the dark one.
  if (theme !== 'light' && theme !== 'dark') throw new Error(`UI_THEME must be "light" or "dark", got "${theme}"`);
  await page.addInitScript(([key, value]) => window.localStorage.setItem(key, value), [THEME_STORAGE_KEY, theme]);
}

async function throttleRequestedCpu(page: Page): Promise<void> {
  const requested = process.env.UI_CPU_THROTTLE;
  if (!requested) return;
  const rate = Number(requested);
  // A mistyped value must not turn into an unthrottled green run that looks like a stress test.
  if (!Number.isFinite(rate) || rate < 1) throw new Error(`UI_CPU_THROTTLE must be a number of at least 1, got "${requested}"`);
  if (rate === 1) return;
  const session = await page.context().newCDPSession(page);
  await session.send('Emulation.setCPUThrottlingRate', { rate });
}

// One file per page under drivers/ (the helpers they share are drivers/shared.ts); this is the map app.spec.ts reads.
export const APP_DRIVERS: Record<string, Record<string, Driver>> = {
  project: projectDrivers,
  startup: startupDrivers,
  home: homeDrivers,
  manuscript: manuscriptDrivers,
  proofing: proofingDrivers,
  storybible: storybibleDrivers,
  tracks: tracksDrivers,
  workspace: workspaceDrivers,
  review: reviewDrivers,
  delivery: deliveryDrivers,
  teleprompter: teleprompterDrivers,
  settings: settingsDrivers,
  global: globalDrivers,
  shell: shellDrivers,
};
