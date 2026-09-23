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

// Opens Chapter 1's read-aloud dialog (after a reload with a mock seam, when one is given) and waits for its resume card
// to have answered (teleprompter-manuscript-integration.prd.md Phase 10): the lookup's "Finding where..." line is gone.
async function openResumeCard(page: Page, query = ''): Promise<void> {
  if (query) {
    await page.goto(`/${query}`);
    await settlePage(page);
  }
  await goToPage(page, 'Manuscript');
  await clickVisible(page, 'button', 'Read Chapter 1 aloud');
  const card = page.getByRole('dialog', { name: /Read aloud/ }).getByRole('region', { name: 'Where you stopped' });
  await card.waitFor();
  await card.getByText(/Finding where your recording/).waitFor({ state: 'detached' });
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
/** Opens the Story Bible and presses Build / refresh, so the app asks to download the language model. */
async function askForTheLanguageModel(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await settlePage(page);
  await clickNav(page, 'Story Bible');
  await page.getByRole('button', { name: 'Build / refresh Story Bible' }).click();
}

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

// With no linked DAW file the Proofing nav item is disabled outright (AppShell's requiresDaw gate), so it cannot be
// clicked to get there - but offline review of the last completed comparison must still be reachable (PRD W16), and
// is, through Home's own "Open Proofing" card, which navigates directly and is not gated on the DAW link. Used by the
// `?mockNoDaw=1` proofing states instead of `goToPage`.
async function goToProofingViaHomeCard(page: Page): Promise<void> {
  await homeLoaded(page);
  await clickVisible(page, 'button', 'Open Proofing');
  await page.getByRole('heading', { level: 1, name: 'Proofing', exact: true }).waitFor();
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

// Opens the import review dialog with the mock's own preview (`?mockImportPreview=`, main.tsx): "Replace manuscript" begins the same
// select, preview and confirm flow as "Import manuscript". Returns the dialog, so a driver can work inside it.
async function openImportReview(page: Page, preview?: 'markdown' | 'repaired') {
  if (preview) {
    await page.goto(`/?mockImportPreview=${preview}`);
    await settlePage(page);
  }
  await clickVisible(page, 'button', 'Replace manuscript');
  const dialog = confirmDialog(page, preview === 'markdown' ? 'Import Alice.md' : 'Import Alice.docx');
  await dialog.waitFor();
  return dialog;
}

// Opens a chapter's recording check from the per-chapter breakdown (docs/utilities/recording-coverage.md, ADR 0130), optionally booted with a
// mock seed (main.tsx), and waits until the stored result has been read into the dialog. Returns the dialog.
async function openRecordingCheck(page: Page, chapter: string, seed?: string) {
  if (seed) {
    await page.goto(`/?${seed}`);
    await settlePage(page);
  }
  await homeLoaded(page);
  await clickVisible(page, 'button', /Show per-chapter breakdown/);
  await clickVisible(page, 'button', `Check recording of ${chapter}`);
  const dialog = page.getByRole('dialog', { name: `Recording check: ${chapter}` });
  await dialog.getByRole('button', { name: /^Check (recording|again)$/ }).waitFor();
  await dialog.getByText('Reading the last check…').waitFor({ state: 'detached' });
  return dialog;
}

// Settings' own category rail (.settings-nav, a tab list) reuses the same labels as the
// primary app nav ("Proofing", "Story Bible") - an unscoped role/name query
// matches both and .first() can silently click the wrong one (navigating
// away from Settings instead of switching category). Always scope category
// clicks to .settings-nav specifically.
async function clickSettingsCategory(page: Page, name: string): Promise<void> {
  await page.locator('.settings-nav').getByRole('tab', { name, exact: true }).click();
}

// Settings > Local assets, optionally booted with a mock seed (?mockAssets=): the rows are on screen once the list has loaded.
async function openLocalAssets(page: Page, seed?: string): Promise<void> {
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
async function openFlaggedReadAloud(page: Page) {
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
async function scrollReaderByHand(page: Page): Promise<void> {
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
    'daw-not-linked': async (page) => {
      // Reload with the mock's no-linked-DAW seam (see main.tsx): the header pill and the Proofing nav item pick it up at once.
      await page.goto('/?mockNoDaw=1');
      await settlePage(page);
      await homeLoaded(page);
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
      // This state is about the import dialog's own activity log, not the chained Story Bible build (B1-B3, on by
      // default): uncheck it so the import dialog stays open with "Manuscript imported" instead of closing itself
      // into a second dialog.
      await clickVisible(page, 'checkbox', 'Build the Story Bible after import');
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
    'import-review-collapsed': async (page) => {
      const review = await openImportReview(page);
      for (const group of [/^Narration chapters/, /^Front matter/, /^Reference material/]) await review.getByRole('button', { name: group }).click();
    },
    'import-review-characters': async (page) => {
      const review = await openImportReview(page);
      await review.getByRole('button', { name: /^Story Bible character suggestions/ }).click();
      await review.getByRole('checkbox', { name: /^The White Rabbit/ }).click();
    },
    'import-review-repaired': async (page) => {
      const review = await openImportReview(page, 'repaired');
      // The chapters are folded so the repairs, the last group, are on screen without scrolling the dialog.
      await review.getByRole('button', { name: /^Narration chapters/ }).click();
    },
    'recording-check-never': async (page) => {
      const dialog = await openRecordingCheck(page, 'Chapter 7');
      await dialog.getByText(/^Not checked yet/).waitFor();
    },
    'recording-check-running': async (page) => {
      const dialog = await openRecordingCheck(page, 'Chapter 7', 'mockCoverage=hold');
      await dialog.getByRole('button', { name: 'Check recording' }).click();
      // The mock holds the run at its last transcribing step, so the percent and message are the same at every viewport.
      await page.getByRole('dialog', { name: 'Checking Chapter 7' }).getByRole('status').getByText('Transcribing item 2 of 2…').waitFor();
    },
    'recording-check-complete': async (page) => {
      const dialog = await openRecordingCheck(page, 'Chapter 1');
      await dialog.getByText('All the text is recorded').waitFor();
    },
    'recording-check-incomplete': async (page) => {
      const dialog = await openRecordingCheck(page, 'Chapter 4');
      await dialog.getByText('End not read').waitFor();
    },
    'recording-check-stale': async (page) => {
      const dialog = await openRecordingCheck(page, 'Chapter 4', 'mockCoverage=stale');
      await dialog.getByText('This result is out of date').waitFor();
    },
    'recording-check-refused': async (page) => {
      const dialog = await openRecordingCheck(page, 'Chapter 7', 'mockCoverageRefusal=unmapped');
      await dialog.getByRole('button', { name: 'Check recording' }).click();
      await dialog.getByRole('alert').getByRole('combobox', { name: 'Track for Chapter 7' }).waitFor();
    },
    'recording-check-model-required': async (page) => {
      const dialog = await openRecordingCheck(page, 'Chapter 7', 'mockAssets=missing');
      await dialog.getByRole('button', { name: 'Check recording' }).click();
      await confirmDialog(page, 'Download local Whisper model?').waitFor();
    },
    'import-confirm-markdown': async (page) => {
      // The mock's Markdown seam (see main.tsx): the same book as a .md file, which is the one with the heading level choice.
      await page.goto('/?mockImportPreview=markdown');
      await settlePage(page);
      await clickVisible(page, 'button', 'Replace manuscript');
      await confirmDialog(page, 'Import Alice.md').waitFor();
    },
  },
  manuscript: {
    'invalid-payload': async (page) => {
      await page.goto('/?mockInvalidPayload=manuscript');
      await settlePage(page);
      // The page's own content never loads here, so goToPage (which waits for it) is not used: the inline error is the proof.
      await clickNav(page, 'Manuscript');
      // The words are on screen twice: Home's audiobook estimate read the same chapters first and raised a notice that stays (ADR 0075), and
      // the page then shows its own inline error. Wait for each by what it is, so neither the state nor a strict-mode locator depends on
      // which of the two rendered first.
      await page.getByRole('button', { name: 'Retry' }).waitFor();
      await page.locator('[data-tone="error"]').getByText('The app received data it could not read.').waitFor();
    },
    'read-aloud-setup': async (page) => {
      await openResumeCard(page);
      await page.getByRole('button', { name: 'Resume from here' }).waitFor();
    },
    'read-aloud-resume-chosen': async (page) => {
      await openResumeCard(page);
      await page.getByRole('button', { name: 'Resume from here' }).click();
      await page.getByText(/Start reading picks up at word/).waitFor();
    },
    // Reduced motion lands the highlight on the start word at once (usePacedCursor), and the frozen clock holds the mock's
    // replay, so the shot shows the session exactly at the resume word.
    'read-aloud-resumed': async (page) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await openResumeCard(page);
      await page.getByRole('button', { name: 'Resume from here' }).click();
      const summary = await page.getByText(/Start reading picks up at word/).textContent();
      const word = Number(/word ([\d,]+)/.exec(summary ?? '')?.[1]?.replace(/,/g, ''));
      await page.getByRole('combobox', { name: 'Microphone' }).selectOption({ label: 'Microphone Array (Realtek(R) Audio)' });
      await freezeClock(page);
      await page.getByRole('button', { name: 'Start reading' }).click();
      await page.locator(`[data-word="${word}"] [data-highlight="Cursor"]`).waitFor();
    },
    'read-aloud-resume-low-confidence': async (page) => {
      await openResumeCard(page, '?mockResume=low_confidence');
      await page.getByText(/could also fit elsewhere/).waitFor();
    },
    'read-aloud-resume-not-found': async (page) => {
      await openResumeCard(page, '?mockResume=not_found');
      await page.getByText(/did not match this chapter/).waitFor();
    },
    'read-aloud-resume-pick-track': async (page) => {
      await openResumeCard(page, '?mockResume=ambiguous');
      await page.getByRole('combobox', { name: 'Track' }).waitFor();
    },
    'read-aloud-resume-no-track': async (page) => {
      await openResumeCard(page, '?mockResume=none');
      await page.getByText(/No track in Alice.rpp matches this chapter/).waitFor();
    },
    'read-aloud-resume-no-recording': async (page) => {
      await openResumeCard(page, '?mockResume=no_recording');
      await page.getByText(/has no recorded audio yet/).waitFor();
    },
    'read-aloud-resume-source-missing': async (page) => {
      await openResumeCard(page, '?mockResume=source_missing');
      await page.getByText(/audio file is missing/).waitFor();
    },
    'read-aloud-resume-source-unsupported': async (page) => {
      await openResumeCard(page, '?mockResume=source_unsupported');
      await page.getByText(/cannot be read as audio/).waitFor();
    },
    'read-aloud-resume-model-required': async (page) => {
      await openResumeCard(page, '?mockAssets=missing');
      await page.getByRole('button', { name: 'Download model…' }).waitFor();
    },
    'read-aloud-resume-error': async (page) => {
      await openResumeCard(page, '?mockResume=error');
      await page.getByRole('button', { name: 'Try again' }).waitFor();
    },
    // Same mock seam and word as the standalone Teleprompter page's `listening` state, opened through the modal instead.
    'read-aloud-listening': async (page) => {
      await page.goto('/?mockTeleprompter=listening');
      await settlePage(page);
      await goToPage(page, 'Manuscript');
      await clickVisible(page, 'button', 'Read Chapter 1 aloud');
      await page.locator('[data-word="35"] [data-highlight="Cursor"]').waitFor();
    },
    // Manual scroll (teleprompter-engines-and-input-devices.prd.md Phase 10), in the dialog: see the Teleprompter page's `following-paused`.
    'read-aloud-following-paused': async (page) => {
      await page.goto('/?mockTeleprompter=listening');
      await settlePage(page);
      await goToPage(page, 'Manuscript');
      await clickVisible(page, 'button', 'Read Chapter 1 aloud');
      await page.locator('[data-word="35"] [data-highlight="Cursor"]').waitFor();
      await scrollReaderByHand(page);
    },
    // Word-click seek (teleprompter-manuscript-integration.prd.md Phase 4): from the same listening state as above, click
    // the earliest "Go back to here" word (word 0) and wait for the highlight to land there without restarting.
    'read-aloud-seek-back': async (page) => {
      await page.goto('/?mockTeleprompter=listening');
      await settlePage(page);
      await goToPage(page, 'Manuscript');
      await clickVisible(page, 'button', 'Read Chapter 1 aloud');
      await page.locator('[data-word="35"] [data-highlight="Cursor"]').waitFor();
      await page
        .getByRole('button', { name: /^Go back to here/ })
        .first()
        .click();
      await page.locator('[data-word="0"] [data-highlight="Cursor"]').waitFor();
    },
    // Story bible and note marks (teleprompter-manuscript-integration.prd.md Phase 5): a mark opens its entry in the
    // dialog's rail; the reader behind the dialog has marks of its own, so every lookup is scoped to the dialog.
    'read-aloud-story-bible-entry': async (page) => {
      await page.goto('/?mockTeleprompter=listening');
      await settlePage(page);
      await goToPage(page, 'Manuscript');
      await clickVisible(page, 'button', 'Read Chapter 1 aloud');
      const dialog = page.getByRole('dialog', { name: /Read aloud/ });
      await dialog.locator('[data-word="35"] [data-highlight="Cursor"]').waitFor();
      await dialog.locator('[data-highlight="Character"][role="button"]').first().click();
      await dialog.getByRole('tab', { name: 'Story bible', selected: true }).waitFor();
    },
    'read-aloud-note-open': async (page) => {
      await goToPage(page, 'Manuscript');
      await clickVisible(page, 'button', 'Read Chapter 1 aloud');
      const dialog = page.getByRole('dialog', { name: /Read aloud/ });
      await dialog.locator('[data-highlight="Note"][role="button"]').first().click();
      await dialog.getByRole('tab', { name: 'Notes', selected: true }).waitFor();
    },
    'read-aloud-rail-hidden': async (page) => {
      await goToPage(page, 'Manuscript');
      await clickVisible(page, 'button', 'Read Chapter 1 aloud');
      const dialog = page.getByRole('dialog', { name: /Read aloud/ });
      await dialog.getByRole('button', { name: 'Hide reading panel' }).click();
      await dialog.getByRole('button', { name: 'Show reading panel' }).waitFor();
    },
    // Suspected flags (teleprompter-manuscript-integration.prd.md Phase 7): the `flagged` mock seam is a session further into
    // the chapter whose flags arrive as the dialog subscribes. The rail's key has flag swatches too, so marks are found as controls.
    'read-aloud-flags': async (page) => {
      await openFlaggedReadAloud(page);
    },
    'read-aloud-flag-open': async (page) => {
      const dialog = await openFlaggedReadAloud(page);
      await dialog.locator('[data-highlight="Restart"][role="button"]').first().click();
      await dialog.getByRole('tab', { name: 'Flags', selected: true }).waitFor();
      await dialog.getByRole('region', { name: 'Suspected restart' }).waitFor();
    },
    'read-aloud-flags-all-kinds': async (page) => {
      const dialog = await openFlaggedReadAloud(page);
      await dialog.getByRole('tab', { name: 'Flags' }).click();
      await dialog.getByRole('checkbox', { name: 'Misreads' }).click();
      await dialog.getByRole('checkbox', { name: 'Extra words' }).click();
      await dialog.locator('[data-highlight="Misread"][role="button"]').first().waitFor();
      await dialog.locator('[data-highlight="Extra"][role="button"]').first().waitFor();
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
    'chapters-overlay-searching': async (page) => {
      await goToPage(page, 'Manuscript');
      await clickVisible(page, 'button', 'Chapters & Search');
      // Captured right after typing, before the debounce settles (R1) - the chapter-title subset
      // (R2) and the "Searching…" hint are what this state exists to show.
      await page.getByPlaceholder('Search manuscript…').fill('Pool');
    },
    'chapters-overlay-search': async (page) => {
      await goToPage(page, 'Manuscript');
      await clickVisible(page, 'button', 'Chapters & Search');
      await page.getByPlaceholder('Search manuscript…').fill('Alice');
      // Waits out the real 2s debounce for the settled, highlighted result row (R3, R4).
      await page.locator('[data-highlight="Search"]').first().waitFor();
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
    'credits-entries': async (page) => {
      await goToPage(page, 'Manuscript');
      // Collapse the real chapters first: chapter 1's body has the seeded overlapping entity/note marks used by the
      // 'overlapping-highlights' state (axe-debt.ts, #155) - collapsing keeps this state's own screenshot free of
      // that unrelated, already-tracked issue instead of growing the axe-debt ratchet for an unrelated reason.
      await clickVisible(page, 'button', 'Collapse all chapters');
      // The default mock project has no Title/Author/Narrator value set, so the shipped opening template's tokens
      // render as unresolved chips (C6) - expanding it shows both the chip and the "unresolved token(s)" count.
      await clickVisible(page, 'button', 'Opening credits');
      await page.getByText(/unresolved token/).waitFor();
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
    'no-daw': async (page) => {
      // Reload with the mock's no-linked-DAW seam (see main.tsx). The Proofing nav item is disabled outright with no
      // linked DAW file, so reach the page through Home's own "Open Proofing" card instead of the nav (it stays
      // enabled: the mock always has a last completed comparison to review, PRD W16). Start comparison is disabled
      // once there. Its reason is not opened here (unlike proofing/disabled-button): that portalled tooltip already
      // has its own declared axe debt (#157) and the escape hatch has a shrink-only cap (MAX_AXE_DEBT_RULES,
      // visualSuite.test.ts) - the disabled button's own look is enough to show the gating without another entry.
      await page.goto('/?mockNoDaw=1');
      await settlePage(page);
      await goToProofingViaHomeCard(page);
      await page.getByRole('button', { name: 'Start comparison' }).waitFor();
    },
    'no-daw-review': async (page) => {
      // Offline review of the last completed comparison stays reachable with no linked DAW file (PRD W16): reach
      // Proofing through Home's card (the nav item itself is disabled), then follow the "Last narrated take" link from
      // Setup into the results view, where Play recorded audio and Export are disabled.
      await page.goto('/?mockNoDaw=1');
      await settlePage(page);
      await goToProofingViaHomeCard(page);
      await clickVisible(page, 'button', /Last narrated take/);
      await page.locator('tr[data-row]').first().waitFor();
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
    'language-model-confirm': async (page) => {
      await askForTheLanguageModel(page, '/?mockAssets=missing');
      await page.getByRole('alertdialog', { name: 'Download local language model?' }).waitFor();
    },
    'language-model-progress': async (page) => {
      await askForTheLanguageModel(page, '/?mockAssets=downloading');
      await page.getByRole('button', { name: 'Download model' }).click();
      await page.getByRole('dialog', { name: 'Downloading language model' }).waitFor();
      await page.getByText(/5 of 12 MB/).waitFor();
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
    'entry-pronunciation-missing': async (page) => {
      await goToPage(page, 'Story Bible');
      // March Hare has no pronunciation in the fixture data.
      await page.locator('tr[data-row]', { hasText: 'March Hare' }).click();
      await clickVisible(page, 'button', 'Edit this entry');
    },
    'delete-confirm': async (page) => {
      await goToPage(page, 'Story Bible');
      await page.locator('tr[data-row]').first().click();
      // Delete only exists in edit mode (ADR 0087); the delete button is unreachable
      // while the selected entity is locked, and unlocking never happens mid-edit,
      // so unlock it first if needed - regardless of which entity sorts first.
      const unlock = page.getByRole('button', { name: 'Unlock entry' });
      if (await unlock.count()) await unlock.click();
      await clickVisible(page, 'button', 'Edit this entry');
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
    'entry-properties-editing': async (page) => {
      await goToPage(page, 'Story Bible');
      await page.locator('tr[data-row]').first().click();
      const unlock = page.getByRole('button', { name: 'Unlock entry' });
      if (await unlock.count()) await unlock.click();
      await clickVisible(page, 'button', 'Edit this entry');
      await clickVisible(page, 'button', 'Add property');
      await page.getByRole('textbox', { name: 'Property 3 value' }).fill('Wren');
      await clickVisible(page, 'button', 'Save changes to this entry');
      await page.getByRole('alert').filter({ hasText: 'Give property 3 a name' }).waitFor();
      // The properties table is below the fold of the detail panel: bring it into view for the screenshot.
      await page.getByRole('table', { name: 'Properties' }).scrollIntoViewIfNeeded();
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
    'no-daw-link': async (page) => {
      // Reload with the mock's no-linked-DAW seam (see main.tsx): Tracks still reads its own .rpp discovery, but its
      // own DAW-link control switches from "Link a different REAPER project file" to "Link a REAPER project file".
      await page.goto('/?mockNoDaw=1');
      await settlePage(page);
      await goToPage(page, 'Tracks');
      await page.getByRole('button', { name: 'Play', exact: true }).first().waitFor();
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
    'chapter-link-confirmed': async (page) => {
      await goToPage(page, 'Tracks');
      await page.getByRole('button', { name: 'Play', exact: true }).first().waitFor();
      const table = page.getByRole('table', { name: 'Chapter links' });
      await table.scrollIntoViewIfNeeded();
      // The first body row, by position: filtering by "has a combobox" would stop matching this same row the
      // instant Confirm turns it into the linked view (no combobox), so `waitFor` below would wait forever.
      const firstRow = table.locator('tbody tr').first();
      await firstRow.getByRole('combobox').selectOption({ index: 0 });
      await firstRow.getByRole('button', { name: 'Confirm' }).click();
      await firstRow.getByRole('button', { name: 'Change' }).waitFor();
    },
    'chapter-link-missing': async (page) => {
      // Reload with the mock's missing-track seam (see main.tsx): a confirmed link whose
      // trackGuid is not among the mock project's tracks.
      await page.goto('/?mockChapterLink=missing');
      await settlePage(page);
      await goToPage(page, 'Tracks');
      const table = page.getByRole('table', { name: 'Chapter links' });
      await table.scrollIntoViewIfNeeded();
      await page.getByText('Track missing').waitFor();
    },
    'link-chapters-preview': async (page) => {
      await goToPage(page, 'Tracks');
      await clickVisible(page, 'button', 'Link chapters…');
      await page.getByRole('combobox', { name: 'Track for Chapter 1', exact: true }).selectOption({ label: 'Chapter 1' });
      await page.getByRole('button', { name: /^Stamp \d+ items?$/ }).waitFor();
    },
    'link-chapters-success': async (page) => {
      await page.goto('/?mockLineIdentity=success');
      await settlePage(page);
      await goToPage(page, 'Tracks');
      await clickVisible(page, 'button', 'Link chapters…');
      const message = page.getByText('Read 5 stamped lines.');
      await message.waitFor();
      await message.scrollIntoViewIfNeeded();
    },
    'link-chapters-conflict': async (page) => {
      await page.goto('/?mockLineIdentity=conflict');
      await settlePage(page);
      await goToPage(page, 'Tracks');
      await clickVisible(page, 'button', 'Link chapters…');
      const message = page.getByText(/Stamped 1 line, 1 stale item, 1 conflict\./);
      await message.waitFor();
      await message.scrollIntoViewIfNeeded();
    },
    'link-chapters-error': async (page) => {
      await page.goto('/?mockLineIdentity=error');
      await settlePage(page);
      await goToPage(page, 'Tracks');
      await clickVisible(page, 'button', 'Link chapters…');
      const message = page.getByText(/Narration Utils script/).first();
      await message.waitFor();
      await message.scrollIntoViewIfNeeded();
    },
    'pickups-empty': async (page) => {
      await goToPage(page, 'Tracks');
      await clickVisible(page, 'button', 'Pickups…');
      await page.getByText('No pickups yet').waitFor();
    },
    'pickups-imported': async (page) => {
      await goToPage(page, 'Tracks');
      await clickVisible(page, 'button', 'Pickups…');
      await page.locator('input[type="file"]').setInputFiles({
        name: 'pickups.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from('start,note,tag\n1.5,Mispronounced "labyrinthine",narrator\n42,Dog barked in the background,\n'),
      });
      await page.getByText('2 pickups remaining of 2').waitFor();
    },
    'pickups-import-errors': async (page) => {
      await goToPage(page, 'Tracks');
      await clickVisible(page, 'button', 'Pickups…');
      await page.locator('input[type="file"]').setInputFiles({
        name: 'pickups.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from('1.5,Good row\nnot-a-number,Bad row\n'),
      });
      await page.getByText(/1 row could not be used/).waitFor();
      // The row report lands immediately; the run itself settles 300ms later in the mock. Wait for the
      // completed message too, so the screenshot shows the settled "1 pickup remaining" count, not a still-busy
      // Import button over a stale "No pickups yet".
      await page.getByText('Imported 1 pickup.').waitFor();
    },
    'pickups-next': async (page) => {
      await page.goto('/?mockPickups=import-success');
      await settlePage(page);
      await goToPage(page, 'Tracks');
      await clickVisible(page, 'button', 'Pickups…');
      await clickVisible(page, 'button', 'Next pickup');
      await page.getByRole('button', { name: 'Mark this pickup done' }).waitFor();
    },
    'pickups-error': async (page) => {
      await page.goto('/?mockPickups=error');
      await settlePage(page);
      await goToPage(page, 'Tracks');
      await clickVisible(page, 'button', 'Pickups…');
      const message = page.getByText(/Narration Utils script/).first();
      await message.waitFor();
      await message.scrollIntoViewIfNeeded();
    },
    'render-config-prefilled': async (page) => {
      await goToPage(page, 'Tracks');
      await clickVisible(page, 'button', 'Prepare chapter render…');
      await page.getByRole('button', { name: 'Configure render' }).waitFor();
    },
    'render-config-success': async (page) => {
      await page.goto('/?mockRenderConfig=success');
      await settlePage(page);
      await goToPage(page, 'Tracks');
      await clickVisible(page, 'button', 'Prepare chapter render…');
      const message = page.getByText(/Render is configured/);
      await message.waitFor();
      await message.scrollIntoViewIfNeeded();
    },
    'render-config-no-regions': async (page) => {
      await page.goto('/?mockRenderConfig=no-regions');
      await settlePage(page);
      await goToPage(page, 'Tracks');
      await clickVisible(page, 'button', 'Prepare chapter render…');
      const message = page.getByText(/No chapter regions were found yet/);
      await message.waitFor();
      await message.scrollIntoViewIfNeeded();
    },
    'render-config-error': async (page) => {
      await page.goto('/?mockRenderConfig=error');
      await settlePage(page);
      await goToPage(page, 'Tracks');
      await clickVisible(page, 'button', 'Prepare chapter render…');
      const message = page.getByText(/cannot configure render settings/).first();
      await message.waitFor();
      await message.scrollIntoViewIfNeeded();
    },
    'chapter-tags-idle': async (page) => {
      await goToPage(page, 'Tracks');
      await clickVisible(page, 'button', 'Embed chapter tags…');
      await page.getByText(/No chapter render is configured yet/).waitFor();
    },
    'chapter-tags-ready': async (page) => {
      await page.goto('/?mockChapterTags=ready');
      await settlePage(page);
      await goToPage(page, 'Tracks');
      await clickVisible(page, 'button', 'Embed chapter tags…');
      await page.getByRole('dialog', { name: 'Embed chapter tags' }).getByText('Chapter 2').waitFor();
    },
    'chapter-tags-not-rendered': async (page) => {
      await page.goto('/?mockChapterTags=not-rendered');
      await settlePage(page);
      await goToPage(page, 'Tracks');
      await clickVisible(page, 'button', 'Embed chapter tags…');
      await page.getByText('not rendered yet').waitFor();
    },
    'chapter-tags-success': async (page) => {
      await page.goto('/?mockChapterTags=ready');
      await settlePage(page);
      await goToPage(page, 'Tracks');
      await clickVisible(page, 'button', 'Embed chapter tags…');
      await page.getByLabel('Combined book MP3 to add chapters to').fill('C:\\Books\\Alice\\Alice in Wonderland.mp3');
      await page.getByRole('checkbox', { name: /I understand this writes a new file/ }).click();
      await clickVisible(page, 'button', 'Embed chapter tags');
      await page.getByText(/^Wrote /).waitFor();
    },
    'chapter-tags-error': async (page) => {
      await page.goto('/?mockChapterTags=ready&mockChapterTagsEmbedError=1');
      await settlePage(page);
      await goToPage(page, 'Tracks');
      await clickVisible(page, 'button', 'Embed chapter tags…');
      await page.getByLabel('Combined book MP3 to add chapters to').fill('C:\\Books\\Alice\\Alice in Wonderland.mp3');
      await page.getByRole('checkbox', { name: /I understand this writes a new file/ }).click();
      await clickVisible(page, 'button', 'Embed chapter tags');
      const message = page.getByText(/could not write chapter tags/).first();
      await message.waitFor();
      await message.scrollIntoViewIfNeeded();
    },
    'take-review-results': async (page) => {
      await goToPage(page, 'Tracks');
      // Chapter 1 is already the active track; the mock seeds findings for it.
      await clickVisible(page, 'button', 'Scan for pickups & duplicates');
      await page.getByRole('table', { name: 'Pickup and duplicate findings' }).waitFor();
    },
    'take-review-empty': async (page) => {
      await goToPage(page, 'Tracks');
      await clickVisible(page, 'button', /Chapter 2/); // the mock only seeds findings for Chapter 1
      await clickVisible(page, 'button', 'Scan for pickups & duplicates');
      await page.getByText('No repeated reads found on this track.').waitFor();
    },
    'take-review-audition': async (page) => {
      await goToPage(page, 'Tracks');
      await clickVisible(page, 'button', 'Scan for pickups & duplicates');
      await page.getByRole('table', { name: 'Pickup and duplicate findings' }).waitFor();
      await clickVisible(page, 'button', 'Audition');
      await page.getByRole('dialog', { name: 'Audition candidate reads' }).waitFor();
    },
  },
  teleprompter: {
    'setup-default': async (page) => {
      await goToPage(page, 'Teleprompter');
      await page.getByText('Alice was beginning').first().waitFor();
    },
    'chapter-suggested': async (page) => {
      await page.goto('/?mockChapterSuggestion=matched');
      await settlePage(page);
      await goToPage(page, 'Teleprompter');
      await page.getByText(/Chosen from REAPER's armed track/).waitFor();
      await page
        .getByText(/Curiouser and curiouser/)
        .first()
        .waitFor();
    },
    'chapter-suggestion-choices': async (page) => {
      await page.goto('/?mockChapterSuggestion=ambiguous');
      await settlePage(page);
      await goToPage(page, 'Teleprompter');
      await page.getByRole('group', { name: 'Chapters suggested by REAPER' }).waitFor();
      await page.getByText('Alice was beginning').first().waitFor();
    },
    // The Whisper model is not installed under ?mockAssets, so Start reading asks to download it; the mock holds the download at 40 percent.
    'model-download-progress': async (page) => {
      await page.goto('/?mockAssets=downloading');
      await settlePage(page);
      await goToPage(page, 'Teleprompter');
      await page.getByText('Alice was beginning').first().waitFor();
      // A plain `getByLabel('Microphone')` also matches the disabled Start button's tooltip wrapper (aria-label
      // "Choose a microphone first.") while no device is chosen yet, so this scopes to the select itself.
      await page.getByRole('combobox', { name: 'Microphone' }).selectOption({ label: 'Microphone Array (Realtek(R) Audio)' });
      await page.getByRole('button', { name: 'Start reading' }).click();
      await page.getByRole('button', { name: 'Download model' }).click();
      await page.getByRole('dialog', { name: 'Downloading Whisper model' }).waitFor();
      await page.getByText(/185 of 464 MB/).waitFor();
    },
    // Choosing Moonshine never downloads: its model is missing under ?mockAssets=missing, so Start reading asks first, naming the engine.
    'moonshine-model-required': async (page) => {
      await page.goto('/?mockAssets=missing');
      await settlePage(page);
      await goToPage(page, 'Teleprompter');
      await page.getByText('Alice was beginning').first().waitFor();
      await page.getByRole('combobox', { name: 'Microphone' }).selectOption({ label: 'Microphone Array (Realtek(R) Audio)' });
      await page.getByRole('group', { name: 'Engine' }).getByRole('button', { name: 'Moonshine' }).click();
      await page.getByRole('button', { name: 'Start reading' }).click();
      await page.getByRole('alertdialog', { name: 'Download local Moonshine model?' }).waitFor();
    },
    'no-microphone-blocked': async (page) => {
      await page.goto('/?mockNoDevices=1');
      await settlePage(page);
      await goToPage(page, 'Teleprompter');
      await page.getByText('Alice was beginning').first().waitFor();
      await page.getByText('No microphone found').waitFor();
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
    // Manual scroll (teleprompter-engines-and-input-devices.prd.md Phase 10): from the listening state, a mouse wheel over
    // the text pauses following; the text stays where the narrator scrolled it, well past the highlighted word.
    'following-paused': async (page) => {
      await page.goto('/?mockTeleprompter=listening');
      await settlePage(page);
      await goToPage(page, 'Teleprompter');
      await page.locator('[data-word="35"] [data-highlight="Cursor"]').waitFor();
      await scrollReaderByHand(page);
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
    'stopped-at-end': async (page) => {
      await page.goto('/?mockTeleprompter=ended');
      await settlePage(page);
      await goToPage(page, 'Teleprompter');
      await page.getByRole('status').filter({ hasText: 'Stopped at the end of the chapter.' }).waitFor();
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
    'global-recording-check': async (page) => {
      await goToPage(page, 'Settings');
      await clickVisible(page, 'tab', 'Global');
      await clickSettingsCategory(page, 'Recording check');
      await page.getByText('Proposed values, not yet calibrated').waitFor();
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
    'global-delivery': async (page) => {
      await goToPage(page, 'Settings');
      await clickVisible(page, 'tab', 'Global');
      await clickSettingsCategory(page, 'Delivery');
      await page.getByText('No limits set').waitFor();
    },
    'global-delivery-invalid': async (page) => {
      await goToPage(page, 'Settings');
      await clickVisible(page, 'tab', 'Global');
      await clickSettingsCategory(page, 'Delivery');
      await page.getByRole('textbox', { name: 'True peak, highest' }).fill('-3');
      await page.getByRole('textbox', { name: 'Sample peak, highest' }).fill('5');
      await page.getByText('Enter a value from -60 to 0 dBFS.').scrollIntoViewIfNeeded();
    },
    'global-daw': async (page) => {
      await goToPage(page, 'Settings');
      await clickVisible(page, 'tab', 'Global');
      await clickSettingsCategory(page, 'DAW Integration');
      await page.getByText('REAPER detected').waitFor();
    },
    'global-daw-not-detected': async (page) => {
      await page.goto('/?mockDawNotDetected=1');
      await settlePage(page);
      await goToPage(page, 'Settings');
      await clickVisible(page, 'tab', 'Global');
      await clickSettingsCategory(page, 'DAW Integration');
      await page.getByRole('button', { name: 'Get REAPER' }).waitFor();
    },
    'global-daw-handoff': async (page) => {
      // Reload with the mock's no-linked-DAW seam (see main.tsx): REAPER stays detected (dawCatalogInstalled
      // defaults true), only dawFileLinked flips, so the catalog panel's handoff button appears.
      await page.goto('/?mockNoDaw=1');
      await settlePage(page);
      await goToPage(page, 'Settings');
      await clickVisible(page, 'tab', 'Global');
      await clickSettingsCategory(page, 'DAW Integration');
      await page.getByRole('button', { name: 'Link a REAPER project file' }).waitFor();
    },
    'global-tts': async (page) => {
      await goToPage(page, 'Settings');
      await clickVisible(page, 'tab', 'Global');
      await clickSettingsCategory(page, 'TTS');
    },
    'global-teleprompter': async (page) => {
      await goToPage(page, 'Settings');
      await clickVisible(page, 'tab', 'Global');
      await clickSettingsCategory(page, 'Teleprompter');
    },
    'global-about': async (page) => {
      await goToPage(page, 'Settings');
      await clickVisible(page, 'tab', 'Global');
      await clickSettingsCategory(page, 'About & updates');
      await page.getByText('Not checked yet.').waitFor();
    },
    'local-assets': async (page) => {
      await openLocalAssets(page);
    },
    'local-assets-downloading': async (page) => {
      await openLocalAssets(page, 'installing');
      await page.getByRole('progressbar', { name: /Download progress for/ }).waitFor();
      await page
        .getByText(/44 of 109 MB/)
        .first()
        .waitFor();
    },
    'local-assets-verifying': async (page) => {
      await openLocalAssets(page, 'checking');
      await page.getByRole('button', { name: /^Verifying Preview voice LJ Speech/ }).waitFor();
    },
    'local-assets-needs-repair': async (page) => {
      await openLocalAssets(page, 'damaged');
      await page.getByRole('button', { name: 'Repair Whisper model Small' }).waitFor();
    },
    'local-assets-failed': async (page) => {
      await openLocalAssets(page, 'download-fails');
      await page.getByRole('button', { name: 'Download Preview voice LJ Speech (U.S. English)' }).click();
      await page.getByRole('alert').filter({ hasText: 'did not match the approved one' }).waitFor();
    },
    'local-assets-remove-confirm': async (page) => {
      await openLocalAssets(page);
      await page.getByRole('button', { name: 'Remove Whisper model Small' }).click();
      await confirmDialog(page, 'Remove Whisper model Small?').waitFor();
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
    'project-recording-check': async (page) => {
      await goToPage(page, 'Settings');
      await clickVisible(page, 'tab', 'This Project');
      await clickSettingsCategory(page, 'Recording check');
      await page.getByText('A value left blank here uses the Global one.').waitFor();
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
    'project-delivery': async (page) => {
      await goToPage(page, 'Settings');
      await clickVisible(page, 'tab', 'This Project');
      await clickSettingsCategory(page, 'Delivery');
      await page.getByText('A limit left blank here uses the Global one.').waitFor();
    },
    'project-daw': async (page) => {
      await goToPage(page, 'Settings');
      await clickVisible(page, 'tab', 'This Project');
      await clickSettingsCategory(page, 'DAW Integration');
      // The header pill's own text is also "REAPER project linked" (it is a plain text node, not just its aria-label),
      // so wait on copy unique to the settings panel instead of the ambiguous status line.
      await page.getByText('Tracks and Proofing read from the linked .rpp file.').waitFor();
    },
    'project-daw-not-linked': async (page) => {
      // Reload with the mock's no-linked-DAW seam (see main.tsx): the project-scope DAW category (new in this phase,
      // PRD W19 - previously global-only) shows its unlinked copy and "Link a REAPER project file".
      await page.goto('/?mockNoDaw=1');
      await settlePage(page);
      await goToPage(page, 'Settings');
      await clickVisible(page, 'tab', 'This Project');
      await clickSettingsCategory(page, 'DAW Integration');
      // Same ambiguity as the linked state: wait on the panel's own copy, not the header pill's identical text.
      await page.getByText('Link a REAPER project (.rpp) file to unlock Tracks and Proofing.').waitFor();
    },
    'project-data': async (page) => {
      await goToPage(page, 'Settings');
      await clickVisible(page, 'tab', 'This Project');
      await clickSettingsCategory(page, 'Project data');
    },
    'project-credits': async (page) => {
      await goToPage(page, 'Settings');
      await clickVisible(page, 'tab', 'This Project');
      await clickSettingsCategory(page, 'Credits');
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
      await clickVisible(page, 'button', 'Edit this entry');
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
