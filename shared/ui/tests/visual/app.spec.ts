import { test, type Page } from '@playwright/test';
import { STATE_CATALOG } from './state-catalog';
import { VIEWPORTS } from './viewports';
import { settlePage, screenshotDir } from './helpers/settle';

// Screenshots the real app (booted via the `dev:mock` webServer in
// playwright.config.ts) across every {page, state, viewport} in the state
// catalog. Driven entirely through real UI interaction (clicks, hovers,
// drag-selection) using accessible-name selectors, since the app has no
// `data-testid` convention and its state lives in React, not globals.
type Driver = (page: Page) => Promise<void>;

async function clickVisible(page: Page, role: Parameters<Page['getByRole']>[0], name: string | RegExp): Promise<void> {
  const target = page.getByRole(role, { name, exact: typeof name === 'string' }).and(page.locator(':visible'));
  // At the mobile viewport the nav rail is hidden entirely behind the
  // hamburger menu - AppShell only mounts a visible copy of it inside the
  // slide-in drawer once opened. If nothing matches yet, open the drawer
  // and retry before giving up.
  if ((await target.count()) === 0) {
    const hamburger = page.getByRole('button', { name: 'Open navigation' });
    if (await hamburger.count()) await hamburger.click();
  }
  await target.first().click();
}

async function goToPage(page: Page, name: 'Home' | 'Manuscript' | 'Proofing' | 'Story Bible' | 'Settings'): Promise<void> {
  if (name === 'Home') return; // App boots on Home.
  await clickVisible(page, 'button', name);
}

// Settings' own category rail (.settings-nav) reuses the same labels as the
// primary app nav ("Proofing", "Story Bible") - an unscoped role/name query
// matches both and .first() can silently click the wrong one (navigating
// away from Settings instead of switching category). Always scope category
// clicks to .settings-nav specifically.
async function clickSettingsCategory(page: Page, name: string): Promise<void> {
  await page.locator('.settings-nav').getByRole('button', { name, exact: true }).click();
}

// Some states have no known/safe driver yet (e.g. alias-typeahead, forcing
// the manuscript-not-found banner without a mock-data override seam). Those
// are left out here on purpose - the catalog entry is simply skipped.
const APP_DRIVERS: Record<string, Record<string, Driver>> = {
  home: {
    default: async () => {},
    'chapter-table-collapsed': async () => {},
    'chapter-table-expanded': async (page) => {
      await clickVisible(page, 'button', /Show per-chapter breakdown/);
    },
    'hint-chips': async (page) => {
      await goToPage(page, 'Proofing');
    },
    'info-tooltip': async (page) => {
      await page.getByLabel('More information').hover();
    },
  },
  manuscript: {
    'reader-text-small': async (page) => {
      await goToPage(page, 'Manuscript');
      await clickVisible(page, 'button', 'small');
    },
    'reader-text-medium': async (page) => {
      await goToPage(page, 'Manuscript');
      await clickVisible(page, 'button', 'medium');
    },
    'reader-text-large': async (page) => {
      await goToPage(page, 'Manuscript');
      await clickVisible(page, 'button', 'large');
    },
    'chapters-overlay-open': async (page) => {
      await goToPage(page, 'Manuscript');
      await clickVisible(page, 'button', 'Chapters & Search');
    },
    'detail-sidebar-note': async (page) => {
      await goToPage(page, 'Manuscript');
      await page.locator('.note-overlay').first().click();
    },
    'detail-sidebar-entity': async (page) => {
      await goToPage(page, 'Manuscript');
      await page.locator('.ms-highlight').first().click();
    },
    'selection-popup': async (page) => {
      await goToPage(page, 'Manuscript');
      const paragraph = page.locator('#manuscript-text p, .manuscript-reader p').first();
      const box = await paragraph.boundingBox();
      if (!box) return;
      await page.mouse.move(box.x + 4, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + Math.min(160, box.width - 4), box.y + box.height / 2, { steps: 5 });
      await page.mouse.up();
    },
    'overlapping-highlights': async (page) => {
      await goToPage(page, 'Manuscript');
    },
    'sticky-header-scrolled': async (page) => {
      await goToPage(page, 'Manuscript');
      await page.mouse.wheel(0, 600);
    },
    'chapter-collapsed': async (page) => {
      await goToPage(page, 'Manuscript');
      await clickVisible(page, 'button', 'Collapse all');
    },
    'chapter-expanded': async (page) => {
      await goToPage(page, 'Manuscript');
      await clickVisible(page, 'button', 'Expand all chapters');
    },
  },
  proofing: {
    'setup-default': async (page) => {
      await goToPage(page, 'Proofing');
    },
    'setup-alt-selection': async (page) => {
      await goToPage(page, 'Proofing');
      await clickVisible(page, 'button', 'Large');
    },
    running: async (page) => {
      await goToPage(page, 'Proofing');
      await clickVisible(page, 'button', 'Start comparison');
      await page.waitForTimeout(800);
    },
    'results-row-expanded': async (page) => {
      // Waits out the real mock timer (2.6s) rather than using the mock-only
      // "Skip to results (demo)" shortcut, since that button doesn't exist
      // in the real (non-mock) app.
      await goToPage(page, 'Proofing');
      await clickVisible(page, 'button', 'Start comparison');
      await page.waitForTimeout(2_900);
      await page.locator('tr[data-row]').first().click();
    },
    toast: async (page) => {
      await goToPage(page, 'Proofing');
      await page.getByPlaceholder('Add a term…').fill('Test term');
      await clickVisible(page, 'button', 'Add');
    },
  },
  storybible: {
    'category-all': async (page) => {
      await goToPage(page, 'Story Bible');
      await clickVisible(page, 'button', /^All · \d+$/);
    },
    'category-character': async (page) => {
      await goToPage(page, 'Story Bible');
      await clickVisible(page, 'button', /^Characters · \d+$/);
    },
    'category-place': async (page) => {
      await goToPage(page, 'Story Bible');
      await clickVisible(page, 'button', /^Locations · \d+$/);
    },
    'category-organization': async (page) => {
      await goToPage(page, 'Story Bible');
      await clickVisible(page, 'button', /^Organizations · \d+$/);
    },
    'category-needs-review': async (page) => {
      await goToPage(page, 'Story Bible');
      await clickVisible(page, 'button', /^Needs Review · \d+$/);
    },
    'entity-selected': async (page) => {
      await goToPage(page, 'Story Bible');
      await page.locator('tr[data-row]').first().click();
    },
    'delete-confirm': async (page) => {
      await goToPage(page, 'Story Bible');
      await page.locator('tr[data-row]').first().click();
      // The delete button is hidden while the selected entity is locked -
      // unlock it first if needed so this state is reachable regardless of
      // which entity the fixture data happens to sort first.
      const unlock = page.getByRole('button', { name: 'Unlock entry' });
      if (await unlock.count()) await unlock.click();
      await clickVisible(page, 'button', 'Delete entity');
    },
    'entry-locked': async (page) => {
      await goToPage(page, 'Story Bible');
      await page.locator('tr[data-row]').first().click();
      const unlock = page.getByRole('button', { name: 'Lock entry' });
      if (await unlock.count()) await unlock.click();
    },
    'entry-unlocked': async (page) => {
      await goToPage(page, 'Story Bible');
      await page.locator('tr[data-row]').first().click();
    },
  },
  settings: {
    'global-general': async (page) => {
      await goToPage(page, 'Settings');
      await clickVisible(page, 'button', 'Global');
      await clickSettingsCategory(page, 'General');
    },
    'global-proofing': async (page) => {
      await goToPage(page, 'Settings');
      await clickVisible(page, 'button', 'Global');
      await clickSettingsCategory(page, 'Proofing');
    },
    'global-storybible': async (page) => {
      await goToPage(page, 'Settings');
      await clickVisible(page, 'button', 'Global');
      await clickSettingsCategory(page, 'Story Bible');
    },
    'global-daw': async (page) => {
      await goToPage(page, 'Settings');
      await clickVisible(page, 'button', 'Global');
      await clickSettingsCategory(page, 'DAW Integration');
    },
    'global-tts': async (page) => {
      await goToPage(page, 'Settings');
      await clickVisible(page, 'button', 'Global');
      await clickSettingsCategory(page, 'TTS');
    },
    'project-proofing': async (page) => {
      await goToPage(page, 'Settings');
      await clickVisible(page, 'button', 'This Project');
      await clickSettingsCategory(page, 'Proofing');
    },
    'project-storybible': async (page) => {
      await goToPage(page, 'Settings');
      await clickVisible(page, 'button', 'This Project');
      await clickSettingsCategory(page, 'Story Bible');
    },
    'dirty-footer': async (page) => {
      await goToPage(page, 'Settings');
      await clickVisible(page, 'button', 'Global');
      await clickSettingsCategory(page, 'Proofing');
      // Proofing settings fields are <select> comboboxes, not pill buttons
      // (that's a Setup-page-only control) - pick a different model to dirty it.
      await page.getByRole('combobox').first().selectOption('large-v3');
    },
    'navigate-away-confirm': async (page) => {
      await goToPage(page, 'Settings');
      await clickVisible(page, 'button', 'Global');
      await clickSettingsCategory(page, 'Proofing');
      await page.getByRole('combobox').first().selectOption('large-v3');
      await clickVisible(page, 'button', 'Home');
    },
    'reset-override': async (page) => {
      await goToPage(page, 'Settings');
      await clickVisible(page, 'button', 'This Project');
      await clickSettingsCategory(page, 'Proofing');
      const reset = page.getByRole('button', { name: 'Reset' }).first();
      if (await reset.count()) await reset.hover();
    },
  },
  global: {
    tooltip: async (page) => {
      await page.getByLabel('More information').hover();
    },
    toast: async (page) => {
      await goToPage(page, 'Proofing');
      await page.getByPlaceholder('Add a term…').fill('Test term');
      await clickVisible(page, 'button', 'Add');
    },
    'confirm-dialog': async (page) => {
      await goToPage(page, 'Story Bible');
      await page.locator('tr[data-row]').first().click();
      const unlock = page.getByRole('button', { name: 'Unlock entry' });
      if (await unlock.count()) await unlock.click();
      await clickVisible(page, 'button', 'Delete entity');
    },
  },
};

for (const entry of STATE_CATALOG) {
  const driver = APP_DRIVERS[entry.page]?.[entry.state];
  const title = `${entry.page} / ${entry.state}`;
  if (!driver) {
    test.skip(title, async () => {});
    continue;
  }

  test(title, async ({ page }) => {
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto('/');
      await settlePage(page);
      await driver(page);
      await page.screenshot({ path: `${screenshotDir(entry.page, entry.state)}/${viewport.name}.png` });
    }
  });
}
