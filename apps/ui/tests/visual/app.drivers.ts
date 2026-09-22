import type { Locator, Page } from '@playwright/test';
import { THEME_STORAGE_KEY } from '../../src/theme/theme';
import { settlePage } from './helpers/settle';

// How to reach each {page, state} in STATE_CATALOG. Driven entirely through
// real UI interaction (clicks, hovers, drag-selection) using accessible-name
// selectors, since the app has no data-testid convention and its state lives
// in React, not globals. Kept apart from app.spec.ts (which registers Playwright
// tests at import time) so Vitest can check it against the catalog.
export type Driver = (page: Page) => Promise<void>;

// The accessibility rules an app state is known to violate (axe-debt.ts). Declaring the list turns on the axe gate of the vendored
// lib/capture.ts: every captured state is checked, and a violation the list does not declare fails it (docs/adr/0064). Read by name
// through a namespace import Knip cannot follow, hence @public.
/** @public */
export { AXE_DEBT as axeDebt } from './axe-debt';

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

// Stops every page timer (setTimeout, requestAnimationFrame) where it stands. Installed only for
// the states that need it: a fake clock left on for a whole run interferes with React 19's
// transition scheduling (the mobile nav drawer stops closing after navigation).
async function freezeClock(page: Page): Promise<void> {
  await page.clock.install();
  const now = await page.evaluate(() => Date.now());
  await page.clock.pauseAt(new Date(now + 10));
}

async function clickVisible(page: Page, role: Parameters<Page['getByRole']>[0], name: string | RegExp): Promise<void> {
  // The nav rail is visible at every captured viewport except the reflow one, where only Settings states are captured
  // and they navigate through clickNav, so the click's own auto-wait is enough.
  await page
    .getByRole(role, { name, exact: typeof name === 'string' })
    .and(page.locator(':visible'))
    .first()
    .click();
}

type AppPage = 'Home' | 'Manuscript' | 'Proofing' | 'Story Bible' | 'Teleprompter' | 'Tracks' | 'Settings';

// Every page opens with the shared `Heading` primitive, an <h1>: it is what proves the page has arrived. Home's is "Welcome back".
const PAGE_HEADING: Record<AppPage, string> = {
  Home: 'Welcome back',
  Manuscript: 'Manuscript',
  Proofing: 'Proofing',
  'Story Bible': 'Story Bible',
  Teleprompter: 'Teleprompter',
  Tracks: 'Tracks',
  Settings: 'Settings',
};

// The heading renders before the page's data does (chapters, the track list and the chapter estimate load after mount),
// so a page whose main content is the same in every state also gets a wait for that content. Pages left out (Story Bible,
// Teleprompter, Tracks, Settings) show different content per state, so their drivers wait for their own.
const PAGE_CONTENT: Partial<Record<AppPage, (page: Page) => Locator>> = {
  Home: (page) => page.getByRole('button', { name: /Show per-chapter breakdown/ }),
  Manuscript: (page) => page.locator('[data-paragraph-text]'),
  Proofing: (page) => page.getByRole('button', { name: 'Start comparison' }),
};

// Clicks an item of the app's own navigation, and only that: the Settings category rail reuses the labels "Proofing"
// and "Story Bible", so an unscoped query can land on the wrong control. The shell renders one of two navigation asides
// per width (the full sidebar from 1400 px, the icon rail below), the other is display:none, and both come before <main>
// in the DOM, so the first visible aside is the navigation.
/** Opens the Story Bible on the first entry and presses its Play, so the app asks to download the local preview voice. */
async function askForThePreviewVoice(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await settlePage(page);
  await clickNav(page, 'Story Bible');
  await page.locator('tr[data-row]').first().click();
  await page.getByRole('button', { name: 'Play preview' }).first().click();
}

async function clickNav(page: Page, name: AppPage): Promise<void> {
  // Below `md` the navigation is behind an "Open navigation" button (the reflow viewport, ADR 0061): open the drawer, pick
  // the item, and wait for the drawer to close so the page behind it is the one photographed. Only when the menu button
  // is what the layout shows, never on a timeout guess (ADR 0037).
  const menuButton = page.getByRole('button', { name: 'Open navigation' });
  if (await menuButton.isVisible()) {
    await menuButton.click();
    const drawer = page.getByRole('dialog', { name: 'Navigation' });
    await drawer.getByRole('button', { name, exact: true }).click();
    await drawer.waitFor({ state: 'hidden' });
    return;
  }
  await page.locator('aside:visible').first().getByRole('button', { name, exact: true }).click();
}

// Navigates through the nav and waits until the destination has arrived (its heading, and its content where that is the
// same in every state), so a driver can never photograph the page it just left or one still loading: a click returns as
// soon as it is dispatched, not when the next page has rendered.
async function goToPage(page: Page, name: AppPage): Promise<void> {
  await clickNav(page, name);
  await page.getByRole('heading', { level: 1, name: PAGE_HEADING[name], exact: true }).waitFor();
  await PAGE_CONTENT[name]?.(page).first().waitFor();
}

// Home's chapter breakdown control exists only once the chapter list has loaded, so it is the proof that the whole page
// (not just its heading) is there before a state that adds nothing of its own is photographed.
async function homeLoaded(page: Page): Promise<void> {
  await PAGE_CONTENT.Home?.(page).first().waitFor();
}

// ConfirmDialog is an alertdialog (Base UI AlertDialog, ADR 0048) and every other dialog is a role="dialog". Wait for
// either, so a state driver does not care which family its dialog is in.
function confirmDialog(page: Page, name: string | RegExp) {
  return page.getByRole('dialog', { name }).or(page.getByRole('alertdialog', { name }));
}

// Settings' own category rail (.settings-nav, a tab list) reuses the same labels as the
// primary app nav ("Proofing", "Story Bible") - an unscoped role/name query
// matches both and .first() can silently click the wrong one (navigating
// away from Settings instead of switching category). Always scope category
// clicks to .settings-nav specifically.
async function clickSettingsCategory(page: Page, name: string): Promise<void> {
  await page.locator('.settings-nav').getByRole('tab', { name, exact: true }).click();
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
  startup: {
    'invalid-payload': async (page) => {
      // Reload with the mock's invalid-payload seam (see main.tsx): the Bootstrap goes through the real parseWire.
      await page.goto('/?mockInvalidPayload=bootstrap');
      await settlePage(page);
      await page.getByText('The app received data it could not read.').waitFor();
    },
  },
  home: {
    default: async (page) => {
      await homeLoaded(page);
    },
    'live-updates-degraded': async (page) => {
      await page.goto('/?mockLiveDegraded=1');
      await settlePage(page);
      await page.getByText(/live updates from the desktop host could not be read/).waitFor();
    },
    'manuscript-not-found': async (page) => {
      await page.goto('/?mockNoManuscript=1');
      await settlePage(page);
    },
    'chapter-table-collapsed': async (page) => {
      await homeLoaded(page);
    },
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
      await confirmDialog(page, 'Import manuscript?').waitFor();
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
      // The progress dialog that precedes it is titled "Import manuscript"; the confirm names the file.
      await confirmDialog(page, 'Import Alice.docx').waitFor();
    },
  },
  manuscript: {
    'invalid-payload': async (page) => {
      await page.goto('/?mockInvalidPayload=manuscript');
      await settlePage(page);
      // The page's own content never loads here, so goToPage (which waits for it) is not used: the inline error is the proof.
      await clickNav(page, 'Manuscript');
      await page.getByText('The app received data it could not read.').waitFor();
    },
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
      // The state is an entity highlight overlapping a note: wait for both (a Note is a `mark.ms-highlight` too, so the
      // entity is any highlight that is not a Note).
      await page.locator('mark[data-highlight]:not([data-highlight="Note"])').first().waitFor();
      await page.locator('[data-highlight="Note"]').first().waitFor();
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
      await clickVisible(page, 'tab', 'Global');
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
      // Suggesting hints from the manuscript answers with a toast (adding a term answers with none), and an information toast
      // fades on a real 5 s timer: freeze timers so it cannot race the screenshot.
      await freezeClock(page);
      await clickVisible(page, 'button', 'Suggest from manuscript');
      await page.locator('[data-tone]').first().waitFor();
    },
  },
  storybible: {
    'entry-saving': async (page) => {
      await page.goto('/?mockHoldEdits=1');
      await settlePage(page);
      await clickNav(page, 'Story Bible');
      await page.locator('tr[data-row]').first().click();
      const unlock = page.getByRole('button', { name: 'Unlock entry' });
      if (await unlock.count()) await unlock.click();
      await clickVisible(page, 'button', 'Edit this entry');
      await clickVisible(page, 'button', 'Save changes to this entry');
      await page.getByRole('button', { name: 'Save changes to this entry' }).and(page.locator('[aria-busy="true"]')).waitFor();
    },
    'rebuild-running': async (page) => {
      await page.goto('/?mockRebuildRunning=1');
      await settlePage(page);
      await clickNav(page, 'Story Bible');
      await page.getByRole('dialog', { name: 'Rebuild Story Bible' }).waitFor();
      await page.getByRole('button', { name: 'Continue in background' }).waitFor();
    },
    'invalid-payload': async (page) => {
      await page.goto('/?mockInvalidPayload=storybible');
      await settlePage(page);
      await clickNav(page, 'Story Bible');
      await page.getByText('The app received data it could not read.').waitFor();
    },
    'voice-download-confirm': async (page) => {
      await askForThePreviewVoice(page, '/');
      await page.getByRole('alertdialog', { name: 'Download local preview voice?' }).waitFor();
    },
    'voice-download-progress': async (page) => {
      await askForThePreviewVoice(page, '/?mockAssets=downloading');
      await page.getByRole('button', { name: 'Download voice' }).click();
      await page.getByRole('dialog', { name: 'Downloading preview voice' }).waitFor();
      await page.getByText(/44 of 109 MB/).waitFor();
    },
    'voice-download-failed': async (page) => {
      await askForThePreviewVoice(page, '/?mockAssets=download-fails');
      await page.getByRole('button', { name: 'Download voice' }).click();
      await page.getByRole('alert').filter({ hasText: 'did not match the approved one' }).waitFor();
    },
    'category-all': async (page) => {
      await goToPage(page, 'Story Bible');
      await clickVisible(page, 'tab', /^All · \d+$/);
    },
    'category-character': async (page) => {
      await goToPage(page, 'Story Bible');
      await clickVisible(page, 'tab', /^Characters · \d+$/);
    },
    'category-place': async (page) => {
      await goToPage(page, 'Story Bible');
      await clickVisible(page, 'tab', /^Locations · \d+$/);
    },
    'category-organization': async (page) => {
      await goToPage(page, 'Story Bible');
      await clickVisible(page, 'tab', /^Organizations · \d+$/);
    },
    'category-needs-review': async (page) => {
      await goToPage(page, 'Story Bible');
      await clickVisible(page, 'tab', /^Needs Review · \d+$/);
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
      await confirmDialog(page, 'Delete entry').waitFor();
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
      // The heading renders before the track list does.
      await page.getByRole('button', { name: 'Play', exact: true }).first().waitFor();
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
      await page.getByText('Choose a REAPER project file').waitFor();
    },
    'no-rpp': async (page) => {
      await page.goto('/?mockNoRpp=1');
      await settlePage(page);
      await goToPage(page, 'Tracks');
      await page.getByText('No REAPER project file found').waitFor();
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
  teleprompter: {
    'setup-default': async (page) => {
      await goToPage(page, 'Teleprompter');
      await page.getByText('Alice was beginning').first().waitFor();
    },
    // The Whisper model is not installed under ?mockAssets, so Start reading asks to download it; the mock holds the download at 40 percent.
    'model-download-progress': async (page) => {
      await page.goto('/?mockAssets=downloading');
      await settlePage(page);
      await goToPage(page, 'Teleprompter');
      await page.getByText('Alice was beginning').first().waitFor();
      await page.getByPlaceholder('Microphone (USB Audio Device)').fill('Studio microphone');
      await page.getByRole('button', { name: 'Start reading' }).click();
      await page.getByRole('button', { name: 'Download model' }).click();
      await page.getByRole('dialog', { name: 'Downloading Whisper model' }).waitFor();
      await page.getByText(/185 of 464 MB/).waitFor();
    },
    // The seams boot a session already 30 words into the first paragraph (word
    // 35 of the chapter). Wait for the highlight to land there so the shot is
    // never taken mid-walk.
    listening: async (page) => {
      await page.goto('/?mockTeleprompter=listening');
      await settlePage(page);
      await goToPage(page, 'Teleprompter');
      await page.locator('[data-word="35"] [data-highlight="Cursor"]').waitFor();
    },
    waiting: async (page) => {
      await page.goto('/?mockTeleprompter=waiting');
      await settlePage(page);
      await goToPage(page, 'Teleprompter');
      await page.locator('[data-word="35"] [data-highlight="Cursor"]').waitFor();
    },
    done: async (page) => {
      await page.goto('/?mockTeleprompter=done');
      await settlePage(page);
      await goToPage(page, 'Teleprompter');
      await page.getByRole('status').filter({ hasText: 'Done' }).waitFor();
    },
  },
  settings: {
    'global-general': async (page) => {
      await goToPage(page, 'Settings');
      await clickVisible(page, 'tab', 'Global');
      await clickSettingsCategory(page, 'General');
    },
    'global-manuscript': async (page) => {
      await goToPage(page, 'Settings');
      await clickVisible(page, 'tab', 'Global');
      await clickSettingsCategory(page, 'Manuscript');
    },
    'global-proofing': async (page) => {
      await goToPage(page, 'Settings');
      await clickVisible(page, 'tab', 'Global');
      await clickSettingsCategory(page, 'Proofing');
    },
    'global-storybible': async (page) => {
      await goToPage(page, 'Settings');
      await clickVisible(page, 'tab', 'Global');
      await clickSettingsCategory(page, 'Story Bible');
    },
    'global-daw': async (page) => {
      await goToPage(page, 'Settings');
      await clickVisible(page, 'tab', 'Global');
      await clickSettingsCategory(page, 'DAW Integration');
    },
    'global-tts': async (page) => {
      await goToPage(page, 'Settings');
      await clickVisible(page, 'tab', 'Global');
      await clickSettingsCategory(page, 'TTS');
    },
    'global-about': async (page) => {
      await goToPage(page, 'Settings');
      await clickVisible(page, 'tab', 'Global');
      await clickSettingsCategory(page, 'About & updates');
      await page.getByText('Not checked yet.').waitFor();
    },
    'about-update-available': async (page) => {
      await page.goto('/?mockUpdate=available');
      await settlePage(page);
      await goToPage(page, 'Settings');
      await clickVisible(page, 'tab', 'Global');
      await clickSettingsCategory(page, 'About & updates');
      await page.getByText('Version 0.2.7 is available').waitFor();
    },
    'about-download-confirm': async (page) => {
      await page.goto('/?mockUpdate=available');
      await settlePage(page);
      await goToPage(page, 'Settings');
      await clickVisible(page, 'tab', 'Global');
      await clickSettingsCategory(page, 'About & updates');
      await page.getByRole('button', { name: 'Download update' }).click();
      await confirmDialog(page, 'Download version 0.2.7?').waitFor();
    },
    'about-download-progress': async (page) => {
      await page.goto('/?mockUpdate=downloading');
      await settlePage(page);
      await goToPage(page, 'Settings');
      await clickVisible(page, 'tab', 'Global');
      await clickSettingsCategory(page, 'About & updates');
      await page.getByRole('button', { name: 'Download update' }).click();
      await page.getByRole('button', { name: 'Download', exact: true }).click();
      await page.getByRole('dialog', { name: 'Download Narration Utils 0.2.7' }).waitFor();
      await page
        .getByText(/160 of 400 MB/)
        .first()
        .waitFor();
    },
    'about-download-failed': async (page) => {
      await page.goto('/?mockUpdate=download-fails');
      await settlePage(page);
      await goToPage(page, 'Settings');
      await clickVisible(page, 'tab', 'Global');
      await clickSettingsCategory(page, 'About & updates');
      await page.getByRole('button', { name: 'Download update' }).click();
      await page.getByRole('button', { name: 'Download', exact: true }).click();
      await page.getByRole('alert').filter({ hasText: 'so the update was not used' }).waitFor();
    },
    'about-update-ready': async (page) => {
      await page.goto('/?mockUpdate=ready');
      await settlePage(page);
      await goToPage(page, 'Settings');
      await clickVisible(page, 'tab', 'Global');
      await clickSettingsCategory(page, 'About & updates');
      await page.getByRole('button', { name: 'Install and restart' }).waitFor();
    },
    'about-install-confirm': async (page) => {
      await page.goto('/?mockUpdate=ready');
      await settlePage(page);
      await goToPage(page, 'Settings');
      await clickVisible(page, 'tab', 'Global');
      await clickSettingsCategory(page, 'About & updates');
      await page.getByRole('button', { name: 'Install and restart' }).click();
      await confirmDialog(page, 'Install version 0.2.7 and restart?').waitFor();
    },
    'about-installing': async (page) => {
      await page.goto('/?mockUpdate=ready');
      await settlePage(page);
      await goToPage(page, 'Settings');
      await clickVisible(page, 'tab', 'Global');
      await clickSettingsCategory(page, 'About & updates');
      await page.getByRole('button', { name: 'Install and restart' }).click();
      await confirmDialog(page, 'Install version 0.2.7 and restart?').getByRole('button', { name: 'Install and restart' }).click();
      await page.getByRole('dialog', { name: 'Installing Narration Utils 0.2.7' }).waitFor();
    },
    'about-install-refused': async (page) => {
      await page.goto('/?mockUpdate=install-refused');
      await settlePage(page);
      await goToPage(page, 'Settings');
      await clickVisible(page, 'tab', 'Global');
      await clickSettingsCategory(page, 'About & updates');
      await page.getByRole('button', { name: 'Install and restart' }).click();
      await confirmDialog(page, 'Install version 0.2.7 and restart?').getByRole('button', { name: 'Install and restart' }).click();
      await page.getByRole('alert').filter({ hasText: 'Narration Utils is busy' }).waitFor();
    },
    'about-install-blocked': async (page) => {
      await page.goto('/?mockUpdate=install-blocked');
      await settlePage(page);
      await goToPage(page, 'Settings');
      await clickVisible(page, 'tab', 'Global');
      await clickSettingsCategory(page, 'About & updates');
      await page.getByRole('button', { name: 'Download update' }).click();
      await page.getByRole('button', { name: 'Download', exact: true }).click();
      await page.getByRole('button', { name: 'Close' }).waitFor({ timeout: 15_000 });
      await page.getByRole('button', { name: 'Close' }).click();
      await page.getByRole('button', { name: 'Show the downloaded file' }).waitFor();
    },
    'about-development-build': async (page) => {
      await page.goto('/?mockUpdate=development');
      await settlePage(page);
      await goToPage(page, 'Settings');
      await clickVisible(page, 'tab', 'Global');
      await clickSettingsCategory(page, 'About & updates');
      await page.getByText('A development build is never offered an update.').waitFor();
    },
    'about-check-failed': async (page) => {
      await page.goto('/?mockUpdate=failed');
      await settlePage(page);
      await goToPage(page, 'Settings');
      await clickVisible(page, 'tab', 'Global');
      await clickSettingsCategory(page, 'About & updates');
      await page.getByText('Could not reach GitHub to check for updates.').waitFor();
    },
    'global-appearance': async (page) => {
      await goToPage(page, 'Settings');
      await clickVisible(page, 'tab', 'Global');
      await clickSettingsCategory(page, 'Appearance');
    },
    'project-proofing': async (page) => {
      await goToPage(page, 'Settings');
      await clickVisible(page, 'tab', 'This Project');
      await clickSettingsCategory(page, 'Proofing');
    },
    'project-storybible': async (page) => {
      await goToPage(page, 'Settings');
      await clickVisible(page, 'tab', 'This Project');
      await clickSettingsCategory(page, 'Story Bible');
    },
    'project-data': async (page) => {
      await goToPage(page, 'Settings');
      await clickVisible(page, 'tab', 'This Project');
      await clickSettingsCategory(page, 'Project data');
    },
    'dirty-footer': async (page) => {
      await goToPage(page, 'Settings');
      await clickVisible(page, 'tab', 'Global');
      await clickSettingsCategory(page, 'Proofing');
      // Proofing settings fields are <select> comboboxes, not pill buttons
      // (that's a Setup-page-only control) - pick a different model to dirty it.
      await page.getByRole('combobox').first().selectOption('large-v3');
      // The unsaved-changes footer sits at the end of the page; bring it on screen.
      await page.getByRole('button', { name: /save/i }).scrollIntoViewIfNeeded();
    },
    'navigate-away-confirm': async (page) => {
      await goToPage(page, 'Settings');
      await clickVisible(page, 'tab', 'Global');
      await clickSettingsCategory(page, 'Proofing');
      await page.getByRole('combobox').first().selectOption('large-v3');
      // Leaving with unsaved changes asks first, so this click does not arrive at Home: it opens the confirm dialog.
      await clickNav(page, 'Home');
      await confirmDialog(page, 'Unsaved settings').waitFor();
    },
    'reset-override': async (page) => {
      await goToPage(page, 'Settings');
      await clickVisible(page, 'tab', 'This Project');
      await clickSettingsCategory(page, 'Proofing');
      // The mock starts with no project override, so make one the way a narrator does: pick a value and save it. Only a
      // field that has an override shows Reset (the model select), and its row is the one that must not squeeze.
      await page.getByRole('combobox', { name: 'Default Whisper model' }).selectOption('large-v3');
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      const reset = page.getByRole('button', { name: 'Reset' });
      await reset.waitFor();
      // The save toast removes itself on a real 2.4 s timer, which would race the screenshot: dismiss it, unless a slow
      // run already let it expire, and wait until it is gone either way.
      const dismissToast = page.getByRole('button', { name: 'Dismiss message' });
      await dismissToast.click({ timeout: 1_000 }).catch(() => undefined);
      await dismissToast.waitFor({ state: 'detached' });
      // Clicking Save scrolled the panel to its footer: bring the top back so the category and its first row are in the shot.
      await page.getByRole('heading', { level: 2, name: 'Proofing' }).scrollIntoViewIfNeeded();
      await reset.hover();
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
      // buttons in a tooltip; the full sidebar shows labels already, so
      // hovering there changes nothing visible.
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
    toast: async (page) => {
      await goToPage(page, 'Proofing');
      // Suggesting hints from the manuscript answers with a toast (adding a term answers with none), and an information toast
      // fades on a real 5 s timer: freeze timers so it cannot race the screenshot.
      await freezeClock(page);
      await clickVisible(page, 'button', 'Suggest from manuscript');
      await page.locator('[data-tone]').first().waitFor();
    },
    'confirm-dialog': async (page) => {
      await goToPage(page, 'Story Bible');
      await page.locator('tr[data-row]').first().click();
      const unlock = page.getByRole('button', { name: 'Unlock entry' });
      if (await unlock.count()) await unlock.click();
      await clickVisible(page, 'button', 'Delete entity');
      await confirmDialog(page, 'Delete entry').waitFor();
    },
    'theme-light': async (page) => {
      await goToPage(page, 'Settings');
      await clickVisible(page, 'tab', 'Global');
      await clickSettingsCategory(page, 'Appearance');
      await clickVisible(page, 'button', 'Light');
      await goToPage(page, 'Home');
    },
    'theme-dark': async (page) => {
      await goToPage(page, 'Settings');
      await clickVisible(page, 'tab', 'Global');
      await clickSettingsCategory(page, 'Appearance');
      await clickVisible(page, 'button', 'Dark');
      await goToPage(page, 'Home');
    },
  },
};
