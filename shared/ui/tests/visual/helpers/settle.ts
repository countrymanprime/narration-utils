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

export function screenshotDir(target: 'wireframe' | 'app', pageName: string, state: string): string {
  return `screenshots/${target}/${pageName}/${state}`;
}
