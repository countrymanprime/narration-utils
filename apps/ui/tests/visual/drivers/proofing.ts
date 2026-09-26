// How to reach each `proofing` state in STATE_CATALOG (see app.drivers.ts).
import { settlePage } from '../helpers/settle';
import { type Driver, clickVisible, freezeClock, goToPage, goToProofingViaHomeCard } from './shared';

export const proofingDrivers: Record<string, Driver> = {
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
};
