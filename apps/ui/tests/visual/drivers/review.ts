// How to reach each `review` state in STATE_CATALOG (see app.drivers.ts).
import { settlePage } from '../helpers/settle';
import {
  type Driver,
  compareTakes,
  confirmApprovedMarker,
  goToPage,
  openFindingRow,
  openPickupGroup,
  openReaperControls,
  openReview,
  openScanDialog,
  pressInReaper,
  scanChapterOne,
  showReaperControls,
  waitForFindingRows,
} from './shared';

export const reviewDrivers: Record<string, Driver> = {
  default: async (page) => {
    await openReview(page);
  },
  empty: async (page) => {
    await page.goto('/?mockFindings=empty');
    await settlePage(page);
    await goToPage(page, 'Review');
    await page.getByRole('heading', { name: 'Nothing to review yet' }).waitFor();
  },
  filtered: async (page) => {
    await openReview(page);
    await page.getByRole('combobox', { name: 'Check' }).selectOption({ label: 'Proofing comparison' });
    await page.getByRole('switch', { name: 'Only findings scored 50% or more' }).click();
    await waitForFindingRows(page, 1);
  },
  'filtered-empty': async (page) => {
    await openReview(page);
    await page.getByRole('combobox', { name: 'Status' }).selectOption({ label: 'Deferred' });
    await page.getByText('No findings match these filters.').waitFor();
  },
  'detail-open': async (page) => {
    await openReview(page);
    await openFindingRow(page, /pink eyes/, 'Transcript difference');
  },
  'decision-saved': async (page) => {
    await openReview(page);
    await openFindingRow(page, /pink eyes/, 'Transcript difference');
    await page.getByRole('textbox', { name: 'Note (optional)' }).fill('Re-record this line in the pickup session.');
    await page.getByRole('button', { name: 'Accept' }).click();
    const saved = page.getByText('Saved as accepted.');
    await saved.waitFor();
    await saved.scrollIntoViewIfNeeded();
  },
  'evidence-changed': async (page) => {
    await page.goto('/?mockFindings=changed');
    await settlePage(page);
    await openReview(page);
    await openFindingRow(page, /pink eyes/, 'Transcript difference');
    await page.getByRole('textbox', { name: 'Note (optional)' }).fill('Pale is close enough.');
    await page.getByRole('button', { name: 'Dismiss' }).click();
    const refused = page.getByRole('alert').filter({ hasText: 'this finding changed since you opened it' });
    await refused.waitFor();
    await refused.scrollIntoViewIfNeeded();
  },
  'not-in-latest-run': async (page) => {
    await openReview(page);
    await page.getByRole('switch', { name: 'Include findings the latest run did not repeat' }).click();
    await waitForFindingRows(page, 5);
    await openFindingRow(page, /Antipathies/, 'Pronunciation');
  },
  'reaper-go-to': async (page) => {
    await openReaperControls(page);
    await pressInReaper(page, 'Go to in REAPER', page.getByText('REAPER selected the item and moved the cursor to 0:12.4.'));
  },
  'reaper-looping': async (page) => {
    await openReaperControls(page);
    await pressInReaper(page, 'Loop in REAPER', page.getByRole('button', { name: 'Stop loop' }));
  },
  'reaper-stale': async (page) => {
    await openReaperControls(page, 'stale');
    await pressInReaper(page, 'Go to in REAPER', page.getByRole('alert').filter({ hasText: 'no longer in the REAPER project' }));
  },
  'reaper-not-running': async (page) => {
    await openReaperControls(page, 'not-running');
    await showReaperControls(page, page.getByText(/REAPER is not answering/));
  },
  'reaper-standalone': async (page) => {
    await openReaperControls(page, 'standalone');
    await showReaperControls(page, page.getByText(/open this app from the Narration Utils action in REAPER/));
  },
  'reaper-marker-confirm': async (page) => {
    await confirmApprovedMarker(page);
  },
  'take-review-scan-form': async (page) => {
    await openScanDialog(page);
  },
  'take-review-scan-progress': async (page) => {
    await page.goto('/?mockTakeReviewScan=running');
    await settlePage(page);
    const form = await openScanDialog(page);
    await form.getByRole('button', { name: 'Start scan' }).click();
    const progress = page.getByRole('dialog', { name: 'Finding pickups and duplicates' });
    await progress.getByRole('status').filter({ hasText: 'Transcribing read 2/4' }).waitFor();
  },
  'take-review-results': async (page) => {
    await scanChapterOne(page);
  },
  'take-review-group': async (page) => {
    await openPickupGroup(page);
    await page.getByRole('region', { name: 'Reads' }).scrollIntoViewIfNeeded();
  },
  'take-review-read-looping': async (page) => {
    const reads = await openPickupGroup(page);
    await reads.getByRole('button', { name: 'Loop read 2 in REAPER' }).click();
    await reads.getByRole('button', { name: 'Stop loop' }).waitFor();
    await reads.scrollIntoViewIfNeeded();
  },
  'take-review-audition': async (page) => {
    const reads = await openPickupGroup(page);
    await reads.getByRole('button', { name: 'Audition reads' }).click();
    await page.getByRole('dialog', { name: 'Audition candidate reads' }).waitFor();
  },
  'take-review-add-take': async (page) => {
    await openPickupGroup(page);
    await page.getByRole('button', { name: 'Accept', exact: true }).click();
    await page.getByText('Saved as accepted.').waitFor();
    await page.getByRole('region', { name: 'Reads' }).getByRole('button', { name: 'Add as take…' }).click();
    const dialog = page.getByRole('alertdialog', { name: 'Add candidate as a new take' });
    await dialog.getByRole('combobox', { name: 'Target item' }).selectOption({ index: 1 });
    await dialog.getByRole('combobox', { name: 'Candidate read' }).selectOption({ index: 1 });
  },
  'take-comparison-progress': async (page) => {
    await page.goto('/?mockTakeComparison=running');
    await settlePage(page);
    const reads = await openPickupGroup(page);
    await reads.getByRole('button', { name: 'Compare takes…' }).click();
    const progress = page.getByRole('dialog', { name: 'Comparing takes' });
    await progress.getByRole('status').filter({ hasText: 'Transcribing take 2/2' }).waitFor();
  },
  'take-comparison': async (page) => {
    const comparison = await compareTakes(page);
    await comparison.scrollIntoViewIfNeeded();
  },
  'take-comparison-measurements': async (page) => {
    const comparison = await compareTakes(page);
    await comparison.getByRole('table', { name: 'The audio of each read' }).scrollIntoViewIfNeeded();
  },
  'reaper-marker-added': async (page) => {
    const dialog = await confirmApprovedMarker(page);
    await dialog.getByRole('button', { name: 'Add marker', exact: true }).click();
    await dialog.waitFor({ state: 'detached' });
    await showReaperControls(page, page.getByText(/^Marker added in REAPER: MISREAD:/));
  },
};
