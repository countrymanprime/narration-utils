import { expect, test } from '@playwright/test';
import { DESKTOP, NARROW, RAIL, openApp } from './helpers';

// The role trees of the two shapes of the primary navigation (ADR 0051): the sidebar and the drawer that replaces it below
// `md`. The item list is pinned with `children: equal`, so an added, removed or reordered item fails here; everything else
// is matched partially. The snapshots are in tests/aria/snapshots (see docs/operations/verification-tooling.md).
test('the navigation lists exactly the pages, in order, with Settings after it', async ({ page }) => {
  await openApp(page, DESKTOP);
  await expect(page.getByRole('complementary')).toMatchAriaSnapshot({ name: 'navigation-sidebar.aria.yml' });
});

test('the drawer is a named modal dialog with the same list, and hides the page behind it', async ({ page }) => {
  await openApp(page, NARROW);
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('dialog', { name: 'Navigation' }).waitFor();
  await expect(page.locator('body')).toMatchAriaSnapshot({ name: 'navigation-drawer.aria.yml' });
});

test('the icon rail is a named region of buttons (no navigation landmark yet, #159)', async ({ page }) => {
  await openApp(page, RAIL);
  await expect(page.getByRole('complementary', { name: 'Primary navigation' })).toMatchAriaSnapshot({ name: 'navigation-rail.aria.yml' });
});

// app-navigation-and-zoom-controls.prd.md Phase 1 (Q1 A): Back and Forward are navigation, so they get the
// same role-tree pin as the other navigation shapes above.
test('the header names its page-history group, with Back and Forward', async ({ page }) => {
  await openApp(page, DESKTOP);
  await expect(page.getByRole('group', { name: 'Page history' })).toMatchAriaSnapshot({ name: 'navigation-header.aria.yml' });
});

// Phase 2 (Q1/Q9): the zoom group, pinned separately since it changes on a different schedule than Back/Forward
// (it steps with the level, not with navigation). The default boot is 100%, so the readout reads "100%" and is itself
// disabled (Q9 A).
test('the header names its zoom group, with zoom out, the reset readout and zoom in', async ({ page }) => {
  await openApp(page, DESKTOP);
  await expect(page.getByRole('group', { name: 'Zoom' })).toMatchAriaSnapshot({ name: 'navigation-header-zoom.aria.yml' });
});
