// The helpers the page drivers (drivers/<page>.ts) share: navigation, waits and the steps more than one state takes.
import type { Locator, Page } from '@playwright/test';
import { settlePage } from '../helpers/settle';

export type Driver = (page: Page) => Promise<void>;

// Stops every page timer (setTimeout, requestAnimationFrame) where it stands. Installed only for
// the states that need it: a fake clock left on for a whole run interferes with React 19's
// transition scheduling (the mobile nav drawer stops closing after navigation).
// The installed clock keeps running until it is paused, so on a busy page (a loaded CI runner)
// the 10 ms target can already be behind it when pauseAt runs ("Cannot fast-forward to the
// past"): read the clock again and retry rather than pause further ahead, which would fire timers.
export async function freezeClock(page: Page): Promise<void> {
  await page.clock.install();
  for (let attempt = 1; ; attempt += 1) {
    const now = await page.evaluate(() => Date.now());
    try {
      await page.clock.pauseAt(new Date(now + 10));
      return;
    } catch (error) {
      if (attempt >= 5 || !String(error).includes('Cannot fast-forward to the past')) throw error;
    }
  }
}

// Opens the Booth (after a reload with a mock seam, when one is given) on its default chapter, Chapter 1, once the text is
// on screen.
export async function openBooth(page: Page, query = ''): Promise<void> {
  if (query) {
    await page.goto(`/${query}`);
    await settlePage(page);
  }
  await goToPage(page, 'Booth');
}

export async function clickVisible(page: Page, role: Parameters<Page['getByRole']>[0], name: string | RegExp): Promise<void> {
  // The nav rail is visible at every captured viewport except the reflow one, where only Settings states are captured
  // and they navigate through clickNav, so the click's own auto-wait is enough.
  await page
    .getByRole(role, { name, exact: typeof name === 'string' })
    .and(page.locator(':visible'))
    .first()
    .click();
}

type AppPage = 'Production' | 'Schedule' | 'Script' | 'Story Bible' | 'Booth' | 'Editing' | 'Proof' | 'Pickups' | 'Master & QC' | 'Delivery' | 'Settings';

// Every page opens with the shared `Heading` primitive, an <h1>: it is what proves the page has arrived.
export const PAGE_HEADING: Record<AppPage, string> = {
  Production: 'Production',
  Schedule: 'Schedule',
  Script: 'Script',
  'Story Bible': 'Story Bible',
  // A visually hidden <h1>: the Booth's own status line names the chapter (benchmark mock 03).
  Booth: 'Booth',
  Editing: 'Editing',
  Proof: 'Proof',
  Pickups: 'Pickups',
  'Master & QC': 'Master & QC',
  Delivery: 'Delivery',
  Settings: 'Settings',
};

// The heading renders before the page's data does (chapters, the track list and the chapter estimate load after mount),
// so a page whose main content is the same in every state also gets a wait for that content. Pages left out (Story Bible,
// Settings) show different content per state, so their drivers wait for their own.
const PAGE_CONTENT: Partial<Record<AppPage, (page: Page) => Locator>> = {
  // The chapter pipeline is drawn once the production overview has answered.
  Production: (page) => page.getByRole('table', { name: 'Chapter pipeline' }),
  Script: (page) => page.locator('p[data-pid]'),
  // The footer's Record control, drawn once the chapter has loaded (credits states pick theirs afterwards).
  Booth: (page) => page.getByRole('button', { name: /^(Record|Stop)$/ }),
};

// Clicks an item of the app's own navigation, and only that: the Settings category rail reuses the labels "Proof"
// and "Story Bible", so an unscoped query can land on the wrong control. The shell renders one of two navigation asides
// per width (the full sidebar from 1400 px, the icon rail below), the other is display:none, and both come before <main>
// in the DOM, so the first visible aside is the navigation.
/** Opens the Story Bible and presses Build / refresh, so the app asks to download the language model. */
export async function askForTheLanguageModel(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await settlePage(page);
  await clickNav(page, 'Story Bible');
  await page.getByRole('button', { name: 'Build / refresh Story Bible' }).click();
}

/** Opens the Story Bible on the first entry and presses its Play, so the app asks to download the local preview voice. */
export async function askForThePreviewVoice(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await settlePage(page);
  await clickNav(page, 'Story Bible');
  await page.getByRole('list', { name: 'Story Bible entries' }).getByRole('button').first().click();
  await page.getByRole('button', { name: 'Play preview' }).first().click();
}

// A nav item that carries a count badge is named "Proof, 14" (NavButton), so the item is found by its name and an optional count.
const navItemName = (name: string) => new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(, \\d+)?$`);

export async function clickNav(page: Page, name: AppPage): Promise<void> {
  // Below `md` the navigation is behind an "Open navigation" button (the reflow viewport): open the drawer, pick
  // the item, and wait for the drawer to close so the page behind it is the one photographed. Only when the menu button
  // is what the layout shows, never on a timeout guess.
  const menuButton = page.getByRole('button', { name: 'Open navigation' });
  if (await menuButton.isVisible()) {
    await menuButton.click();
    const drawer = page.getByRole('dialog', { name: 'Navigation' });
    await drawer.getByRole('button', { name: navItemName(name) }).click();
    await drawer.waitFor({ state: 'hidden' });
    return;
  }
  await page
    .locator('aside:visible')
    .first()
    .getByRole('button', { name: navItemName(name) })
    .click();
  // Below 1360 px the rail opens over the page while the pointer is on it: leave it, so it does not cover the page it just opened.
  const viewport = page.viewportSize();
  if (viewport) await page.mouse.move(viewport.width - 1, viewport.height - 1);
}

// Navigates through the nav and waits until the destination has arrived (its heading, and its content where that is the
// same in every state), so a driver can never photograph the page it just left or one still loading: a click returns as
// soon as it is dispatched, not when the next page has rendered.
// The address of each page, for reaching one without its rail item.
const PAGE_PATH: Record<AppPage, string> = {
  Production: '/',
  Schedule: '/schedule',
  Script: '/script',
  'Story Bible': '/story-bible',
  Booth: '/booth',
  Editing: '/editing',
  Proof: '/proof',
  Pickups: '/pickups',
  'Master & QC': '/master',
  Delivery: '/delivery',
  Settings: '/settings',
};

// A project with no manuscript (`?mockNoManuscript=1`), opened by its address: its rail item is off, so a press on it opens a
// note instead. The page draws its own "import a manuscript" state, the one every page that needs the manuscript draws, and nothing
// redirects.
export async function openWithoutManuscript(page: Page, name: AppPage): Promise<void> {
  await page.goto('/?mockNoManuscript=1');
  await settlePage(page);
  await page.evaluate((path) => {
    window.history.pushState(null, '', path);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, PAGE_PATH[name]);
  await page.getByText('This project has no manuscript yet. Import one to begin.').waitFor();
}

export async function goToPage(page: Page, name: AppPage): Promise<void> {
  await clickNav(page, name);
  await page.getByRole('heading', { level: 1, name: PAGE_HEADING[name], exact: true }).waitFor();
  await PAGE_CONTENT[name]?.(page).first().waitFor();
}

// Opens Proof's chapter view (`/proof/:chapterId`) with no track linked. Nothing on Proof links to it (the engine panel's
// Chapter links table does, for a linked chapter), so the address is opened in place, the way the Back and Forward history does. The mock's chapter ids are `chapter-<n>` for "Chapter <n>".
export async function openProofChapter(page: Page, chapterTitle = 'Chapter 1'): Promise<void> {
  const number = /^Chapter (\d+)$/.exec(chapterTitle)?.[1];
  if (!number) throw new Error(`no chapter number in ${chapterTitle}`);
  await goToPage(page, 'Proof');
  await page.evaluate((path) => {
    window.history.pushState(null, '', path);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, `/proof/chapter-${number}`);
  await page.getByRole('heading', { level: 1, name: new RegExp(`^Proof · ${chapterTitle}( — |$)`) }).waitFor();
}

// The chapter view's compare run (the retired Proofing page's setup, run and results), scrolled into view for the picture.
export function compareRun(page: Page): Locator {
  return page.getByRole('region', { name: 'Compare the recording with the script' });
}

// Opens Master & QC (after a reload with mock seams, when given) and waits for the delivery profile and the mastering chain to
// have been read, so the page shows what it judges against and masters with.
export async function openMaster(page: Page, query = ''): Promise<void> {
  if (query) {
    await page.goto(`/${query}`);
    await settlePage(page);
  }
  await goToPage(page, 'Master & QC');
  await page.getByTitle('Open Delivery').waitFor();
  await page.getByRole('list', { name: 'Mastering steps' }).waitFor();
}

// Opens the Production home, with a `?mockProduction=` seed when given, once its board is drawn (the app's page at `/`).
export async function openProduction(page: Page, query = ''): Promise<void> {
  await page.goto(`/${query}`);
  await settlePage(page);
  await page.getByRole('heading', { level: 1, name: PAGE_HEADING.Production, exact: true }).waitFor();
  await page.getByRole('table', { name: 'Chapter pipeline' }).waitFor();
}

// Opens Master & QC and checks the mock picker's three files (two WAVs, one of them silent, and an MP3). The mock reads a quarter
// of a file per poll, so a measurement that is not held runs to its end in a few seconds.
export async function measureOnMaster(page: Page, query = ''): Promise<void> {
  await openMaster(page, query);
  await page.getByRole('button', { name: 'Check files…' }).click();
  await page.getByRole('grid', { name: 'Per-file checks' }).waitFor();
}

// Opens Master & QC's Diagnostics section, after a reload with mock seams when given, once its
// thresholds are read, and scrolls it to the top of the window: it sits below the checks and the mastering chain.
export async function openDiagnostics(page: Page, query = ''): Promise<void> {
  await openMaster(page, query);
  await page.getByRole('region', { name: 'Thresholds' }).getByText('Room-tone change').waitFor();
  await scrollToTop(page, page.getByRole('region', { name: 'Diagnostics' }));
}

// A panel by its heading: the Studio Next pages' panels are regions named by no label of their own.
export function panelTitled(page: Page, title: string | RegExp): Locator {
  return page.getByRole('region').filter({ has: page.getByRole('heading', { name: title, exact: typeof title === 'string' }) });
}

// Scrolls a region to the top of the page's scroller, so a capture of the window shows it (a section below the fold).
export async function scrollToTop(page: Page, region: Locator): Promise<void> {
  await region.evaluate((element) => element.scrollIntoView({ block: 'start' }));
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve(undefined))));
}

// Picks the mock's five files (opening/closing credits, two chapters, a retail sample) with Master & QC's "Master all to spec…"
// and assigns the three non-chapter roles the mock picker cannot infer on its own.
export async function pickFilesToMaster(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Master all to spec…' }).click();
  await page.getByRole('table', { name: 'Files to export' }).waitFor();
  await page.getByLabel('Role for 00 Opening credits.wav').selectOption('credits_opening');
  await page.getByLabel('Role for 00 Closing credits.wav').selectOption('credits_closing');
  await page.getByLabel('Role for Retail sample.wav').selectOption('retail_sample');
}

// Opens the Diagnostics tab and checks the mock picker's three files (the unheld mock reads a quarter of a file per poll).
export async function checkOnDiagnostics(page: Page, query = ''): Promise<void> {
  await openDiagnostics(page, query);
  await page.getByRole('button', { name: 'Choose files to check…' }).click();
  await page.getByRole('table', { name: 'Checked files' }).waitFor();
}

// Waits for the diagnostics check to end with `message`, then dismisses the toast its end raises (as measurementEnded does).
export async function diagnosticsEnded(page: Page, message: string | RegExp): Promise<void> {
  await page.getByRole('region', { name: 'Diagnostics' }).getByText(message).waitFor({ timeout: 15_000 });
  const dismissToast = page.getByRole('button', { name: 'Dismiss message' });
  await dismissToast.click({ timeout: 1_000 }).catch(() => undefined);
  await dismissToast.waitFor({ state: 'detached' });
}

// Waits for the measurement to end with `message` on the page (the unheld mock reads three files in twelve polls, about six
// seconds), then dismisses the toast the same end raises (job:ended), which would otherwise race the screenshot.
export async function measurementEnded(page: Page, message: string | RegExp): Promise<void> {
  await page.getByText(message).first().waitFor({ timeout: 15_000 });
  const dismissToast = page.getByRole('button', { name: 'Dismiss message' });
  await dismissToast.click({ timeout: 1_000 }).catch(() => undefined);
  await dismissToast.waitFor({ state: 'detached' });
}

// The Production home's board exists only once its overview has been read, so it is the proof that the whole page (not just its
// heading) is there before a state that adds nothing of its own is photographed.
export async function productionLoaded(page: Page): Promise<void> {
  await PAGE_CONTENT.Production?.(page).first().waitFor();
  // A fresh page has its pointer at 0,0, on the rail, which opens over the board's first column below 1360 px and then
  // intercepts the click on a row's Chapter cell. Park the pointer mid-page.
  const viewport = page.viewportSize();
  if (viewport) await page.mouse.move(viewport.width / 2, viewport.height / 2);
}

// A chapter's row in the Production pipeline. A prefix match on the Chapter cell ("Chapter 1" and "Chapter 1 — Down the Rabbit-Hole"),
// with a word boundary so "Chapter 1" never matches "Chapter 10".
function boardRow(page: Page, chapter: string): Locator {
  return page
    .getByRole('table', { name: 'Chapter pipeline' })
    .getByRole('row')
    .filter({ has: page.getByRole('cell', { name: new RegExp(`^${chapter}\\b`) }) });
}

// Opens a pipeline row's menu (the mock's row menu, useChapterTools) and picks one of its items: a right click on the row's Chapter cell.
async function rowMenu(page: Page, chapter: string, item: string): Promise<void> {
  await boardRow(page, chapter).getByRole('cell').first().click({ button: 'right' });
  await page.getByRole('menuitem', { name: item }).click();
}

// ConfirmDialog is an alertdialog (Base UI AlertDialog) and every other dialog is a role="dialog". Wait for
// either, so a state driver does not care which family its dialog is in.
export function confirmDialog(page: Page, name: string | RegExp) {
  return page.getByRole('dialog', { name }).or(page.getByRole('alertdialog', { name }));
}

// Replace manuscript has one place, the Settings page's Manuscript panel (SNM-2): the Production page no longer carries it.
export async function clickReplaceManuscript(page: Page): Promise<void> {
  await goToPage(page, 'Settings');
  await clickSettingsCategory(page, 'Manuscript');
  await clickVisible(page, 'button', 'Replace manuscript…');
}

// Opens the import review dialog with the mock's own preview (`?mockImportPreview=`, main.tsx): "Replace manuscript" begins the same
// select, preview and confirm flow as "Import manuscript". Returns the dialog, so a driver can work inside it.
export async function openImportReview(page: Page, preview?: 'markdown' | 'repaired' | 'text') {
  if (preview) {
    await page.goto(`/?mockImportPreview=${preview}`);
    await settlePage(page);
  }
  await clickReplaceManuscript(page);
  const extension = preview === 'markdown' ? 'md' : preview === 'text' ? 'txt' : 'docx';
  const dialog = confirmDialog(page, `Import Alice.${extension}`);
  await dialog.waitFor();
  return dialog;
}

// Opens a chapter's recording check from its Record cell on the Production board (docs/utilities/recording-coverage.md), optionally booted with a mock seed (main.tsx), and waits until the stored
// result has been read into the slide-over. A chapter still recording has Record as its current stage, whose cell opens the stage
// slide-over instead: its "Recording check" button is the way on. Returns the slide-over.
export async function openRecordingCheck(page: Page, chapter: string, seed?: string) {
  if (seed) {
    await page.goto(`/?${seed}`);
    await settlePage(page);
  }
  await productionLoaded(page);
  await rowMenu(page, chapter, 'Recording check…');
  // A prefix match: the panel's full name also carries the chapter's subtitle when it has one,
  // which this helper's callers do not all pass.
  const dialog = page.getByRole('dialog', { name: new RegExp(`^Recording check: ${chapter}\\b`) });
  await dialog.getByRole('button', { name: /^Check (recording|again)$/ }).waitFor();
  await dialog.getByText('Reading the last check…').waitFor({ state: 'detached' });
  return dialog;
}

// Opens a chapter's track slide-over from its Recorded cell, booted with a mock seed
// (main.tsx's `?mockChapterLink=`), and waits for its saved-project facts to have loaded. Returns the dialog.
export async function openTrackPanel(page: Page, chapter: string, seed: string) {
  await page.goto(`/?${seed}`);
  await settlePage(page);
  await productionLoaded(page);
  await rowMenu(page, chapter, 'Chapter track…');
  // The slide-over's name carries the chapter's subtitle after " — ".
  const dialog = page.getByRole('dialog', { name: new RegExp(`^Track: ${chapter}( — |$)`) });
  await dialog.getByText('Reading the saved project…').waitFor({ state: 'detached' });
  return dialog;
}

// The Production home booted with a stage suggestions seed (`?mockStages=`, main.tsx), once the first read has answered: the chips
// above the board (`mixed`) or its error chip (`error`) are on screen.
async function openStageSuggestions(page: Page, seed: 'mixed' | 'error') {
  await page.goto(`/?mockStages=${seed}`);
  await settlePage(page);
  await productionLoaded(page);
}

// A chapter's stage slide-over on the `mixed` seed. Returns the slide-over.
export async function openStageEvidence(page: Page, chapter: string) {
  await openStageSuggestions(page, 'mixed');
  // The readiness chip on the chapter's current-stage cell opens the readiness slide-over (SN-P8; the old stage slide-over is gone).
  await boardRow(page, chapter)
    .getByRole('button', { name: /^Stage readiness: / })
    .click();
  const view = page.getByRole('dialog', { name: 'Stage readiness' });
  await view.locator('[data-verdict-pill]').waitFor();
  return view;
}

// Opens Chapter 7's editing check panel from its stage slide-over's "Editing check",
// booted with a mock seed (`?mockEditingSignal=`/`?mockEditing=`/`?mockEditingCandidates=1`, main.tsx). Unlike openStageEvidence
// this never uses the `mixed` seed: Chapter 7 is `mixed`'s own "evidence changed" demo - a query-string seed instead gives
// Chapter 7 (already in Editing status in the fixture) a plain, uncontested editing signal. Returns the panel.
export async function openEditingCheck(page: Page, query: string) {
  await page.goto(`/?${query}`);
  await settlePage(page);
  await productionLoaded(page);
  await rowMenu(page, 'Chapter 7', 'Editing check…');
  const panel = page.getByRole('dialog', { name: /^Editing check: Chapter 7\b/ });
  await panel.getByRole('button', { name: /^Check editing|Check again$/ }).waitFor();
  return panel;
}

/** Opens the engine panel from the header's engine chip, whatever state
 * the chip is in, and waits for the panel to have read its REAPER project. Returns the panel. */
export async function openEnginePanel(page: Page): Promise<Locator> {
  await page
    .locator('header')
    .getByRole('button', { name: /^REAPER: / })
    .click();
  const panel = page.getByRole('dialog', { name: 'Audio engine' });
  await panel.getByRole('region', { name: 'REAPER project' }).waitFor();
  await panel.getByRole('status').filter({ hasText: 'Looking for the REAPER project file…' }).waitFor({ state: 'detached' });
  return panel;
}

// Opens Chapter 1's editing check panel from the engine panel's Chapter links list (the editing check's second entry point), booted with a mock seed. Returns the panel.
export async function openEditingCheckFromEngine(page: Page, query: string) {
  await page.goto(`/?${query}`);
  await settlePage(page);
  await openEnginePanel(page);
  await clickVisible(page, 'button', 'Editing check…');
  const panel = page.getByRole('dialog', { name: /^Editing check: Chapter 1\b/ });
  await panel.getByRole('button', { name: /^Check editing|Check again$/ }).waitFor();
  return panel;
}

// Settings' own category rail (.settings-nav, a tab list) reuses the same labels as the
// primary app nav ("Proof", "Story Bible") - an unscoped role/name query
// matches both and .first() can silently click the wrong one (navigating
// away from Settings instead of switching category). Always scope category
// clicks to .settings-nav specifically.
// Settings is one column of panels (the mock's, then the kept ones): a state shows one panel by scrolling it to the top,
// and a panel over Global and This project picks its scope with the switch in its own header.
export function settingsPanel(page: Page, name: string): Locator {
  return page.getByRole('region', { name, exact: true });
}
export async function clickSettingsCategory(page: Page, name: string, scope: 'Global' | 'This project' = 'Global'): Promise<void> {
  const panel = settingsPanel(page, name);
  await panel.waitFor();
  const scopes = panel.getByRole('group', { name: `${name} scope` });
  if ((await scopes.count()) > 0) {
    const choice = scopes.getByRole('button', { name: scope, exact: true });
    if ((await choice.getAttribute('aria-pressed')) !== 'true') await choice.click();
    await scopes.getByRole('button', { name: scope, exact: true }).and(page.locator('[aria-pressed="true"]')).waitFor();
  }
  await scrollToTop(page, panel);
}

// Chooses the theme the way a narrator does, with Settings' Appearance panel (the Studio Next mock's radios).
export async function chooseTheme(page: Page, theme: 'Light' | 'Dark'): Promise<void> {
  await goToPage(page, 'Settings');
  await page.getByRole('radiogroup', { name: 'Theme' }).getByRole('radio', { name: theme, exact: true }).check();
}

// Settings > Story Bible with the narrator's own Merriam-Webster key saved in the mock: the panel then says Key saved.
export async function saveOnlineDictionaryKey(page: Page): Promise<void> {
  await goToPage(page, 'Settings');
  await clickSettingsCategory(page, 'Story Bible');
  await page.getByLabel('Your key', { exact: true }).fill('0b5c1a3e-7d2f-4e6a-9c8b-2f1e0d9c8b7a');
  await clickVisible(page, 'button', 'Save key');
  await page.getByText('Key saved', { exact: true }).waitFor();
}

// Settings > Local assets, optionally booted with a mock seed (?mockAssets=): the rows are on screen once the list has loaded.
export async function openLocalAssets(page: Page, seed?: string): Promise<void> {
  if (seed) {
    await page.goto(`/?mockAssets=${seed}`);
    await settlePage(page);
  }
  await goToPage(page, 'Settings');
  await clickSettingsCategory(page, 'Local assets');
  await page.getByRole('heading', { level: 3, name: 'Small', exact: true }).waitFor();
}

/** Selects the first whole occurrence of `word` in the reader text, as a narrator's drag does (a Range, then a mouseup the reader hears). */
export async function selectReaderWord(page: Page, word: string): Promise<void> {
  await page.waitForFunction(() => [...document.querySelectorAll('p[data-pid]')].some((node) => (node.textContent?.length ?? 0) >= 20));
  const selected = await page.evaluate((target) => {
    const whole = new RegExp(`\\b${target}\\b`);
    for (const paragraph of document.querySelectorAll('p[data-pid]')) {
      const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const candidate = walker.currentNode as Text;
        const match = whole.exec(candidate.textContent ?? '');
        if (!match) continue;
        const range = document.createRange();
        range.setStart(candidate, match.index);
        range.setEnd(candidate, match.index + target.length);
        // A real selection is always on screen already (a narrator can only drag-select what they can see); this programmatic one is
        // not, so it scrolls the words into view first, or the selection toolbar (`fixed`, placed from the selection's own rect)
        // would draw off-screen.
        paragraph.scrollIntoView({ block: 'center' });
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        paragraph.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        return true;
      }
    }
    return false;
  }, word);
  if (!selected) throw new Error(`no "${word}" in the reader text - did the demo manuscript change?`);
}

/** Links a chapter to its first available track from the engine panel's Chapter links table (the same real-UI path
 * 'chapter-link-confirmed' above uses), then follows its "Open in Proof" link to `/proof/:chapterId` and waits for the chapter
 * view to render: only Chapter 1 starts linked by default in the mock. */
export async function openLinkedProofChapter(page: Page, chapterTitle: string): Promise<void> {
  await openEnginePanel(page);
  const table = page.getByRole('table', { name: 'Chapter links' });
  await table.scrollIntoViewIfNeeded();
  // An anchored-name cell match, not `hasText` (a substring): "Chapter 1" is also a substring of "Chapter 10"-"Chapter 12".
  // The cell's full name may carry the chapter's subtitle after " — ", so
  // the match allows that suffix rather than requiring an exact "Chapter 1".
  const row = table.locator('tbody tr').filter({ has: page.getByRole('cell', { name: new RegExp(`^${chapterTitle}( — |$)`) }) });
  // Chapter 1 boots linked (an unset ?mockChapterLink is `confirmed`), so it has no track to choose; any other chapter is linked here.
  await row
    .getByRole('combobox')
    .or(row.getByRole('link', { name: 'Open in Proof' }))
    .first()
    .waitFor();
  if (await row.getByRole('combobox').count()) {
    await row.getByRole('combobox').selectOption({ index: 0 });
    await row.getByRole('button', { name: 'Confirm' }).click();
  }
  await row.getByRole('link', { name: 'Open in Proof' }).click();
  await page.getByRole('heading', { level: 1, name: new RegExp(`^Proof · ${chapterTitle}( — |$)`) }).waitFor();
}

// Some states have no known/safe driver yet (e.g. alias-typeahead, forcing
// the manuscript-not-found banner without a mock-data override seam). Those
// are left out here on purpose - the catalog entry is simply skipped.
