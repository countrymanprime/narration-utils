// How to reach each `editing` state in STATE_CATALOG (see app.drivers.ts): the Editing page.
import type { Page } from '@playwright/test';
import { settlePage } from '../helpers/settle';
import { type Driver, goToPage, openWithoutManuscript } from './shared';

/** Chapter 1 linked to its track, so its words carry their heard times. */
const LINKED = '?mockChapterLink=confirmed';
/** As LINKED, with the DAW's experimental edits on. */
const EDITS = `${LINKED}&mockDawExperimentalOn=1`;

export const editingDrivers: Record<string, Driver> = {
  default: async (page) => {
    await openEditing(page, LINKED);
  },
  selection: async (page) => {
    await openEditing(page, EDITS);
    await selectWords(page);
  },
  'delete-dialog': async (page) => {
    await openEditing(page, EDITS);
    await selectWords(page);
    await bar(page).getByRole('button', { name: 'Delete words and audio' }).click();
    await question(page, /^Delete 4 words/).waitFor();
  },
  'fx-menu': async (page) => {
    await openEditing(page, EDITS);
    await selectWords(page);
    await bar(page).getByRole('button', { name: 'Add FX' }).click();
    await page
      .getByRole('menuitem', { name: /RfxChain$/ })
      .first()
      .waitFor();
    // The list of effects is a picker: the page menu's search items do not belong in it.
    if (await page.getByRole('menuitem', { name: /Jump menu|Find a page/ }).count()) throw new Error('The Add FX menu lists the page menu’s search items.');
  },
  'fx-dialog': async (page) => {
    await openEditing(page, EDITS);
    await selectWords(page);
    await bar(page).getByRole('button', { name: 'Add FX' }).click();
    await page
      .getByRole('menuitem', { name: /RfxChain$/ })
      .first()
      .click();
    await page.locator('[role="dialog"], [role="alertdialog"]').first().waitFor();
  },
  'takes-open': async (page) => {
    await openTakes(page, EDITS);
    await expectPanelTextSize(page, 'Suggested take');
  },
  'suggestion-step': async (page) => {
    await openTakes(page, EDITS);
    await page.getByRole('button', { name: 'Normalise' }).first().click();
    await question(page, 'Normalise?').waitFor();
  },
  'drawer-cleanup': async (page) => {
    await openDrawer(page);
    await page.getByRole('region', { name: 'Clean up findings' }).waitFor();
  },
  'drawer-effects': async (page) => {
    await openDrawer(page);
    await page.getByRole('tab', { name: /^Effects/ }).click();
    await page.getByRole('region', { name: 'Effects' }).waitFor();
  },
  'drawer-timeline': async (page) => {
    // The timeline follows the line the cursor is on: place it on the first line's second word first.
    await openEditing(page, LINKED);
    await page.locator('[data-k="p-1:1"]').click();
    // From a 1360 px window the timeline is the strip under the text (the header's Timeline button); below it, a tab of the drawer.
    if ((page.viewportSize()?.width ?? 0) >= 1360) {
      await page.getByRole('button', { name: 'Timeline', exact: true }).click();
    } else {
      await page.getByRole('button', { name: 'Clean up and effects' }).click();
      await page.getByRole('tab', { name: 'Timeline' }).click();
    }
    await page.getByRole('region', { name: /^Waveform and takes/ }).waitFor();
    await expectTimelineLaidOut(page);
  },
  'never-checked': async (page) => {
    // Chapter 7 has no recorded fraction in the fixture, so it was never checked.
    await openEditing(page, LINKED);
    await page.getByRole('button', { name: /^Chapter: .*Change chapter$/ }).click();
    await page.getByRole('menuitemradio', { name: /^Chapter 7\b/ }).click();
    // Nothing was checked and the fixture leaves the chapter without a track: the script still reads, plain, under the no-audio banner.
    await page.getByRole('textbox', { name: 'Script with what was heard' }).waitFor();
    await page.locator('#noaudio').waitFor();
  },
  unlinked: async (page) => {
    await page.goto('/?mockChapterLink=none');
    await settlePage(page);
    await goToPage(page, 'Editing');
    await page.getByRole('textbox', { name: 'Script with what was heard' }).waitFor();
    await page.locator('#noaudio').waitFor();
    // Nothing is boxed "not read" in a recording that is not there.
    if (await page.locator('[data-mark="miss"]').count()) throw new Error('Words are marked "not read" in a chapter with no audio.');
  },
  'daw-off': async (page) => {
    await openEditing(page, `${LINKED}&mockDaw=Audacity`);
    await page.getByRole('button', { name: 'Retry' }).waitFor();
  },
  'no-manuscript': async (page) => {
    await openWithoutManuscript(page, 'Editing');
    await page.getByRole('button', { name: 'Import manuscript' }).waitFor();
  },
};

/**
 * The drawer's Timeline tab as the mock draws it: the drawer fills the slot the layout gives it, each take's name sits on one line, and the
 * times under the lanes stay apart. A state that merely renders cannot tell the audit's cramped drawer from the right one, so this fails the row.
 */
async function expectTimelineLaidOut(page: Page): Promise<void> {
  await page.locator('#timeline [data-lane^="t"]').first().waitFor();
  const bad = await page.evaluate(() => {
    const out: string[] = [];
    const slot = document.querySelector<HTMLElement>('[data-drawer-slot]');
    const drawer = document.querySelector<HTMLElement>('#drawer');
    if (slot && drawer && Math.abs(slot.getBoundingClientRect().width - drawer.getBoundingClientRect().width) > 1)
      out.push('the drawer does not fill its slot');
    for (const lane of document.querySelectorAll<HTMLElement>('#timeline [data-lane^="t"]')) {
      const name = lane.querySelector<HTMLElement>('span');
      if (!name) continue;
      const line = parseFloat(getComputedStyle(name).lineHeight) || 16;
      if (name.getBoundingClientRect().height > line * 1.5) out.push(`"${name.textContent}" wraps`);
      if (name.scrollWidth > name.clientWidth + 1) out.push(`"${name.textContent}" is clipped`);
    }
    const ticks = [...document.querySelectorAll<HTMLElement>('#timeline [aria-hidden="true"] > span')].map((t) => t.getBoundingClientRect());
    ticks.slice(1).forEach((box, i) => box.left < ticks[i].right + 4 && out.push('the time marks run together'));
    return out;
  });
  if (bad.length) throw new Error(`The timeline drawer is cramped: ${[...new Set(bad)].join('; ')}.`);
}

/**
 * A panel under a line is UI text (the mock's `.sx-tkw` is 13 px), not the reader's script size it sits inside. Fails the row when its text
 * is larger than body text, which a render that merely looks plausible would not.
 */
async function expectPanelTextSize(page: Page, region: string): Promise<void> {
  const sizes = await page
    .getByRole('region', { name: region })
    .first()
    .evaluate((card) => [card, ...card.querySelectorAll('*')].map((el) => parseFloat(getComputedStyle(el).fontSize)));
  const largest = Math.max(...sizes);
  if (largest > 16) throw new Error(`The ${region.toLowerCase()} card draws text at ${largest}px: it inherits the script's reading size instead of the UI's.`);
}

/** A question the overlay asks, by its title (a confirm is an alertdialog, a form a dialog). */
const question = (page: Page, title: string | RegExp) => page.locator('[role="dialog"], [role="alertdialog"]').filter({ hasText: title }).first();

const bar = (page: Page) => page.getByRole('toolbar', { name: 'Playback and selection' });

/** Loads `query` and opens Editing from the rail on the first chapter, its script read. */
async function openEditing(page: Page, query: string): Promise<void> {
  await page.goto(`/${query}`);
  await settlePage(page);
  await goToPage(page, 'Editing');
  await page.getByRole('textbox', { name: 'Script with what was heard' }).waitFor();
  await page.locator('[data-tchip]').first().waitFor();
}

/** Selects the second to the fifth word of the first line: a click, then a Shift+click. */
async function selectWords(page: Page): Promise<void> {
  await page.locator('[data-k="p-1:1"]').click();
  await page.locator('[data-k="p-1:4"]').click({ modifiers: ['Shift'] });
  await bar(page).getByText('4 words').waitFor();
}

/** Opens the first line's takes under it and scrolls them into view. */
async function openTakes(page: Page, query: string): Promise<void> {
  await openEditing(page, query);
  await page.locator('[data-tchip]').first().click();
  const takes = page.getByRole('region', { name: 'Suggested take' }).first();
  await takes.waitFor();
  await takes.scrollIntoViewIfNeeded();
}

/** Opens the drawer from the header (it starts on Clean up). */
async function openDrawer(page: Page): Promise<void> {
  await openEditing(page, LINKED);
  await page.getByRole('button', { name: 'Clean up and effects' }).click();
  await page.locator('#drawer').waitFor();
}
