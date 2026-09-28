// How to reach each `pickups` state (the Pickups page, stage-navigation-and-page-replacement.prd.md Phase 7) in STATE_CATALOG
// (see app.drivers.ts).
import type { Page } from '@playwright/test';
import { settlePage } from '../helpers/settle';
import { type Driver, clickVisible, goToPage } from './shared';

async function openPickups(page: Page, query = ''): Promise<void> {
  if (query) {
    await page.goto(`/${query}`);
    await settlePage(page);
  }
  await goToPage(page, 'Pickups');
}

async function importCsv(page: Page, text: string): Promise<void> {
  await page.locator('input[type="file"]').setInputFiles({ name: 'pickups.csv', mimeType: 'text/csv', buffer: Buffer.from(text) });
}

export const pickupsDrivers: Record<string, Driver> = {
  empty: async (page) => {
    await openPickups(page);
    await page.getByText('No pickups yet').waitFor();
  },
  imported: async (page) => {
    await openPickups(page);
    await importCsv(page, 'start,note,tag\n1.5,Mispronounced "labyrinthine",narrator\n42,Dog barked in the background,\n');
    await page.getByText('2 pickups remaining of 2').waitFor();
  },
  'import-errors': async (page) => {
    await openPickups(page);
    await importCsv(page, '1.5,Good row\nnot-a-number,Bad row\n');
    await page.getByText(/1 row could not be used/).waitFor();
    // The row report lands immediately; the run itself settles 300ms later in the mock. Wait for the completed message
    // too, so the screenshot shows the settled "1 pickup remaining" count, not a still-busy Import button.
    await page.getByText('Imported 1 pickup.').waitFor();
  },
  next: async (page) => {
    await openPickups(page, '?mockPickups=import-success');
    await clickVisible(page, 'button', 'Next pickup');
    await page.getByRole('button', { name: 'Mark this pickup done' }).waitFor();
    await page.getByText(/Not on a linked chapter track/).waitFor();
  },
  'next-in-chapter': async (page) => {
    await openPickups(page, '?mockPickups=import-success&mockChapterLink=confirmed');
    await clickVisible(page, 'button', 'Next pickup');
    await page.getByRole('link', { name: /Open Chapter 1 .* in Proof/ }).waitFor();
  },
  // "Punch from here" wired to dawport.Puncher (booth-actions-enablement PRD Phase 3): the punch capability is turned on
  // directly (?mockPunchCapabilityOn=1), the same bypass mockRegionsCapabilityOn uses.
  'next-punch-enabled': async (page) => {
    await openPickups(page, '?mockPickups=import-success&mockPunchCapabilityOn=1');
    await clickVisible(page, 'button', 'Next pickup');
    const button = page.getByRole('button', { name: 'Punch from here' });
    await button.waitFor();
    if (await button.getAttribute('aria-disabled')) throw new Error('Punch from here is still gated with the capability on');
  },
  error: async (page) => {
    await openPickups(page, '?mockPickups=error');
    const message = page.getByText(/Narration Utils script/).first();
    await message.waitFor();
    await message.scrollIntoViewIfNeeded();
  },
};
