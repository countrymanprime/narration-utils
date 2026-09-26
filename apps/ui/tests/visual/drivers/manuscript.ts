// How to reach each `manuscript` state in STATE_CATALOG (see app.drivers.ts).
import { settlePage } from '../helpers/settle';
import {
  type Driver,
  clickNav,
  clickSettingsCategory,
  clickVisible,
  controlBar,
  goToPage,
  lookUpInReader,
  openFlaggedReadAloud,
  openMicPopover,
  openResumePrompt,
  openSettingsPopover,
  PAGE_HEADING,
  scrollReaderByHand,
  selectFirstParagraphText,
  selectReaderWord,
} from './shared';

export const manuscriptDrivers: Record<string, Driver> = {
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
    await openResumePrompt(page);
    await page.getByRole('button', { name: 'Resume from here' }).waitFor();
  },
  'read-aloud-resume-low-confidence': async (page) => {
    await openResumePrompt(page, '?mockResume=low_confidence');
    await page.getByText(/could also fit elsewhere/).waitFor();
  },
  'read-aloud-resume-complete': async (page) => {
    await openResumePrompt(page, '?mockResume=complete');
    await page.getByText('This chapter is recorded to the end. Play reads from the top.').waitFor();
  },
  // Reconciliation (read-aloud-resume-from-daw.prd.md Phase 3): agree presets Start reading without a click.
  'read-aloud-resume-agree': async (page) => {
    await openResumePrompt(page, '?mockResume=agree');
    await page.getByText(/REAPER and your last reading agree/).waitFor();
  },
  'read-aloud-resume-disagree': async (page) => {
    await openResumePrompt(page, '?mockResume=disagree');
    await page.getByText(/different places/).waitFor();
  },
  'read-aloud-resume-prompter-only': async (page) => {
    await openResumePrompt(page, '?mockResume=prompter_only');
    await page.getByText(/Your last reading stopped at/).waitFor();
  },
  'read-aloud-resume-not-found': async (page) => {
    await openResumePrompt(page, '?mockResume=not_found');
    await page.getByText(/did not match this chapter/).waitFor();
  },
  'read-aloud-resume-no-track': async (page) => {
    await openResumePrompt(page, '?mockResume=none');
    await page.getByText(/No track in Alice.rpp matches this chapter/).waitFor();
  },
  'read-aloud-resume-model-required': async (page) => {
    await openResumePrompt(page, '?mockAssets=missing');
    await page.getByRole('button', { name: 'Download model…' }).waitFor();
  },
  'read-aloud-resume-error': async (page) => {
    await openResumePrompt(page, '?mockResume=error');
    await page.getByRole('button', { name: 'Try again' }).waitFor();
  },
  // The prompt is gone the instant a choice is made (read-aloud-resume-from-daw.prd.md Phase 1): no summary, no Change.
  'read-aloud-resume-after-choice': async (page) => {
    await openResumePrompt(page);
    await page.getByRole('button', { name: 'Resume from here' }).click();
    await page.getByRole('region', { name: 'Where you stopped' }).waitFor({ state: 'detached' });
  },
  // A full session (start, then stop) inside the same dialog open, then a wait for the dialog to settle back to idle:
  // the prompt must not return for the rest of this open, so the next Start begins at the top with nothing to clear.
  'read-aloud-resume-after-session': async (page) => {
    await openResumePrompt(page);
    await openMicPopover(page);
    await page.getByRole('combobox', { name: 'Microphone' }).selectOption({ label: 'Microphone Array (Realtek(R) Audio)' });
    await page.getByRole('button', { name: 'Play' }).click();
    await page.getByRole('button', { name: 'Stop reading', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Stop reading', exact: true }).click();
    await page.getByRole('button', { name: 'Play' }).waitFor();
    await page.getByRole('region', { name: 'Where you stopped' }).waitFor({ state: 'detached' });
  },
  // Same mock seam and word as the standalone Teleprompter page's `listening` state, opened through the modal instead.
  'read-aloud-listening': async (page) => {
    await page.goto('/?mockTeleprompter=listening');
    await settlePage(page);
    await goToPage(page, 'Manuscript');
    await clickVisible(page, 'button', 'Read Chapter 1 aloud');
    await page.locator('[data-word="32"] [data-highlight="Cursor"]').waitFor();
  },
  // Manual scroll (teleprompter-engines-and-input-devices.prd.md Phase 10), in the dialog: see the Teleprompter page's `following-paused`.
  'read-aloud-following-paused': async (page) => {
    await page.goto('/?mockTeleprompter=listening');
    await settlePage(page);
    await goToPage(page, 'Manuscript');
    await clickVisible(page, 'button', 'Read Chapter 1 aloud');
    await page.locator('[data-word="32"] [data-highlight="Cursor"]').waitFor();
    await scrollReaderByHand(page);
  },
  // Pause keeps the session, it does not stop it (read-aloud-control-bar.prd.md Phase 5, Q3, ADR 0248): the bar's
  // toggle becomes Play again and the status reads "Paused" in place of "Listening".
  'read-aloud-paused': async (page) => {
    await page.goto('/?mockTeleprompter=listening');
    await settlePage(page);
    await goToPage(page, 'Manuscript');
    await clickVisible(page, 'button', 'Read Chapter 1 aloud');
    await page.locator('[data-word="32"] [data-highlight="Cursor"]').waitFor();
    await controlBar(page).getByRole('button', { name: 'Pause' }).click();
    await controlBar(page).getByRole('button', { name: 'Play' }).waitFor();
    await controlBar(page).getByRole('status').getByText('Paused').waitFor();
  },
  // Word-click seek (teleprompter-manuscript-integration.prd.md Phase 4): from the same listening state as above, click
  // the earliest "Go back to here" word (word 0) and wait for the highlight to land there without restarting.
  'read-aloud-seek-back': async (page) => {
    await page.goto('/?mockTeleprompter=listening');
    await settlePage(page);
    await goToPage(page, 'Manuscript');
    await clickVisible(page, 'button', 'Read Chapter 1 aloud');
    await page.locator('[data-word="32"] [data-highlight="Cursor"]').waitFor();
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
    await dialog.locator('[data-word="32"] [data-highlight="Cursor"]').waitFor();
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
  // Layout fixes (read-aloud-control-bar.prd.md Phase 1): the resume card shares the text column's axis, and the
  // reading panel spans the dialog body from its content top to its bottom, whatever the chapter's length.
  'read-aloud-rail-full-height': async (page) => {
    await openResumePrompt(page);
    const dialog = page.getByRole('dialog', { name: /Read aloud/ });
    // The scrolling body's own box, not the whole dialog (read-aloud-control-bar.prd.md Phase 3 added a `footer`
    // below the body, so the dialog's own bottom edge is no longer the body's). `:scope >` keeps this to the
    // dialog's own body div, not the many marked words inside the text that are also `tabindex="0"`.
    const box = await dialog.locator(':scope > div[tabindex="0"]').boundingBox();
    const card = await dialog.getByRole('region', { name: 'Where you stopped' }).boundingBox();
    // The text's own Panel, not its inner "Chapter text" region, which sits inset by the Panel's padding: the card is a
    // Panel too, so comparing panel to panel is the like-for-like edge the PRD means by "the text column's axis".
    const text = await dialog.getByRole('region', { name: 'Chapter text' }).locator('xpath=ancestor::section[1]').boundingBox();
    const rail = await dialog.getByRole('complementary', { name: 'Reading panel' }).boundingBox();
    if (!box || !card || !text || !rail) throw new Error('The read-aloud layout has no boxes to measure.');
    if (Math.abs(card.x - text.x) > 1 || Math.abs(card.x + card.width - (text.x + text.width)) > 1)
      throw new Error('The resume card is not aligned with the text column.');
    if (rail.y - box.y > 90) throw new Error("The reading panel does not start at the dialog body's content top.");
    if (box.y + box.height - (rail.y + rail.height) > 30) throw new Error("The reading panel does not reach the dialog body's bottom.");
  },
  // The control bar's microphone popover (read-aloud-control-bar.prd.md Phases 3-4): the device list, Refresh, and a
  // live level meter - fixed to -18 dBFS (?mockLevel=-18) for a stable, still capture (ADR 0247).
  'read-aloud-mic-popover': async (page) => {
    await openResumePrompt(page, '?mockLevel=-18');
    await openMicPopover(page);
    await page.getByRole('combobox', { name: 'Microphone' }).selectOption({ label: 'Microphone Array (Realtek(R) Audio)' });
    await page.getByRole('meter', { name: 'Input level' }).waitFor();
  },
  // The control bar's Settings popover (Phase 3): Engine and Model, each a toggle group, and "More in Settings".
  'read-aloud-settings-popover': async (page) => {
    await openResumePrompt(page);
    await openSettingsPopover(page);
  },
  // The bar's read-only REAPER state (Phase 6, ADR 0249): always disabled - Phase 7's actionable toggle is not built.
  'read-aloud-reaper-ready': async (page) => {
    await openResumePrompt(page, '?mockReaperState=ready');
    await controlBar(page).getByRole('button', { name: 'Record in REAPER: Chapter armed' }).waitFor();
  },
  'read-aloud-reaper-not-armed': async (page) => {
    await openResumePrompt(page, '?mockReaperState=not_armed');
    await controlBar(page).getByRole('button', { name: 'Record in REAPER: Not armed' }).waitFor();
  },
  'read-aloud-reaper-recording': async (page) => {
    await openResumePrompt(page, '?mockReaperState=recording_elsewhere');
    await controlBar(page).getByRole('button', { name: 'Record in REAPER: Recording' }).waitFor();
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
  // Read aloud on the credits (manuscript-credits-card-parity.prd.md Phase 2, ADR 0260): the card's own Read aloud
  // button (ReaderCard renders it in the header regardless of the card's open/closed state, so there is no need to
  // expand the card first), opening the same dialog a chapter opens. ?mockCredits=filled resolves every token, the
  // same seam the standalone Teleprompter page's 'credits-opening' state uses, so this shows no warning.
  'read-aloud-credits': async (page) => {
    await page.goto('/?mockCredits=filled');
    await settlePage(page);
    await goToPage(page, 'Manuscript');
    await clickVisible(page, 'button', 'Read Opening credits aloud');
    const dialog = page.getByRole('dialog', { name: 'Read aloud: Opening credits' });
    await dialog.getByText('Alice’s Adventures in Wonderland, written by Lewis Carroll, narrated by Ada Finch.').waitFor();
  },
  // The default mock project has no Title/Author/Narrator value set (same as 'credits-entries' above): the C6
  // warning takes the resume prompt's header slot instead (MC2/MC9 - credits have no resume card), naming the
  // unresolved tokens with "Fill them in Settings", the same warning the standalone page's own credits states show.
  'read-aloud-credits-unresolved': async (page) => {
    await goToPage(page, 'Manuscript');
    await clickVisible(page, 'button', 'Read Opening credits aloud');
    const dialog = page.getByRole('dialog', { name: 'Read aloud: Opening credits' });
    await dialog.getByRole('status', { name: /have no value/ }).waitFor();
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
    // One word, so the popup shows every action it has (Look up is offered for one word only).
    await selectReaderWord(page, 'bank');
    await page.getByRole('button', { name: 'Look up' }).waitFor();
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
  // manuscript-chapter-header-alignment.prd.md: the stat block (words, read time) and the action slot (Read aloud,
  // empty on Front Matter) are fixed-width columns, so every row's stat block ends at the same x and every Read
  // aloud button starts at the same x, whether or not that row has a button. Collapsed, so every header in view at
  // once; the assertion below is the "driver assertion" the PRD calls for, not just a screenshot.
  'chapter-header-columns': async (page) => {
    await page.goto('/?mockManuscript=mixed');
    await settlePage(page);
    // Not goToPage: the reader opens with only its first entry expanded, which here is the Opening credits card (no
    // [data-paragraph-text]), so the page has arrived once its heading and the rows waited for below are there.
    await clickNav(page, 'Manuscript');
    await page.getByRole('heading', { level: 1, name: PAGE_HEADING.Manuscript, exact: true }).waitFor();
    await clickVisible(page, 'button', 'Collapse all chapters');
    await page.getByRole('button', { name: 'Front Matter' }).waitFor();
    await page
      .getByRole('button', { name: /^Read .* aloud$/ })
      .first()
      .waitFor();
    await page.waitForFunction(() => {
      const buttons = [...document.querySelectorAll<HTMLElement>('article header button[aria-label^="Read "]')];
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
  // The credits-setup banner and the credits card's own Fill in button (credits-token-setup-and-front-matter-
  // detection.prd.md Phase 3): the mock's setup seam, with the real chapters collapsed for the same reason as
  // 'credits-entries' above.
  'credits-entries-fill-in': async (page) => {
    await page.goto('/?mockCredits=setup');
    await settlePage(page);
    // Home's own dialog opens first (it is modal, so the nav below is unreachable until it closes) - dismiss it for
    // the session, leaving the banner (which stays while tokens are unresolved) to reach this page's own banner.
    await clickVisible(page, 'button', 'Not now');
    await goToPage(page, 'Manuscript');
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
    await goToPage(page, 'Manuscript');
    await clickVisible(page, 'button', 'Collapse all chapters');
    await page.getByRole('heading', { name: /^Chapter 3 / }).click();
    await page.getByText(/Retail sample starts/).waitFor();
  },
};
