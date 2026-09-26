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

// Opens Chapter 1's read-aloud dialog (after a reload with a mock seam, when one is given) and waits for its resume
// prompt to have answered (read-aloud-resume-from-daw.prd.md Phase 1, wording updated by Phase 3): the lookup's
// "Checking..." line is gone.
export async function openResumePrompt(page: Page, query = ''): Promise<void> {
  if (query) {
    await page.goto(`/${query}`);
    await settlePage(page);
  }
  await goToPage(page, 'Manuscript');
  await clickVisible(page, 'button', 'Read Chapter 1 aloud');
  const card = page.getByRole('dialog', { name: /Read aloud/ }).getByRole('region', { name: 'Where you stopped' });
  await card.waitFor();
  await card.getByText(/Checking where REAPER and your last reading are/).waitFor({ state: 'detached' });
}

// The control bar's own toolbar, scoped so its Microphone/Settings triggers never collide with a same-named control
// elsewhere on the page (the standalone Teleprompter page's nav rail also has a "Settings" link).
export const controlBar = (page: Page) => page.getByRole('toolbar', { name: 'Reading controls' });

// The microphone picker sits behind the control bar's popover (read-aloud-control-bar.prd.md Phase 3): its combobox
// does not exist in the DOM until the trigger button is clicked (Popover unmounts its content while closed).
export async function openMicPopover(page: Page): Promise<void> {
  await controlBar(page)
    .getByRole('button', { name: /^Microphone:/ })
    .click();
  await page.getByRole('combobox', { name: 'Microphone' }).waitFor();
}

// Engine and Model sit behind the control bar's Settings popover (Phase 3), same reasoning as `openMicPopover`.
export async function openSettingsPopover(page: Page): Promise<void> {
  await controlBar(page).getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('group', { name: 'Model' }).waitFor();
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

type AppPage = 'Home' | 'Manuscript' | 'Proofing' | 'Story Bible' | 'Teleprompter' | 'Tracks' | 'Review' | 'Delivery' | 'Settings';

// Every page opens with the shared `Heading` primitive, an <h1>: it is what proves the page has arrived. Home's is "Welcome back".
export const PAGE_HEADING: Record<AppPage, string> = {
  Home: 'Welcome back',
  Manuscript: 'Manuscript',
  Proofing: 'Proofing',
  'Story Bible': 'Story Bible',
  Teleprompter: 'Teleprompter',
  Tracks: 'Tracks',
  Review: 'Review',
  Delivery: 'Delivery',
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
  await page.locator('tr[data-row]').first().click();
  await page.getByRole('button', { name: 'Play preview' }).first().click();
}

export async function clickNav(page: Page, name: AppPage): Promise<void> {
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
export async function goToPage(page: Page, name: AppPage): Promise<void> {
  await clickNav(page, name);
  await page.getByRole('heading', { level: 1, name: PAGE_HEADING[name], exact: true }).waitFor();
  await PAGE_CONTENT[name]?.(page).first().waitFor();
}

// With no linked DAW file the Proofing nav item is disabled outright (AppShell's requiresDaw gate), so it cannot be
// clicked to get there - but offline review of the last completed comparison must still be reachable (PRD W16), and
// is, through Home's own "Open Proofing" card, which navigates directly and is not gated on the DAW link. Used by the
// `?mockNoDaw=1` proofing states instead of `goToPage`.
export async function goToProofingViaHomeCard(page: Page): Promise<void> {
  await homeLoaded(page);
  await clickVisible(page, 'button', 'Open Proofing');
  await page.getByRole('heading', { level: 1, name: 'Proofing', exact: true }).waitFor();
}

// The Review page has arrived once its list has rows: the heading renders before the findings do.
export async function openReview(page: Page): Promise<void> {
  await goToPage(page, 'Review');
  await waitForFindingRows(page, 4);
}

export async function waitForFindingRows(page: Page, count: number): Promise<void> {
  const rows = page.getByRole('table', { name: 'Findings' }).locator('tbody tr[data-row]');
  await page.waitForFunction(([expected]) => document.querySelectorAll('table[aria-label="Findings"] tbody tr[data-row]').length === expected, [count]);
  await rows.first().waitFor();
}

// Selects a finding by its row text and waits for its detail, a region named by the finding's kind. On the stacked layout (below
// `lg`) the detail sits under the list, so its title is scrolled into view for the picture.
export async function openFindingRow(page: Page, text: RegExp, kind: string): Promise<void> {
  await page.getByRole('table', { name: 'Findings' }).locator('tbody tr[data-row]').filter({ hasText: text }).click();
  await page.getByRole('region', { name: kind }).waitFor();
  await page.getByRole('heading', { level: 2, name: kind }).scrollIntoViewIfNeeded();
}

// Opens the first transcript difference with the mock's REAPER in `reaper` mode (`?mockReaper=`, main.tsx; connected when absent) and
// waits for the page's first REAPER status, which is when Go to and Loop stop saying "Checking whether REAPER is connected".
export async function openReaperControls(page: Page, reaper?: 'stale' | 'not-running' | 'standalone'): Promise<void> {
  if (reaper) {
    await page.goto(`/?mockReaper=${reaper}`);
    await settlePage(page);
  }
  await openReview(page);
  await openFindingRow(page, /pink eyes/, 'Transcript difference');
  await page.getByText('Checking whether REAPER is connected…').waitFor({ state: 'detached' });
}

// Presses a REAPER button and waits for what it answers, then scrolls the REAPER controls into view for the picture.
export async function pressInReaper(page: Page, name: string, answer: Locator): Promise<void> {
  await page.getByRole('region', { name: 'In REAPER' }).getByRole('button', { name }).click();
  await showReaperControls(page, answer);
}

// Accepts the open finding (only an accepted finding gets an approved marker, review dashboard Phase 8) and opens the
// Add a marker in REAPER confirm.
export async function confirmApprovedMarker(page: Page): Promise<Locator> {
  await openReaperControls(page);
  await page.getByRole('button', { name: 'Accept', exact: true }).click();
  await page.getByText('Saved as accepted.').waitFor();
  await page.getByRole('region', { name: 'In REAPER' }).getByRole('button', { name: 'Add marker in REAPER' }).click();
  const dialog = page.getByRole('alertdialog', { name: 'Add a marker in REAPER' });
  await dialog.waitFor();
  return dialog;
}

// Opens Delivery (after a reload with mock seams, when given) and waits for the delivery profile to have been read, so the panel
// shows what the page judges against (delivery-platform-profiles.prd.md Phase 3).
export async function openDelivery(page: Page, query = ''): Promise<void> {
  if (query) {
    await page.goto(`/${query}`);
    await settlePage(page);
  }
  await goToPage(page, 'Delivery');
  await page.getByRole('button', { name: /^Rules and their sources/ }).waitFor();
}

// Opens Delivery and measures the mock picker's three files (two WAVs, one of them silent, and an MP3). The mock reads a quarter of
// a file per poll, so a measurement that is not held runs to its end in a few seconds.
export async function measureOnDelivery(page: Page, query = ''): Promise<void> {
  await openDelivery(page, query);
  await page.getByRole('button', { name: 'Choose files to measure…' }).click();
  await page.getByRole('table', { name: 'Measurements' }).waitFor();
}

// Opens Delivery's Diagnostics tab (diagnostics PRD Phase 6), after a reload with mock seams when given, once its thresholds are read.
export async function openDiagnostics(page: Page, query = ''): Promise<void> {
  await openDelivery(page, query);
  await page.getByRole('tab', { name: 'Diagnostics' }).click();
  await page.getByRole('region', { name: 'Thresholds' }).getByText('Room-tone change').waitFor();
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
// seconds), then dismisses the toast the same end raises (job:ended, ADR 0076), which would otherwise race the screenshot.
export async function measurementEnded(page: Page, message: string | RegExp): Promise<void> {
  await page.getByRole('region', { name: 'Measurements' }).getByText(message).waitFor({ timeout: 15_000 });
  const dismissToast = page.getByRole('button', { name: 'Dismiss message' });
  await dismissToast.click({ timeout: 1_000 }).catch(() => undefined);
  await dismissToast.waitFor({ state: 'detached' });
}

// Opens Find pickups and duplicates (take review Phase 5) once the tracks have filled the form.
export async function openScanDialog(page: Page): Promise<Locator> {
  await openReview(page);
  await page.getByRole('button', { name: 'Find pickups and duplicates…' }).click();
  const form = page.getByRole('dialog', { name: 'Find pickups and duplicates' });
  await form.getByRole('option', { name: 'Chapter 1' }).waitFor({ state: 'attached' });
  return form;
}

// Scans Chapter 1 through the dialog to its end and closes it: the mock scan saves its two groups, and the list is narrowed to
// take review.
export async function scanChapterOne(page: Page): Promise<void> {
  const form = await openScanDialog(page);
  await form.getByRole('button', { name: 'Start scan' }).click();
  const progress = page.getByRole('dialog', { name: 'Finding pickups and duplicates' });
  await progress.getByRole('status').filter({ hasText: 'Found 2 groups of repeated reads in Chapter 1.' }).waitFor();
  await progress.getByRole('button', { name: 'Close' }).click();
  await waitForFindingRows(page, 2);
  // The scan's end is also a toast (job:ended, ADR 0076) that removes itself on a real timer, which would race the screenshot:
  // dismiss it, unless a slow run already let it expire, and wait until it is gone either way.
  const dismissToast = page.getByRole('button', { name: 'Dismiss message' });
  await dismissToast.click({ timeout: 1_000 }).catch(() => undefined);
  await dismissToast.waitFor({ state: 'detached' });
}

// Scans, opens the partial pickup group and waits for its reads' REAPER controls to know REAPER is connected.
export async function openPickupGroup(page: Page): Promise<Locator> {
  await scanChapterOne(page);
  await openFindingRow(page, /Partial pickup/, 'Pickup');
  await page.getByText('Checking whether REAPER is connected…').waitFor({ state: 'detached' });
  return page.getByRole('region', { name: 'Reads' });
}

// Compares the partial pickup group's takes through the dialog to its end and closes it: the mock saves the comparison and the
// page opens it, narrowed to take comparisons. The end's job:ended toast is dismissed, as the scan's is.
export async function compareTakes(page: Page): Promise<Locator> {
  const reads = await openPickupGroup(page);
  await reads.getByRole('button', { name: 'Compare takes…' }).click();
  const progress = page.getByRole('dialog', { name: 'Comparing takes' });
  await progress
    .getByRole('status')
    .filter({ hasText: /^Compared the takes/ })
    .waitFor();
  await progress.getByRole('button', { name: 'Close' }).click();
  const comparison = page.getByRole('region', { name: 'Takes side by side' });
  await comparison.waitFor();
  const dismissToast = page.getByRole('button', { name: 'Dismiss message' });
  await dismissToast.click({ timeout: 1_000 }).catch(() => undefined);
  await dismissToast.waitFor({ state: 'detached' });
  await page.getByText('Checking whether REAPER is connected…').waitFor({ state: 'detached' });
  return comparison;
}

export async function showReaperControls(page: Page, shown: Locator): Promise<void> {
  await shown.waitFor();
  await page.getByRole('region', { name: 'In REAPER' }).scrollIntoViewIfNeeded();
}

// Home's chapter breakdown control exists only once the chapter list has loaded, so it is the proof that the whole page
// (not just its heading) is there before a state that adds nothing of its own is photographed.
export async function homeLoaded(page: Page): Promise<void> {
  await PAGE_CONTENT.Home?.(page).first().waitFor();
}

// ConfirmDialog is an alertdialog (Base UI AlertDialog, ADR 0048) and every other dialog is a role="dialog". Wait for
// either, so a state driver does not care which family its dialog is in.
export function confirmDialog(page: Page, name: string | RegExp) {
  return page.getByRole('dialog', { name }).or(page.getByRole('alertdialog', { name }));
}

// Opens the import review dialog with the mock's own preview (`?mockImportPreview=`, main.tsx): "Replace manuscript" begins the same
// select, preview and confirm flow as "Import manuscript". Returns the dialog, so a driver can work inside it.
export async function openImportReview(page: Page, preview?: 'markdown' | 'repaired' | 'text') {
  if (preview) {
    await page.goto(`/?mockImportPreview=${preview}`);
    await settlePage(page);
  }
  await clickVisible(page, 'button', 'Replace manuscript');
  const extension = preview === 'markdown' ? 'md' : preview === 'text' ? 'txt' : 'docx';
  const dialog = confirmDialog(page, `Import Alice.${extension}`);
  await dialog.waitFor();
  return dialog;
}

// Opens a chapter's recording check from the per-chapter breakdown's check-status cell (docs/utilities/recording-coverage.md, ADR 0130;
// daw-chapter-track-auto-sync.prd.md Phase 6, which retired the row's own Check button), optionally booted with a mock seed
// (main.tsx), and waits until the stored result has been read into the slide-over. Returns the slide-over.
export async function openRecordingCheck(page: Page, chapter: string, seed?: string) {
  if (seed) {
    await page.goto(`/?${seed}`);
    await settlePage(page);
  }
  await homeLoaded(page);
  await clickVisible(page, 'button', /Show per-chapter breakdown/);
  // A prefix match: the button's own accessible name also carries its freshness or link state, which differs per row and mock seed.
  await clickVisible(page, 'button', new RegExp(`^Recording check for ${chapter}:`));
  // A prefix match: the panel's full name also carries the chapter's subtitle when it has one
  // (chapter-title-display-consistency.prd.md Q6), which this helper's callers do not all pass.
  const dialog = page.getByRole('dialog', { name: new RegExp(`^Recording check: ${chapter}\\b`) });
  await dialog.getByRole('button', { name: /^Check (recording|again)$/ }).waitFor();
  await dialog.getByText('Reading the last check…').waitFor({ state: 'detached' });
  return dialog;
}

// Opens a chapter's track slide-over from the per-chapter breakdown (chapter-track-link-control.prd.md Phase 2),
// booted with a mock seed (main.tsx's `?mockChapterLink=`), and waits for its saved-project facts to have loaded.
// Returns the dialog.
export async function openTrackPanel(page: Page, chapter: string, seed: string) {
  await page.goto(`/?${seed}`);
  await settlePage(page);
  await homeLoaded(page);
  await clickVisible(page, 'button', /Show per-chapter breakdown/);
  await clickVisible(page, 'button', new RegExp(`^Track for ${chapter}:`));
  const dialog = page.getByRole('dialog', { name: `Track: ${chapter}` });
  await dialog.getByText('Reading the saved project…').waitFor({ state: 'detached' });
  return dialog;
}

// Home booted with a stage suggestions seed (`?mockStages=`, main.tsx), once the first read has answered: the chips on the collapsed
// card (`mixed`) or its error chip (`error`) are on screen (chapter-stage-recommendations.prd.md Phase 5).
export async function openStageSuggestions(page: Page, seed: 'mixed' | 'error', expand = true) {
  await page.goto(`/?mockStages=${seed}`);
  await settlePage(page);
  await homeLoaded(page);
  await page.getByRole('button', { name: seed === 'mixed' ? '1 chapter has a suggestion' : 'Couldn’t check stage suggestions' }).waitFor();
  if (expand) await clickVisible(page, 'button', /Show per-chapter breakdown/);
}

// Scrolls the breakdown so Chapter 4, the first chapter with a suggestion, is at the top: the rows below the fold are the state.
export async function scrollToStageRows(page: Page) {
  const row = page.getByRole('row').filter({ has: page.getByRole('link', { name: /^Chapter 4 —/ }) });
  await row.evaluate((element) => element.scrollIntoView({ block: 'start' }));
  await settlePage(page);
}

// A chapter's evidence view from its row's Why, on the `mixed` seed. Returns the slide-over.
export async function openStageEvidence(page: Page, chapter: string) {
  await openStageSuggestions(page, 'mixed');
  await clickVisible(page, 'button', `Why: ${chapter}`);
  // A prefix match, for the same reason as openRecordingCheck's above.
  const view = page.getByRole('dialog', { name: new RegExp(`^Stage suggestion: ${chapter}\\b`) });
  await view.getByRole('button', { name: 'Check now' }).waitFor();
  return view;
}

// Opens Chapter 7's editing check panel from its evidence popover's "Open editing check" (editing-readiness-analysis.prd.md
// Phase 7), booted with a mock seed (`?mockEditingSignal=`/`?mockEditing=`/`?mockEditingCandidates=1`, main.tsx). Unlike
// openStageEvidence this never uses the `mixed` seed: Chapter 7 is `mixed`'s own "evidence changed" demo, whose evidence
// view shows the recording contradiction's signals, not editing's - a query-string seed instead gives Chapter 7 (already
// in Editing status in the fixture) a plain, uncontested editing signal. Returns the panel.
export async function openEditingCheckFromHome(page: Page, query: string) {
  await page.goto(`/?${query}`);
  await settlePage(page);
  await homeLoaded(page);
  await clickVisible(page, 'button', /Show per-chapter breakdown/);
  await clickVisible(page, 'button', /^Why: Chapter 7/);
  await clickVisible(page, 'button', 'Open editing check');
  const panel = page.getByRole('dialog', { name: /^Editing check: Chapter 7\b/ });
  await panel.getByRole('button', { name: /^Check editing|Check again$/ }).waitFor();
  return panel;
}

// Opens Chapter 1's editing check panel from the Tracks page's Chapter links list (the second entry point Phase 7
// names), booted with a mock seed. Returns the panel.
export async function openEditingCheckFromTracks(page: Page, query: string) {
  await page.goto(`/tracks?${query}`);
  await settlePage(page);
  await clickVisible(page, 'button', 'Editing check…');
  const panel = page.getByRole('dialog', { name: /^Editing check: Chapter 1\b/ });
  await panel.getByRole('button', { name: /^Check editing|Check again$/ }).waitFor();
  return panel;
}

// Settings' own category rail (.settings-nav, a tab list) reuses the same labels as the
// primary app nav ("Proofing", "Story Bible") - an unscoped role/name query
// matches both and .first() can silently click the wrong one (navigating
// away from Settings instead of switching category). Always scope category
// clicks to .settings-nav specifically.
export async function clickSettingsCategory(page: Page, name: string): Promise<void> {
  await page.locator('.settings-nav').getByRole('tab', { name, exact: true }).click();
}

// Settings > Local assets, optionally booted with a mock seed (?mockAssets=): the rows are on screen once the list has loaded.
export async function openLocalAssets(page: Page, seed?: string): Promise<void> {
  if (seed) {
    await page.goto(`/?mockAssets=${seed}`);
    await settlePage(page);
  }
  await goToPage(page, 'Settings');
  await clickVisible(page, 'tab', 'Global');
  await clickSettingsCategory(page, 'Local assets');
  await page.getByRole('heading', { level: 3, name: 'Small', exact: true }).waitFor();
}

// The read-aloud dialog on the `flagged` mock session (teleprompter-manuscript-integration.prd.md Phase 7), once its first
// default-visible flag (a skip) is drawn as a control in the text.
export async function openFlaggedReadAloud(page: Page) {
  await page.goto('/?mockTeleprompter=flagged');
  await settlePage(page);
  await goToPage(page, 'Manuscript');
  await clickVisible(page, 'button', 'Read Chapter 1 aloud');
  const dialog = page.getByRole('dialog', { name: /Read aloud/ });
  await dialog.locator('[data-highlight="Skipped"][role="button"]').first().waitFor();
  return dialog;
}

// A real mouse wheel over the reader text (teleprompter-engines-and-input-devices.prd.md Phase 10), far enough that the
// highlighted word leaves the view, then waits for "Following paused" and for the smooth scroll to finish, so the shot
// shows where the narrator left the text rather than a frame mid-scroll.
export async function scrollReaderByHand(page: Page): Promise<void> {
  const text = page.getByRole('region', { name: 'Chapter text' });
  const box = await text.boundingBox();
  const viewport = page.viewportSize();
  if (!box || !viewport) throw new Error('The reader text has no box to scroll over.');
  await page.mouse.move(box.x + box.width / 2, Math.min(box.y + 120, viewport.height - 40));
  await page.mouse.wheel(0, 1500);
  await page.getByText('Following paused.', { exact: false }).waitFor();
  await page.waitForFunction(() => {
    const rect = document.querySelector('[data-current-word]')?.getBoundingClientRect();
    return rect !== undefined && rect.bottom < 0;
  });
  await settlePage(page);
}

// Playwright's synthetic page.mouse.down/move/up drag doesn't reliably
// produce a non-empty window.getSelection() range for useTextSelection.ts's
// mouseup listener to pick up (unlike a real Chromium user drag, or RTL's
// fireEvent.mouseUp against a manually-constructed Range in jsdom). Building
// the Range directly and dispatching mouseup ourselves - mirroring how the
// component's own test does it - is deterministic across viewports.
export async function selectFirstParagraphText(page: Page): Promise<void> {
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

/** Selects the first whole occurrence of `word` in the reader text, the way selectFirstParagraphText selects (a Range and a mouseup). */
export async function selectReaderWord(page: Page, word: string): Promise<void> {
  await page.waitForFunction(() => [...document.querySelectorAll('[data-paragraph-text]')].some((node) => (node.textContent?.length ?? 0) >= 20));
  const selected = await page.evaluate((target) => {
    const whole = new RegExp(`\\b${target}\\b`);
    for (const paragraph of document.querySelectorAll('[data-paragraph-text]')) {
      const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const candidate = walker.currentNode as Text;
        const match = whole.exec(candidate.textContent ?? '');
        if (!match) continue;
        const range = document.createRange();
        range.setStart(candidate, match.index);
        range.setEnd(candidate, match.index + target.length);
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

/** Opens the Manuscript (with a mock seam, when given), selects `word` and presses Look up. */
export async function lookUpInReader(page: Page, word: string, url?: string): Promise<void> {
  if (url) {
    await page.goto(url);
    await settlePage(page);
  }
  await goToPage(page, 'Manuscript');
  await selectReaderWord(page, word);
  await clickVisible(page, 'button', 'Look up');
}

/** Links a chapter to its first available track from the Tracks page's Chapter links table (the same real-UI path
 * 'chapter-link-confirmed' above uses), then follows its "Open workspace" link and waits for the workspace to
 * render (edit-and-proof-workspace.prd.md Phase 2: no chapter starts linked by default in the mock). */
export async function openWorkspaceFor(page: Page, chapterTitle: string): Promise<void> {
  await goToPage(page, 'Tracks');
  const table = page.getByRole('table', { name: 'Chapter links' });
  await table.scrollIntoViewIfNeeded();
  // An exact-name cell match, not `hasText` (a substring): "Chapter 1" is also a substring of "Chapter 10"-"Chapter 12".
  const row = table.locator('tbody tr').filter({ has: page.getByRole('cell', { name: chapterTitle, exact: true }) });
  await row.getByRole('combobox').selectOption({ index: 0 });
  await row.getByRole('button', { name: 'Confirm' }).click();
  await row.getByRole('link', { name: 'Open workspace' }).click();
  await page.getByRole('heading', { level: 1, name: new RegExp(chapterTitle) }).waitFor();
}

// Some states have no known/safe driver yet (e.g. alias-typeahead, forcing
// the manuscript-not-found banner without a mock-data override seam). Those
// are left out here on purpose - the catalog entry is simply skipped.
