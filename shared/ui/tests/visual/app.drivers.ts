import type { Page } from '@playwright/test';
import { settlePage } from './helpers/settle';

// How to reach each {page, state} in STATE_CATALOG. Driven entirely through
// real UI interaction (clicks, hovers, drag-selection) using accessible-name
// selectors, since the app has no data-testid convention and its state lives
// in React, not globals. Kept apart from app.spec.ts (which registers Playwright
// tests at import time) so Vitest can check it against the catalog.
export type Driver = (page: Page) => Promise<void>;

// Stops every page timer (setTimeout, requestAnimationFrame) where it stands. Installed only for
// the states that need it: a fake clock left on for a whole run interferes with React 19's
// transition scheduling (the mobile nav drawer stops closing after navigation).
async function freezeClock(page: Page): Promise<void> {
  await page.clock.install();
  const now = await page.evaluate(() => Date.now());
  await page.clock.pauseAt(new Date(now + 10));
}

async function clickVisible(page: Page, role: Parameters<Page['getByRole']>[0], name: string | RegExp): Promise<void> {
  const target = page.getByRole(role, { name, exact: typeof name === 'string' }).and(page.locator(':visible'));
  // At the mobile viewport the nav rail is hidden entirely behind the
  // hamburger menu - AppShell only mounts a visible copy of it inside the
  // slide-in drawer once opened. Only reach for the drawer when the target
  // genuinely never shows up: a page that is merely still rendering (React
  // schedules route changes a beat later) must not get a drawer opened over it.
  const appeared = await target
    .first()
    .waitFor({ state: 'visible', timeout: 1_500 })
    .then(
      () => true,
      () => false,
    );
  if (!appeared) {
    const hamburger = page.getByRole('button', { name: 'Open navigation' });
    if (await hamburger.count()) await hamburger.click();
  }
  await target.first().click();
}

async function goToPage(page: Page, name: 'Home' | 'Manuscript' | 'Proofing' | 'Story Bible' | 'Tracks' | 'Settings'): Promise<void> {
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

// Playwright's synthetic page.mouse.down/move/up drag doesn't reliably
// produce a non-empty window.getSelection() range for useTextSelection.ts's
// mouseup listener to pick up (unlike a real Chromium user drag, or RTL's
// fireEvent.mouseUp against a manually-constructed Range in jsdom). Building
// the Range directly and dispatching mouseup ourselves - mirroring how the
// component's own test does it - is deterministic across viewports.
async function selectFirstParagraphText(page: Page): Promise<void> {
  // Chapter paragraphs load after the page mounts; wait for real prose, not just the container.
  await page.waitForFunction(() => [...document.querySelectorAll('[data-paragraph-text]')].some((node) => (node.textContent?.length ?? 0) >= 20));
  const selected = await page.evaluate(() => {
    // The paragraph's own firstChild is often a <mark>/<span> entity highlight, and
    // the first paragraphs can be short titles - walk every paragraph to the first
    // real Text node with enough content instead of assuming layout.
    for (const paragraph of document.querySelectorAll('[data-paragraph-text]')) {
      const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const candidate = walker.currentNode as Text;
        if ((candidate.textContent?.length ?? 0) < 20) continue;
        const range = document.createRange();
        range.setStart(candidate, 0);
        range.setEnd(candidate, 20);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        paragraph.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        return true;
      }
    }
    return false;
  });
  if (!selected) throw new Error('no paragraph with enough text to select - did the reader markup change?');
}

// Some states have no known/safe driver yet (e.g. alias-typeahead, forcing
// the manuscript-not-found banner without a mock-data override seam). Those
// are left out here on purpose - the catalog entry is simply skipped.
export const APP_DRIVERS: Record<string, Record<string, Driver>> = {
  project: {
    'picker-empty': async (page) => {
      // Reload with the mock's no-project boot seam (see main.tsx) instead
      // of an init-script - the outer loop's default `page.goto('/')` has
      // already happened by the time a driver runs, so this simply
      // re-navigates before settling.
      await page.goto('/?mockNoProject=1');
      await settlePage(page);
    },
  },
  home: {
    default: async () => {},
    'manuscript-not-found': async (page) => {
      await page.goto('/?mockNoManuscript=1');
      await settlePage(page);
    },
    'chapter-table-collapsed': async () => {},
    'chapter-table-expanded': async (page) => {
      await clickVisible(page, 'button', /Show per-chapter breakdown/);
    },
    'hint-chips': async (page) => {
      await goToPage(page, 'Proofing');
      await clickVisible(page, 'button', /Suggest from manuscript/);
      // Accept exactly one candidate so accepted (solid pill) and pending
      // (dashed "+ Term") chips render together, matching this state's
      // "(accepted + pending)" description - accepting every candidate would
      // leave nothing pending to show.
      await clickVisible(page, 'button', '+ Alice');
    },
    'info-tooltip': async (page) => {
      await page.getByLabel('More information').hover();
      // TooltipTarget shows its tooltip 1s after hover - wait for it, don't race it.
      await page.getByRole('tooltip').waitFor();
    },
    'manuscript-candidate-offer': async (page) => {
      // Reload with the mock's candidate boot seam (see main.tsx), like
      // project/picker-empty does for the no-project seam.
      await page.goto('/?mockManuscriptCandidate=1');
      await settlePage(page);
      await page.getByRole('dialog', { name: 'Import manuscript?' }).waitFor();
    },
    'import-activity-log': async (page) => {
      await clickVisible(page, 'button', 'Replace manuscript');
      await clickVisible(page, 'button', 'Import');
      await page.getByText('Manuscript imported', { exact: true }).first().waitFor();
    },
    'import-confirm': async (page) => {
      // The default mock state already has a manuscript loaded, so "Import
      // manuscript" isn't visible - "Replace manuscript" drives the same
      // selectManuscript -> preview -> confirm dialog flow.
      await clickVisible(page, 'button', 'Replace manuscript');
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
      // The default chapter's seeded note spans a whole paragraph, and an
      // entity <mark> nested inside it calls stopPropagation() on click - a
      // click resolving to that nested mark never reaches the outer note's
      // handler. Exclude notes that contain another highlight so the click
      // lands on the note itself.
      await page.locator('[data-highlight="Note"]:not(:has([data-highlight]))').first().click();
    },
    'detail-sidebar-entity': async (page) => {
      await goToPage(page, 'Manuscript');
      await page.locator('mark.ms-highlight').first().click();
    },
    'selection-popup': async (page) => {
      await goToPage(page, 'Manuscript');
      await selectFirstParagraphText(page);
    },
    'overlapping-highlights': async (page) => {
      await goToPage(page, 'Manuscript');
    },
    'sticky-header-scrolled': async (page) => {
      await goToPage(page, 'Manuscript');
      // The wheel scrolls whatever is under the pointer, so aim it at the reader.
      await page.locator('#manuscript-text, .manuscript-reader').first().hover();
      await page.mouse.wheel(0, 600);
      await page.waitForFunction(() => window.scrollY > 0 || [...document.querySelectorAll('*')].some((el) => el.scrollTop > 0));
    },
    'chapter-collapsed': async (page) => {
      await goToPage(page, 'Manuscript');
      await clickVisible(page, 'button', 'Collapse all chapters');
    },
    'add-note-dialog': async (page) => {
      await goToPage(page, 'Manuscript');
      await selectFirstParagraphText(page);
      await clickVisible(page, 'button', '+ Note');
    },
    'formatted-text-and-line-breaks': async (page) => {
      await goToPage(page, 'Manuscript');
      // The mock seeds an underlined, italic and bold phrase plus a line break
      // in the rabbit-hole paragraph (mockFixtures.ts withFormatting).
      await page.locator('[data-paragraph-text] u').first().scrollIntoViewIfNeeded();
      await page
        .locator('[data-paragraph-text] u')
        .first()
        .evaluate((element) => element.scrollIntoView({ block: 'center' }));
    },
    'chapter-bookmarked': async (page) => {
      await goToPage(page, 'Manuscript');
      await page.locator('article header button.group').first().click();
    },
    'go-to-line-highlight': async (page) => {
      await goToPage(page, 'Story Bible');
      await page.locator('tr[data-row]').first().click();
      await page
        .getByRole('button', { name: /Go to line/ })
        .first()
        .click();
      await page.locator('[data-jump-target]').first().waitFor();
    },
    'reader-dark': async (page) => {
      await goToPage(page, 'Settings');
      await clickVisible(page, 'button', 'Global');
      await clickSettingsCategory(page, 'Appearance');
      await clickVisible(page, 'button', 'Dark');
      await goToPage(page, 'Manuscript');
    },
  },
  proofing: {
    'disabled-button': async (page) => {
      // No manuscript yet, so Home's Proofing action is locked; hovering it shows why.
      await page.goto('/?mockNoManuscript=1');
      await settlePage(page);
      await page
        .locator('span[tabindex="0"]:visible:has(button:disabled)')
        .filter({ hasText: /Proofing/ })
        .first()
        .hover();
      await page.getByRole('tooltip').waitFor();
    },
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
      // Mid-progress: the first step landed and the run has not finished.
      await page.getByText(/^[1-9]\d?% ·/).waitFor();
    },
    'results-row-expanded': async (page) => {
      // Waits out the real mock timer (2.6s) rather than using the mock-only
      // "Skip to results (demo)" shortcut, since that button doesn't exist
      // in the real (non-mock) app.
      await goToPage(page, 'Proofing');
      await clickVisible(page, 'button', 'Start comparison');
      await page.locator('tr[data-row]').first().waitFor({ timeout: 10_000 });
      await page.locator('tr[data-row]').first().click();
    },
    'results-extra-row-expanded': async (page) => {
      await goToPage(page, 'Proofing');
      await clickVisible(page, 'button', 'Start comparison');
      await page.locator('tr[data-row]').first().waitFor({ timeout: 10_000 });
      // Target the EXTRA (heard but not written) row specifically - .first()
      // would land on the MISREAD row instead.
      await page.locator('tr[data-row]').filter({ hasText: 'EXTRA' }).click();
    },
    toast: async (page) => {
      await goToPage(page, 'Proofing');
      await page.getByPlaceholder('Add a term…').fill('Test term');
      // The toast fades on a real 2.25s timer; freeze timers so it cannot race the screenshot.
      await freezeClock(page);
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
    'alias-typeahead': async (page) => {
      await goToPage(page, 'Story Bible');
      await page.locator('tr[data-row]').first().click();
      // "at" matches multiple canonical names in the mock fixture set
      // (Hatter, Caterpillar, Cheshire Cat) regardless of which entity the
      // fixture data happens to sort first into the row - findAliasMatches
      // excludes the selected entity by id, not by name, so this can't
      // accidentally match zero results.
      // Entries open read-only (ADR-0018): unlock if needed, then Edit, before
      // the alias field accepts input.
      const unlock = page.getByRole('button', { name: 'Unlock entry' });
      if (await unlock.count()) await unlock.click();
      await clickVisible(page, 'button', 'Edit this entry');
      await page.getByPlaceholder('Add an alias or find a matching entry…').fill('at');
    },
    'entry-needs-review': async (page) => {
      await goToPage(page, 'Story Bible');
      await page.locator('tr[data-row]', { hasText: 'March Hare' }).click();
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
    'entry-editing': async (page) => {
      await goToPage(page, 'Story Bible');
      await page.locator('tr[data-row]').first().click();
      const unlock = page.getByRole('button', { name: 'Unlock entry' });
      if (await unlock.count()) await unlock.click();
      await clickVisible(page, 'button', 'Edit this entry');
    },
  },
  tracks: {
    default: async (page) => {
      await goToPage(page, 'Tracks');
    },
    'unplayable-track-selected': async (page) => {
      await goToPage(page, 'Tracks');
      // Chapter 2's mock source file is missing on disk.
      await clickVisible(page, 'button', /Chapter 2/);
    },
    'rpp-picker': async (page) => {
      // Reload with the mock's two-.rpp seam (see main.tsx) - the outer
      // loop's default page.goto('/') has already happened by now.
      await page.goto('/?mockMultipleRpp=1');
      await settlePage(page);
      await goToPage(page, 'Tracks');
    },
    'no-rpp': async (page) => {
      await page.goto('/?mockNoRpp=1');
      await settlePage(page);
      await goToPage(page, 'Tracks');
    },
    playing: async (page) => {
      await goToPage(page, 'Tracks');
      await clickVisible(page, 'button', 'Play');
      // The mock serves a real silent 10-minute WAV; wait for its metadata so
      // the readout shows a duration instead of 0:00 / 0:00.
      await page.getByText(/^0:0\d \/ 10:00$/).waitFor();
    },
    'skipped-forward': async (page) => {
      await goToPage(page, 'Tracks');
      await clickVisible(page, 'button', 'Play');
      await page.getByText(/^0:0\d \/ 10:00$/).waitFor();
      await clickVisible(page, 'button', 'Skip forward 30 seconds');
      await page.getByText(/^0:3\d \/ 10:00$/).waitFor();
    },
    'last-track-selected': async (page) => {
      await goToPage(page, 'Tracks');
      await clickVisible(page, 'button', /Click Track/);
    },
  },
  settings: {
    'global-general': async (page) => {
      await goToPage(page, 'Settings');
      await clickVisible(page, 'button', 'Global');
      await clickSettingsCategory(page, 'General');
    },
    'global-manuscript': async (page) => {
      await goToPage(page, 'Settings');
      await clickVisible(page, 'button', 'Global');
      await clickSettingsCategory(page, 'Manuscript');
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
    'global-appearance': async (page) => {
      await goToPage(page, 'Settings');
      await clickVisible(page, 'button', 'Global');
      await clickSettingsCategory(page, 'Appearance');
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
    'project-data': async (page) => {
      await goToPage(page, 'Settings');
      await clickVisible(page, 'button', 'This Project');
      await clickSettingsCategory(page, 'Project data');
    },
    'dirty-footer': async (page) => {
      await goToPage(page, 'Settings');
      await clickVisible(page, 'button', 'Global');
      await clickSettingsCategory(page, 'Proofing');
      // Proofing settings fields are <select> comboboxes, not pill buttons
      // (that's a Setup-page-only control) - pick a different model to dirty it.
      await page.getByRole('combobox').first().selectOption('large-v3');
      // The unsaved-changes footer sits at the end of the page; bring it on screen.
      await page.getByRole('button', { name: /save/i }).scrollIntoViewIfNeeded();
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
      // TooltipTarget shows its tooltip 1s after hover - wait for it, don't race it.
      await page.getByRole('tooltip').waitFor();
    },
    'nav-rail-tooltip': async (page) => {
      // Only the icon-only rail (small-desktop and tablet widths) wraps its
      // buttons in a tooltip; the full sidebar and the mobile drawer show
      // labels already, so hovering there changes nothing visible.
      // Icon-only buttons are the ones carrying an aria-label; the full
      // sidebar's button has the same accessible name from its text instead.
      const railButton = page.locator('button[aria-label="Tracks"]:visible');
      if (await railButton.count()) {
        await railButton.first().hover();
        // TooltipTarget waits 1s after hover before showing (focus shows it
        // immediately), so wait for it rather than screenshotting too early.
        await page.getByRole('tooltip').waitFor({ timeout: 3_000 });
      }
    },
    'nav-drawer-open': async (page) => {
      // The hamburger button only renders below the `md` breakpoint
      // (AppShell's `max-md:inline-flex`) - at desktop/small-desktop/tablet
      // widths the persistent nav rail is already visible, so there's
      // nothing to open and this is intentionally a no-op there.
      const hamburger = page.getByRole('button', { name: 'Open navigation' });
      if (await hamburger.count()) await hamburger.click();
    },
    toast: async (page) => {
      await goToPage(page, 'Proofing');
      await page.getByPlaceholder('Add a term…').fill('Test term');
      // The toast fades on a real 2.25s timer; freeze timers so it cannot race the screenshot.
      await freezeClock(page);
      await clickVisible(page, 'button', 'Add');
    },
    'confirm-dialog': async (page) => {
      await goToPage(page, 'Story Bible');
      await page.locator('tr[data-row]').first().click();
      const unlock = page.getByRole('button', { name: 'Unlock entry' });
      if (await unlock.count()) await unlock.click();
      await clickVisible(page, 'button', 'Delete entity');
    },
    'theme-light': async (page) => {
      await goToPage(page, 'Settings');
      await clickVisible(page, 'button', 'Global');
      await clickSettingsCategory(page, 'Appearance');
      await clickVisible(page, 'button', 'Light');
      await clickVisible(page, 'button', 'Home');
    },
    'theme-dark': async (page) => {
      await goToPage(page, 'Settings');
      await clickVisible(page, 'button', 'Global');
      await clickSettingsCategory(page, 'Appearance');
      await clickVisible(page, 'button', 'Dark');
      await clickVisible(page, 'button', 'Home');
    },
  },
};
