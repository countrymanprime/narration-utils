// How to reach each `script` state in STATE_CATALOG (see app.drivers.ts).
import type { Page } from '@playwright/test';
import { settlePage } from '../helpers/settle';
import {
  type Driver,
  clickNav,
  clickSettingsCategory,
  clickVisible,
  goToPage,
  lookUpInReader,
  PAGE_HEADING,
  selectFirstParagraphText,
  selectReaderWord,
} from './shared';

export const scriptDrivers: Record<string, Driver> = {
  'invalid-payload': async (page) => {
    await page.goto('/?mockInvalidPayload=manuscript');
    await settlePage(page);
    // The page's own content never loads here, so goToPage (which waits for it) is not used: the inline error is the proof.
    await clickNav(page, 'Script');
    // The words are on screen twice: Home's audiobook estimate read the same chapters first and raised a notice that stays (ADR 0075), and
    // the page then shows its own inline error. Wait for each by what it is, so neither the state nor a strict-mode locator depends on
    // which of the two rendered first.
    await page.getByRole('button', { name: 'Retry' }).waitFor();
    await page.locator('[data-tone="error"]').getByText('The app received data it could not read.').waitFor();
  },
  'reader-text-small': async (page) => {
    await goToPage(page, 'Script');
    await clickVisible(page, 'button', 'small');
  },
  'reader-text-medium': async (page) => {
    await goToPage(page, 'Script');
    await clickVisible(page, 'button', 'medium');
  },
  'reader-text-large': async (page) => {
    await goToPage(page, 'Script');
    await clickVisible(page, 'button', 'large');
  },
  'chapters-overlay-open': async (page) => {
    await goToPage(page, 'Script');
    await clickVisible(page, 'button', 'Chapters & Search');
  },
  'chapters-overlay-searching': async (page) => {
    await goToPage(page, 'Script');
    await clickVisible(page, 'button', 'Chapters & Search');
    // Captured right after typing, before the debounce settles (R1) - the chapter-title subset
    // (R2) and the "Searching…" hint are what this state exists to show.
    await page.getByPlaceholder('Search Script…').fill('Pool');
  },
  'chapters-overlay-search': async (page) => {
    await goToPage(page, 'Script');
    await clickVisible(page, 'button', 'Chapters & Search');
    await page.getByPlaceholder('Search Script…').fill('Alice');
    // Waits out the real 2s debounce for the settled, highlighted result row (R3, R4).
    await page.locator('[data-highlight="Search"]').first().waitFor();
  },
  'detail-sidebar-note': async (page) => {
    await goToPage(page, 'Script');
    // The default chapter's seeded note spans a whole paragraph, and an
    // entity <mark> nested inside it calls stopPropagation() on click - a
    // click resolving to that nested mark never reaches the outer note's
    // handler. Exclude notes that contain another highlight so the click
    // lands on the note itself.
    await page.locator('[data-highlight="Note"]:not(:has([data-highlight]))').first().click();
  },
  'detail-sidebar-entity': async (page) => {
    await goToPage(page, 'Script');
    await page.locator('mark.ms-highlight').first().click();
  },
  'selection-popup': async (page) => {
    await goToPage(page, 'Script');
    // One word, so the popup shows every action it has (Look up is offered for one word only).
    await selectReaderWord(page, 'bank');
    await page.getByRole('button', { name: 'Look up' }).waitFor();
  },
  'overlapping-highlights': async (page) => {
    await goToPage(page, 'Script');
    // The state is an entity highlight overlapping a note: wait for both (a Note is a `mark.ms-highlight` too, so the
    // entity is any highlight that is not a Note).
    await page.locator('mark[data-highlight]:not([data-highlight="Note"])').first().waitFor();
    await page.locator('[data-highlight="Note"]').first().waitFor();
  },
  'sticky-header-scrolled': async (page) => {
    await goToPage(page, 'Script');
    // The wheel scrolls whatever is under the pointer, so aim it at the reader.
    await page.locator('#manuscript-text, .manuscript-reader').first().hover();
    await page.mouse.wheel(0, 600);
    await page.waitForFunction(() => window.scrollY > 0 || [...document.querySelectorAll('*')].some((el) => el.scrollTop > 0));
  },
  'chapter-collapsed': async (page) => {
    await goToPage(page, 'Script');
    await clickVisible(page, 'button', 'Collapse all chapters');
  },
  // manuscript-chapter-header-alignment.prd.md: the stat block (words, read time) and the action slot (Read aloud,
  // empty on Front Matter) are fixed-width columns, so every row's stat block ends at the same x and every Read
  // aloud button starts at the same x, whether or not that row has a button. Collapsed, so every header in view at
  // once; the assertion below is the "driver assertion" the PRD calls for, not just a screenshot.
  'chapter-header-columns': async (page) => {
    await page.goto('/?mockManuscript=mixed');
    await settlePage(page);
    // Not goToPage: the reader opens with only its first entry expanded, which here is the Opening credits card (no
    // [data-paragraph-text]), so the page has arrived once its heading and the rows waited for below are there.
    await clickNav(page, 'Script');
    await page.getByRole('heading', { level: 1, name: PAGE_HEADING.Script, exact: true }).waitFor();
    await clickVisible(page, 'button', 'Collapse all chapters');
    await page.locator('.reader-chapters').getByRole('button', { name: 'Front Matter' }).waitFor();
    await page
      .getByRole('button', { name: /^Record .* in Booth$/ })
      .first()
      .waitFor();
    await page.waitForFunction(() => {
      const buttons = [...document.querySelectorAll<HTMLElement>('article header button[aria-label^="Record "]')];
      const stats = [...document.querySelectorAll<HTMLElement>('article header [class*="min-w-"]')];
      if (buttons.length < 2 || stats.length < 3) return false;
      const left = buttons[0].getBoundingClientRect().left;
      const right = stats[0].getBoundingClientRect().right;
      const buttonsAlign = buttons.every((button) => Math.abs(button.getBoundingClientRect().left - left) <= 1);
      const statsAlign = stats.every((stat) => Math.abs(stat.getBoundingClientRect().right - right) <= 1);
      return buttonsAlign && statsAlign;
    });
  },
  'word-lookup-definition': async (page) => {
    await lookUpInReader(page, 'bank');
    await page.getByRole('dialog', { name: 'Look up: bank' }).getByText('sloping land', { exact: false }).waitFor();
  },
  'word-lookup-not-found': async (page) => {
    await lookUpInReader(page, 'Alice');
    await page.getByText('“alice” is not in the dictionary.').waitFor();
  },
  'word-lookup-not-installed': async (page) => {
    await lookUpInReader(page, 'bank', '/?mockDictionary=missing');
    await page.getByRole('alertdialog', { name: 'Download the dictionary?' }).waitFor();
  },
  'word-lookup-damaged': async (page) => {
    await lookUpInReader(page, 'bank', '/?mockDictionary=damaged');
    await page.getByRole('alertdialog', { name: 'Repair the dictionary?' }).waitFor();
  },
  // prep-depth.prd.md Phase 5: the `?mockMarkup=1` seed (main.tsx) on Chapter 3's dialogue - every way a mark shows,
  // including both stale kinds. The other chapters are collapsed, like 'retail-sample': Chapter 1's overlapping
  // highlights are the tracked nested-interactive debt (#155, axe-debt.ts), which this state would otherwise inherit.
  'script-markup': async (page) => {
    await openMarkedUpChapter(page);
    await page.locator('[data-stale-markup]').nth(1).waitFor();
  },
  'markup-dialog': async (page) => {
    await openMarkedUpChapter(page);
    await selectReaderWord(page, 'driest thing');
    await clickVisible(page, 'button', 'Mark up');
    await page.getByText('Already on these words').waitFor();
    await page.getByRole('radio', { name: 'Speaker' }).click();
    await page.getByLabel('Speaker name').waitFor();
  },
  'add-note-dialog': async (page) => {
    await goToPage(page, 'Script');
    await selectFirstParagraphText(page);
    await clickVisible(page, 'button', '+ Note');
  },
  'formatted-text-and-line-breaks': async (page) => {
    await goToPage(page, 'Script');
    // The mock seeds an underlined, italic and bold phrase plus a line break
    // in the rabbit-hole paragraph (mockFixtures.ts withFormatting).
    await page.locator('[data-paragraph-text] u').first().scrollIntoViewIfNeeded();
    await page
      .locator('[data-paragraph-text] u')
      .first()
      .evaluate((element) => element.scrollIntoView({ block: 'center' }));
  },
  'chapter-bookmarked': async (page) => {
    await goToPage(page, 'Script');
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
    await goToPage(page, 'Script');
  },
  'credits-entries': async (page) => {
    await goToPage(page, 'Script');
    // Collapse the real chapters first: chapter 1's body has the seeded overlapping entity/note marks used by the
    // 'overlapping-highlights' state (axe-debt.ts, #155) - collapsing keeps this state's own screenshot free of
    // that unrelated, already-tracked issue instead of growing the axe-debt ratchet for an unrelated reason.
    await clickVisible(page, 'button', 'Collapse all chapters');
    // The default mock project has no Title/Author/Narrator value set, so the shipped opening template's tokens
    // render as unresolved chips (C6) - expanding it shows both the chip and the "unresolved token(s)" count.
    await clickVisible(page, 'button', 'Opening credits');
    await page.getByText(/unresolved token/).waitFor();
  },
  // The credits-setup banner and the credits card's own Fill in button (credits-token-setup-and-front-matter-
  // detection.prd.md Phase 3): the mock's setup seam, with the real chapters collapsed for the same reason as
  // 'credits-entries' above.
  'credits-entries-fill-in': async (page) => {
    await page.goto('/?mockCredits=setup');
    await settlePage(page);
    // Home's own dialog opens first (it is modal, so the nav below is unreachable until it closes) - dismiss it for
    // the session, leaving the banner (which stays while tokens are unresolved) to reach this page's own banner.
    await clickVisible(page, 'button', 'Not now');
    await goToPage(page, 'Script');
    await clickVisible(page, 'button', 'Collapse all chapters');
    await clickVisible(page, 'button', 'Opening credits');
    await page.getByText(/The credits need 3 values/).waitFor();
    await page.getByRole('button', { name: 'Fill in' }).first().waitFor();
  },
  // The retail sample (credits PRD Phase 5): ?mockCredits=extras picks lines 1-3 of Chapter 3; the chapter is opened so
  // the marked lines show, the rest collapsed (overlapping marks elsewhere are the tracked axe debt of other states, #155).
  'retail-sample': async (page) => {
    await page.goto('/?mockCredits=extras');
    await settlePage(page);
    await goToPage(page, 'Script');
    await clickVisible(page, 'button', 'Collapse all chapters');
    await page.getByRole('heading', { name: /^Chapter 3 / }).click();
    await page.getByText(/Retail sample starts/).waitFor();
  },
  // Speaker attribution (prep-depth.prd.md Phase 4): Chapter 3 carries the recorded demo cues (dialogueCues.ts),
  // matched by exact quote text - opening it is enough, no mock query param needed. Chapter 3 is picked
  // deliberately over the mockup's own Chapter 8: its other speakers are not Story Bible entities, and unlike
  // nearly every other chapter it never mentions a registered entity whose alias is a substring of another
  // registered entity's canonical name, so it does not also reproduce the reader's pre-existing
  // overlapping-highlight bug (#155).
  'speaker-attribution-single-speaker': async (page) => {
    await goToPage(page, 'Script');
    await clickVisible(page, 'button', 'Collapse all chapters');
    await page.getByRole('heading', { name: /^Chapter 3 / }).click();
    const row = page.locator('[data-paragraph]', { has: page.locator('[data-paragraph-text]', { hasText: 'you had got to the fifth bend' }) });
    await row.scrollIntoViewIfNeeded();
    await row.locator('[data-speaker-tag]').getByText('Alice').waitFor();
  },
  'speaker-attribution-ambiguous': async (page) => {
    await goToPage(page, 'Script');
    await clickVisible(page, 'button', 'Collapse all chapters');
    await page.getByRole('heading', { name: /^Chapter 3 / }).click();
    const row = page.locator('[data-paragraph]', { has: page.locator('[data-paragraph-text]', { hasText: 'why it is you hate' }) });
    await row.scrollIntoViewIfNeeded();
    await row.locator('[data-speaker-tag]').getByText('Alice').waitFor();
  },
  'speaker-attribution-unknown': async (page) => {
    await goToPage(page, 'Script');
    await clickVisible(page, 'button', 'Collapse all chapters');
    await page.getByRole('heading', { name: /^Chapter 3 / }).click();
    const row = page.locator('[data-paragraph]', { has: page.locator('[data-paragraph-text]', { hasText: 'Mine is a long and a sad tale' }) });
    await row.scrollIntoViewIfNeeded();
    await row.waitFor();
  },
  'prep-rail-pronunciations': async (page) => {
    // The rail's default tab (mock 02): no tab click, since Pronunciations opens first.
    const rail = await openPrepRail(page);
    await rail.getByRole('table', { name: 'Pronunciations' }).waitFor();
  },
  'prep-rail-characters': async (page) => {
    const rail = await openPrepRail(page);
    await rail.getByRole('tab', { name: /^Characters · / }).click();
    await rail.getByRole('table', { name: 'Characters' }).waitFor();
  },
  'prep-rail-queries': async (page) => {
    // One name marked sent through the queries panel itself, so the tab shows both statuses a narrator sees.
    const rail = await openPrepRail(page);
    await rail.getByRole('tab', { name: /^Queries · / }).click();
    await rail.getByRole('button', { name: 'Manage queries' }).click();
    const panel = page.getByRole('dialog', { name: 'Pronunciation queries' });
    await panel
      .getByRole('button', { name: /^Mark .+ as sent$/ })
      .first()
      .click();
    await page
      .getByText(/marked as sent/)
      .first()
      .waitFor();
    // The toast goes by itself; the shot is of the rail, not of it.
    await page
      .getByText(/marked as sent/)
      .first()
      .waitFor({ state: 'detached', timeout: 15_000 });
    await panel.getByRole('button', { name: 'Close' }).click();
    await panel.waitFor({ state: 'hidden' });
    const reopened = await openPrepRail(page, false);
    await reopened.getByRole('tab', { name: /^Queries · / }).click();
    await reopened.getByText('Query sent').first().waitFor();
  },
};

// The Script page's rail as the width shows it (Phase 3): the Prep column from `xl`, or the Prep panel from the band's Prep rail
// button below it. Returns the rail's container.
async function openPrepRail(page: Page, load = true) {
  if (load) {
    // Chapter 3 open and the rest collapsed, like 'retail-sample': Chapter 1's overlapping highlights are the tracked
    // nested-interactive debt (#155, axe-debt.ts), which the wide width, where the reader shows beside the rail, would inherit.
    await goToPage(page, 'Script');
    await clickVisible(page, 'button', 'Collapse all chapters');
    await page.getByRole('heading', { name: /^Chapter 3 / }).click();
    await page.locator('[data-paragraph-text]').first().waitFor();
  }
  const column = page.getByRole('complementary', { name: 'Prep' });
  if (await column.isVisible()) return column;
  await clickVisible(page, 'button', 'Prep rail');
  const panel = page.getByRole('dialog', { name: 'Prep' });
  await panel.waitFor();
  return panel;
}

async function openMarkedUpChapter(page: Page): Promise<void> {
  await page.goto('/?mockMarkup=1');
  await settlePage(page);
  await goToPage(page, 'Script');
  await clickVisible(page, 'button', 'Collapse all chapters');
  await page.getByRole('heading', { name: /^Chapter 3 / }).click();
  await page.locator('[data-markup="character_tag"][data-speaker]').first().waitFor();
}
