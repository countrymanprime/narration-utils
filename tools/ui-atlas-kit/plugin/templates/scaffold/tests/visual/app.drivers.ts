import type { Page } from '@playwright/test';

export type Driver = (page: Page) => Promise<void>;

// The accessible name of the control that opens the navigation on narrow screens (if there is one).
const MOBILE_MENU_BUTTON = 'Open navigation';

// Click a control by accessible name, whichever copy of it is visible at this viewport. Waits for it
// first: only when it genuinely never shows up is the mobile menu opened, because a page that is merely
// still rendering must not get a drawer opened over it.
export async function clickVisible(page: Page, role: Parameters<Page['getByRole']>[0], name: string | RegExp): Promise<void> {
  const target = page.getByRole(role, { name, exact: typeof name === 'string' }).and(page.locator(':visible'));
  const appeared = await target
    .first()
    .waitFor({ state: 'visible', timeout: 1_500 })
    .then(
      () => true,
      () => false,
    );
  if (!appeared) {
    const menu = page.getByRole('button', { name: MOBILE_MENU_BUTTON });
    if (await menu.count()) await menu.click();
  }
  await target.first().click();
}

// Stops every page timer (setTimeout, requestAnimationFrame) where it stands, for the rare state a real
// timer would race (a toast that auto-dismisses). Install it per state, never page-wide: a fake clock left
// on for a whole run stops React 19 transitions.
export async function freezeClock(page: Page): Promise<void> {
  await page.clock.install();
  const now = await page.evaluate(() => Date.now());
  await page.clock.pauseAt(new Date(now + 10));
}

// Optional seam: runs before the app loads on every capture. Use it to stub third-party embeds and
// non-deterministic network (maps, chat widgets, analytics) with page.route, so the picture and the
// "no failed requests" check do not depend on someone else's server. Delete it if you do not need it.
// export async function beforeCapture(page: Page): Promise<void> {
//   await page.route('**/maps.googleapis.com/**', (route) => route.fulfill({ status: 200, body: '' }));
// }

// How to reach each {page, state} in STATE_CATALOG, through real UI interaction with accessible-name
// selectors. Waits are conditions (waitFor / expect), never waitForTimeout.
export const APP_DRIVERS: Record<string, Record<string, Driver>> = {
  home: {
    default: async () => {},
  },
};
