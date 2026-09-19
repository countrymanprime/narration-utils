// ui-atlas-kit 0.1.0 vendored: do not edit here. Change plugin/templates/core in the kit and run `ui-atlas sync`.
import type { Page } from '@playwright/test';

const KILL_MOTION_CSS = `
  *, *::before, *::after {
    animation-duration: 0s !important;
    animation-delay: 0s !important;
    transition-duration: 0s !important;
    transition-delay: 0s !important;
    caret-color: transparent !important;
  }
`;

// Applied once per page load, before driving any state. Removes the usual
// sources of screenshot flakiness (web fonts not painted yet, in-flight
// network, CSS transitions catching mid-animation) so the same state always
// renders pixel-identically on repeat runs.
export async function settlePage(page: Page): Promise<void> {
  await page.addStyleTag({ content: KILL_MOTION_CSS });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForLoadState('networkidle');
}

// After a driver runs, let React commit and the browser paint twice so the shot
// is of the settled state, not a frame mid-update.
export async function settleFrames(page: Page): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  // A driver may have frozen the page clock, which also stops requestAnimationFrame; race a real-time
  // cap (this side of the wire) so a frozen page settles instead of hanging.
  const twoFrames = page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await Promise.race([twoFrames, new Promise<void>((resolve) => setTimeout(resolve, 300))]);
}

export function screenshotDir(pageName: string, state: string): string {
  return `screenshots/app/${pageName}/${state}`;
}

// Per-capture sidecar records (hash, contrast, overflow) that global-setup.ts's
// teardown validates once the whole run is done. Cleared at the start of a run.
export const RUN_DIR = 'screenshots/.run';

export function runRecordPath(viewport: string, pageName: string, state: string): string {
  return `${RUN_DIR}/${viewport}/${pageName}__${state}.json`;
}
