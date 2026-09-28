// How to reach each `proof-chapter` state in STATE_CATALOG (see app.drivers.ts): Proof's chapter view.
import { settlePage } from '../helpers/settle';
import { type Page } from '@playwright/test';
import { type Driver, clickVisible, compareRun, freezeClock, openLinkedProofChapter, openProofChapter } from './shared';

export const proofChapterDrivers: Record<string, Driver> = {
  never: async (page) => {
    // Chapter 7 has no recordedFraction in the fixture (mockFixtures.ts: only chapters 1-6 do), so it reads "never checked".
    await openLinkedProofChapter(page, 'Chapter 7');
    await page.getByText(/hasn.t been checked yet/).waitFor();
  },
  stale: async (page) => {
    // ?mockCoverage=stale marks Chapter 4's check stale (main.tsx).
    await page.goto('/?mockCoverage=stale');
    await settlePage(page);
    await openLinkedProofChapter(page, 'Chapter 4');
    await page.getByText('Check stale').waitFor();
  },
  current: async (page) => {
    await openLinkedProofChapter(page, 'Chapter 1');
    await page.getByText('Check current').waitFor();
  },
  playing: async (page) => {
    await openLinkedProofChapter(page, 'Chapter 1');
    await clickVisible(page, 'button', 'Play');
    await page.getByRole('button', { name: 'Pause' }).waitFor();
  },
  'flag-selected': async (page) => {
    // ?mockCoverage=pickups replaces the default findings seed with one scoped to Chapter 4 (main.tsx), so Chapter
    // 1's own misread flag here carries no finding - a plain, read-only flag straight from the check's alignment
    // (Phase 2), distinct from flag-finding-open below (the same flag, Phase 4's default seed, finding-backed).
    await page.goto('/?mockCoverage=pickups');
    await settlePage(page);
    await openLinkedProofChapter(page, 'Chapter 1');
    await clickVisible(page, 'button', 'Next flag');
    await page.getByText('Play from here').waitFor();
  },
  // edit-and-proof-workspace.prd.md Phase 4: Chapter 1's mock seeds a transcript_discrepancy finding at the same
  // misread the check already flags (mockApi.ts's workspaceOverlayFinding), so "Next flag" selects the one flag on
  // this chapter and it is finding-backed - the "From"/Decision section shown here is the merge, not a second flag.
  'flag-finding-open': async (page) => {
    await openLinkedProofChapter(page, 'Chapter 1');
    await clickVisible(page, 'button', 'Next flag');
    await page.getByText('Decision', { exact: true }).waitFor();
  },
  'flag-decided': async (page) => {
    await openLinkedProofChapter(page, 'Chapter 1');
    await clickVisible(page, 'button', 'Next flag');
    await clickVisible(page, 'button', 'Accept');
    await page.getByText('Saved as accepted.').waitFor();
  },
  standalone: async (page) => {
    await page.goto('/?mockReaper=standalone');
    await settlePage(page);
    await openLinkedProofChapter(page, 'Chapter 1');
    await page.getByText('Check current').waitFor();
    // Phase 3: Go to/Loop are disabled once useReaperStatus's first poll answers 'standalone'.
    await page.getByRole('button', { name: 'Go to in REAPER' }).waitFor();
  },
  // The compare run (the retired Proofing page, stage-navigation-and-page-replacement.prd.md Phase 5), on Chapter 1 opened from
  // Proof's chapter picker with no track linked, scrolled so the run fills the picture.
  'compare-setup': async (page) => {
    await openCompare(page);
  },
  'compare-setup-alt': async (page) => {
    await openCompare(page);
    await clickVisible(page, 'button', 'Large');
  },
  'compare-running': async (page) => {
    await openCompare(page);
    await clickVisible(page, 'button', 'Start comparison');
    // Mid-progress: the first step landed and the run has not finished.
    await page.getByText(/^[1-9]\d?% ·/).waitFor();
  },
  'compare-results-misread': async (page) => {
    // Waits out the real mock timer (2.6 s) rather than using the mock-only "Skip to results (demo)" shortcut, since that button
    // doesn't exist in the real (non-mock) app.
    await finishComparison(page);
    await selectCompareFlag(page, 'Misread');
  },
  'compare-results-extra': async (page) => {
    await finishComparison(page);
    await selectCompareFlag(page, 'Extra words');
  },
  'compare-results-summary': async (page) => {
    await finishComparison(page);
    await compareRun(page).scrollIntoViewIfNeeded();
  },
  'compare-toast': async (page) => {
    await openCompare(page);
    // Suggesting hints from the manuscript answers with a toast (adding a term answers with none), and an information toast
    // fades on a real 5 s timer: freeze timers so it cannot race the screenshot.
    await freezeClock(page);
    await clickVisible(page, 'button', 'Suggest from manuscript');
    await page.locator('[data-tone]').first().waitFor();
  },
  // The vocabulary hints box (proofing-vocabulary-hints.prd.md Phase 2): the pills box is the input, so a half-typed draft sits
  // inline after the last pill, not in a separate row.
  'compare-hints-typing': async (page) => {
    await openCompare(page);
    const box = page.getByRole('textbox', { name: 'Add a vocabulary term' });
    await box.click();
    await box.pressSequentially('Dawnspire');
    await page.waitForFunction(() => (document.activeElement as HTMLInputElement | null)?.value === 'Dawnspire');
  },
  // Many accepted terms wrap across lines of the same box. Each typed comma commits the term before it (V5), so this types the
  // whole list at once and the last, comma-less term is committed by the trailing Enter.
  'compare-hints-many-pills': async (page) => {
    await openCompare(page);
    const box = page.getByRole('textbox', { name: 'Add a vocabulary term' });
    await box.click();
    await box.pressSequentially('Arelian, Captain Arelian, Council of Ash, Juno, Kestrel, Zephyra, Dawnspire, Zeph');
    await box.press('Enter');
    await page.getByRole('button', { name: 'Remove Zeph', exact: true }).waitFor();
  },
  // Suggested names from the Story Bible sit inside the same box as dashed pills until one is clicked (V6).
  'compare-hints-pending-suggestions': async (page) => {
    await openCompare(page);
    await clickVisible(page, 'button', 'Suggest from manuscript');
    await page.getByRole('button', { name: /^\+ / }).first().waitFor();
    // Suggest also answers with a toast, which is compare-toast's picture: dismiss it so this one shows the pills alone.
    await page.getByRole('button', { name: 'Dismiss message' }).click();
    await page.locator('[data-tone]').waitFor({ state: 'detached' });
  },
  // Accepted and pending hints together: one candidate accepted (a solid pill), the rest still pending (dashed "+ Term").
  'compare-hints-chips': async (page) => {
    await openCompare(page);
    await clickVisible(page, 'button', 'Suggest from manuscript');
    await clickVisible(page, 'button', '+ Alice');
    await page.getByRole('button', { name: 'Remove Alice', exact: true }).waitFor();
  },
  'compare-no-daw': async (page) => {
    // The mock's no-linked-DAW seam (main.tsx): Proof is never gated, and inside the chapter view Start comparison is gated with
    // the reason as its description (its tooltip is not opened: the gating shows on the button itself).
    await openCompare(page, '/?mockNoDaw=1');
    await page.getByRole('button', { name: 'Start comparison' }).and(page.locator('[aria-disabled="true"]')).waitFor();
  },
  'compare-no-daw-review': async (page) => {
    // Offline review of the last completed comparison stays reachable with no linked DAW file (PRD W16): "Last narrated take" in the
    // run's setup shows its results as flags, where Play recorded audio and Export are off.
    await openCompare(page, '/?mockNoDaw=1');
    await clickVisible(page, 'button', /Last narrated take/);
    await selectCompareFlag(page, 'Misread');
  },
  'preview-default': async (page) => {
    await openPanel(page, '/', page.getByRole('table', { name: 'Preview candidates' }));
  },
  'preview-computing': async (page) => {
    await openPanel(page, '/?mockPreviewCandidates=computing', page.getByRole('status').getByText('Computing suggestions…'));
  },
  'preview-no-manuscript': async (page) => {
    await openPanel(page, '/?mockPreviewCandidates=no-manuscript', page.getByText('Import a manuscript to see preview suggestions.'));
  },
  'preview-nothing-eligible': async (page) => {
    await openPanel(page, '/?mockPreviewCandidates=nothing-eligible', page.getByText(/No eligible text was found/));
  },
  'preview-shorter': async (page) => {
    await openPanel(page, '/?mockPreviewCandidates=shorter', page.getByText(/shorter than the target length/));
  },
  'preview-warnings': async (page) => {
    await openPanel(page, '/?mockPreviewCandidates=warnings', page.getByText(/imported before chapters were classified/));
  },
  'stage-panel-suggestions': async (page) => {
    await openPanel(page, '/?mockProofingStages=mixed', page.getByText('Suggested: Finalized'));
  },
  'stage-panel-evidence-recommended': async (page) => {
    await openPanel(page, '/?mockProofingStages=mixed', page.getByText('Suggested: Finalized'));
    await clickVisible(page, 'button', /^Why: /);
    await page.getByRole('dialog').waitFor();
  },
  'stage-panel-evidence-not-ready': async (page) => {
    await openPanel(page, '/?mockProofingStages=mixed', page.getByText('Not ready for Finalized'));
    await page
      .locator('tr', { hasText: 'Not ready for Finalized' })
      .getByRole('button', { name: /^Why: / })
      .click();
    await page.getByRole('dialog').waitFor();
  },
  'stage-panel-evidence-unknown': async (page) => {
    await openPanel(page, '/?mockProofingSignal=unmapped-track', page.getByText(/no track linked/));
    await clickVisible(page, 'button', /^Why: /);
    await page.getByRole('link', { name: 'Open Tracks' }).waitFor();
  },
};

// Opens Chapter 1's Proof view (after loading `url` for a mock seam) and scrolls its compare run into view.
async function openCompare(page: Page, url?: string): Promise<void> {
  if (url) {
    await page.goto(url);
    await settlePage(page);
  }
  await openProofChapter(page);
  await compareRun(page).scrollIntoViewIfNeeded();
}

// Runs a comparison to the end: the mock's run takes 2.6 s, then its discrepancies are flags.
async function finishComparison(page: Page): Promise<void> {
  await openCompare(page);
  await clickVisible(page, 'button', 'Start comparison');
  await page.getByRole('button', { name: 'New comparison' }).waitFor({ timeout: 10_000 });
}

// Steps the Flags panel to the first compare flag of `label` (its detail offers Play recorded audio) and scrolls it into view.
async function selectCompareFlag(page: Page, label: string): Promise<void> {
  const panel = page.locator('section').filter({ has: page.getByRole('heading', { name: /^Flags · / }) });
  for (let step = 0; step < 12; step += 1) {
    await panel.getByRole('button', { name: 'Next flag' }).click();
    const detail = panel.getByRole('button', { name: 'Play recorded audio' });
    if ((await detail.count()) > 0 && (await panel.locator('.font-semibold', { hasText: new RegExp(`^${label}$`) }).count()) > 0) {
      await panel.scrollIntoViewIfNeeded();
      return;
    }
  }
  throw new Error(`no compare flag labelled ${label}`);
}

// Opens Chapter 1's Proof view after loading `url` for a mock seam, waits for `ready` and scrolls it into view.
async function openPanel(page: Page, url: string, ready: ReturnType<Page['getByText']>): Promise<void> {
  if (url !== '/') {
    await page.goto(url);
    await settlePage(page);
  }
  await openProofChapter(page);
  await ready.first().waitFor();
  await ready.first().scrollIntoViewIfNeeded();
}
