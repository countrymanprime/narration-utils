import type { Page } from '@playwright/test';

export type Driver = (page: Page) => Promise<void>;

// Optional, off by default: axe on the app's states (kit 0.3.4). Declaring the list of rules a state is known to violate turns the gate on:
// a violation it does not declare fails the capture, and a declared rule that stops being reported fails too (the list only shrinks).
// Measure first with `UI_AXE=1` (nothing fails; the teardown prints what axe found), fix what is cheap, then declare the rest with a
// reason and a tracking issue each. Needs `axe-core` as a devDependency. See the ui-state-catalog skill.
//
//   export { AXE_DEBT as axeDebt } from './axe-debt';   // export const AXE_DEBT: AxeDebt[] = []; (type from './lib/validators')

// The accessible name of the control that opens the navigation on narrow screens (if there is one).
const MOBILE_MENU_BUTTON = 'Open navigation';

// Click a control by accessible name, whichever copy of it is visible at this viewport. Playwright's own auto-wait for
// the click is the only wait: it never opens a menu, so it cannot open one over a page that is still rendering.
export async function clickVisible(page: Page, role: Parameters<Page['getByRole']>[0], name: string | RegExp): Promise<void> {
  await page
    .getByRole(role, { name, exact: typeof name === 'string' })
    .and(page.locator(':visible'))
    .first()
    .click();
}

// Click an item of the site navigation. Below the menu breakpoint the item exists only inside a drawer, so the drawer is
// opened first, and only when the layout says so: wait until either the item (wide layouts) or the menu button (narrow
// ones) is visible, and open the menu only if the menu button is showing and the item is not. The menu button must be
// hidden (display:none) whenever the navigation is not collapsed: if your app shows a same-named button at wide widths,
// give this helper another name for it. The wait only decides which of the two to click; it never guesses, so a page
// that is merely slow can never get a drawer opened over it (the failure a "wait 1.5 s, then open the menu" heuristic
// has). It is bounded only so that a viewport where neither shows fails with a message that says so.
const NAV_APPEAR_TIMEOUT_MS = 10_000;
export async function clickNav(page: Page, name: string | RegExp, role: Parameters<Page['getByRole']>[0] = 'link'): Promise<void> {
  const item = page
    .getByRole(role, { name, exact: typeof name === 'string' })
    .and(page.locator(':visible'))
    .first();
  const menu = page
    .getByRole('button', { name: MOBILE_MENU_BUTTON })
    .and(page.locator(':visible'))
    .first();
  try {
    await item.or(menu).first().waitFor({ state: 'visible', timeout: NAV_APPEAR_TIMEOUT_MS });
  } catch {
    throw new Error(`clickNav: neither the navigation item ${String(name)} nor a button named "${MOBILE_MENU_BUTTON}" became visible at this viewport`);
  }
  if (!(await item.isVisible()) && (await menu.isVisible())) await menu.click();
  await item.click();
}

// Stops every page timer (setTimeout, requestAnimationFrame) where it stands, for the rare state a real
// timer would race (a toast that auto-dismisses). Install it per state, never page-wide: a fake clock left
// on for a whole run stops React 19 transitions.
export async function freezeClock(page: Page): Promise<void> {
  await page.clock.install();
  const now = await page.evaluate(() => Date.now());
  await page.clock.pauseAt(new Date(now + 10));
}

// Optional seam: runs before the app loads on every capture. It is where you stub third-party embeds and
// non-deterministic network (maps, chat widgets, analytics) with page.route, so the picture and the "no failed
// requests" check do not depend on someone else's server:
//   await page.route('**/maps.googleapis.com/**', (route) => route.fulfill({ status: 200, body: '' }));
// It also carries the stress mode: UI_CPU_THROTTLE=<factor> makes the page's CPU that many times slower, so a driver
// that races the render (photographs the page it just left, or one still loading) fails here on demand instead of once
// in a while on a busy CI runner. Run the suite at 20 after writing or changing a driver. Off by default; a mistyped
// value throws instead of quietly running unthrottled. (`@public`: capture.ts reaches it through a namespace import that
// Knip cannot follow, so without the tag Knip would report it unused.)
/** @public */
export async function beforeCapture(page: Page): Promise<void> {
  const requested = process.env.UI_CPU_THROTTLE;
  if (!requested) return;
  const rate = Number(requested);
  if (!Number.isFinite(rate) || rate < 1) throw new Error(`UI_CPU_THROTTLE must be a number of at least 1, got "${requested}"`);
  if (rate === 1) return;
  const session = await page.context().newCDPSession(page);
  await session.send('Emulation.setCPUThrottlingRate', { rate });
}

// How to reach each {page, state} in STATE_CATALOG, through real UI interaction with accessible-name
// selectors. Waits are conditions (waitFor / expect), never waitForTimeout. End every navigation with a wait for the
// destination (its heading, then its content): a click returns when it is dispatched, not when the next page has rendered.
export const APP_DRIVERS: Record<string, Record<string, Driver>> = {
  home: {
    default: async () => {},
  },
};
