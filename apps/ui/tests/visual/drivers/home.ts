// How to reach each `home` state in STATE_CATALOG (see app.drivers.ts).
import { settlePage } from '../helpers/settle';
import {
  type Driver,
  clickVisible,
  confirmDialog,
  goToPage,
  homeLoaded,
  openEditingCheckFromHome,
  openImportReview,
  openRecordingCheck,
  openStageEvidence,
  openStageSuggestions,
  openTrackPanel,
  scrollToStageRows,
} from './shared';

export const homeDrivers: Record<string, Driver> = {
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
  'chapter-sync-consent': async (page) => {
    await page.goto('/?mockChapterSync=ask');
    await settlePage(page);
    await page.getByRole('alertdialog', { name: 'Sync chapters to tracks?' }).waitFor();
  },
  'chapter-sync-toast-undo': async (page) => {
    // The mock's `?mockChapterSync=linked` seam runs its first sync once something subscribes (see mockApi.ts),
    // which Home's AudiobookEstimatePanel does on mount, so the toast appears without a click (Phase 3, S12).
    await page.goto('/?mockChapterSync=linked');
    await settlePage(page);
    await homeLoaded(page);
    await page
      .getByRole('status')
      .getByText(/^Linked /)
      .waitFor();
    await page.getByRole('button', { name: 'Undo' }).waitFor();
  },
  'chapter-table-credits-missing': async (page) => {
    await page.goto('/?mockCreditsMissing=1');
    await settlePage(page);
    await homeLoaded(page);
    await clickVisible(page, 'button', /Show per-chapter breakdown/);
  },
  // The rule (chapter-title-display-consistency.prd.md): " — " once, never twice, and never CSS capitals on a
  // chapter name - source capitals ("CHAPTER ONE") are the book's own text, not a text-transform. The row names
  // below are chapterName()'s output, so a regression that drops the primitive or the trailing-separator fix
  // ("Chapter 12: — …") fails these waits, not just the screenshot.
  'chapter-names': async (page) => {
    await page.goto('/?mockManuscript=mixed');
    await settlePage(page);
    await homeLoaded(page);
    await clickVisible(page, 'button', /Show per-chapter breakdown/);
    await page.getByRole('link', { name: 'CHAPTER ONE — Bad Ideas Look Great in Neon' }).waitFor();
    await page.getByRole('link', { name: 'A Message from the Author' }).waitFor();
    await page.getByRole('link', { name: /^Chapter 12 — Alice.s Evidence$/ }).waitFor();
    await page.waitForFunction(() => {
      const links = [...document.querySelectorAll<HTMLAnchorElement>('td a[href*="/manuscript#c"]')];
      return links.length > 0 && links.every((link) => getComputedStyle(link).textTransform === 'none');
    });
  },
  'chapter-track-panel-linked': async (page) => {
    const dialog = await openTrackPanel(page, 'Chapter 1', 'mockChapterLink=confirmed');
    // "Linked" also names the confirmed-at Fact row's label, so this scopes to the header's state eyebrow.
    await dialog.getByText('Linked').first().waitFor();
    await dialog.getByText('Found through').waitFor();
  },
  'chapter-track-panel-ambiguous': async (page) => {
    const dialog = await openTrackPanel(page, 'Chapter 1', 'mockChapterLink=ambiguous');
    await dialog.getByText('Linked to 2 tracks').waitFor();
  },
  'chapter-track-panel-missing': async (page) => {
    const dialog = await openTrackPanel(page, 'Chapter 1', 'mockChapterLink=missing');
    await dialog.getByText('Track missing').waitFor();
  },
  'chapter-remove-confirm': async (page) => {
    await openTrackPanel(page, 'Chapter 1', 'mockChapterLink=confirmed');
    await clickVisible(page, 'button', 'Remove from recording…');
    await page.getByRole('alertdialog', { name: 'Remove Chapter 1 from recording?' }).waitFor();
  },
  'chapter-removed-list': async (page) => {
    await page.goto('/?mockRemoved=1');
    await settlePage(page);
    await homeLoaded(page);
    await clickVisible(page, 'button', /Show per-chapter breakdown/);
    const removed = page.getByText(/Removed from recording/);
    await removed.waitFor();
    await removed.scrollIntoViewIfNeeded();
  },
  'chapter-track-no-project': async (page) => {
    await page.goto('/?mockNoRpp=1');
    await settlePage(page);
    await homeLoaded(page);
    await clickVisible(page, 'button', /Show per-chapter breakdown/);
    await page.getByText('No REAPER project (.rpp) file was found in this project folder.').waitFor();
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
  // credits-token-setup-and-front-matter-detection.prd.md Phase 2: the "Set up the credits" dialog, reached with no
  // manuscript-candidate offer in the way (see main.tsx's ?mockCredits=setup seam).
  'credits-setup-dialog': async (page) => {
    await page.goto('/?mockCredits=setup');
    await settlePage(page);
    await page.getByRole('dialog', { name: 'Set up the credits' }).waitFor();
  },
  'credits-setup-dialog-narrator-default': async (page) => {
    await page.goto('/?mockCredits=setup-narrator-default');
    await settlePage(page);
    await page.getByRole('dialog', { name: 'Set up the credits' }).waitFor();
  },
  'credits-setup-banner': async (page) => {
    await page.goto('/?mockCredits=setup');
    await settlePage(page);
    await clickVisible(page, 'button', 'Not now');
    await page.getByText(/The credits need 3 values/).waitFor();
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
  'import-build-running': async (page) => {
    // The mock's build seam (see main.tsx): the chained build starts and stays at 30 percent.
    await page.goto('/?mockBuild=hold');
    await settlePage(page);
    await clickVisible(page, 'button', 'Replace manuscript');
    await clickVisible(page, 'button', 'Import');
    await page.getByRole('dialog', { name: 'Build the Story Bible' }).getByText('Extracting names and terms').first().waitFor();
  },
  'import-build-failed': async (page) => {
    // The chained build starts and the host reports it failed at the first poll; the import was already written and said so.
    await page.goto('/?mockBuild=fails');
    await settlePage(page);
    await clickVisible(page, 'button', 'Replace manuscript');
    await clickVisible(page, 'button', 'Import');
    await page
      .getByRole('dialog', { name: 'Build the Story Bible' })
      .getByText(/model folder is missing its config\.cfg/)
      .first()
      .waitFor();
    await page.getByText('Manuscript imported.', { exact: true }).first().waitFor();
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
    await dialog.getByText('Passes the check').waitFor();
  },
  // RS2 A (recording-check-summary.prd.md): a chapter that is simply unfinished states it in the summary
  // ("Recorded to paragraph N of M") rather than listing its unread end as a pickup.
  'recording-check-incomplete': async (page) => {
    const dialog = await openRecordingCheck(page, 'Chapter 4');
    await dialog.getByText(/^Recorded to paragraph \d+ of \d+/).waitFor();
    await dialog.getByText('Pickups (0)').waitFor();
  },
  'recording-check-pickups': async (page) => {
    const dialog = await openRecordingCheck(page, 'Chapter 4', 'mockCoverage=pickups');
    await dialog.getByText('Pickups (2)').waitFor();
    await dialog.getByText('Skipped').waitFor();
    await dialog.getByText('Read short').waitFor();
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
  'stage-summary-chips': async (page) => {
    await openStageSuggestions(page, 'mixed', false);
  },
  'stage-suggestions': async (page) => {
    await openStageSuggestions(page, 'mixed');
    await page.getByText('Evidence changed since you confirmed').waitFor();
    await scrollToStageRows(page);
  },
  'stage-dismissed': async (page) => {
    await openStageSuggestions(page, 'mixed');
    await clickVisible(page, 'button', 'Dismiss the suggestion for Chapter 4');
    await page.getByText('Suggestion dismissed (Editing)').waitFor();
    // The dismissal's toast removes itself on a real timer, which would race the shots of the other viewports.
    await page.getByRole('button', { name: 'Dismiss message' }).click();
    await page.getByRole('button', { name: 'Dismiss message' }).waitFor({ state: 'detached' });
    await scrollToStageRows(page);
  },
  'stage-error': async (page) => {
    await openStageSuggestions(page, 'error');
    await page.getByText('Couldn’t check stage suggestions: the saved REAPER project could not be read').waitFor();
  },
  'stage-evidence-recommended': async (page) => {
    const view = await openStageEvidence(page, 'Chapter 4');
    await view.getByRole('button', { name: 'Confirm Editing' }).waitFor();
  },
  'stage-evidence-not-ready': async (page) => {
    const view = await openStageEvidence(page, 'Chapter 6');
    await view.getByText('Not met.').waitFor();
  },
  'stage-evidence-unknown': async (page) => {
    const view = await openStageEvidence(page, 'Chapter 5');
    await view.getByRole('button', { name: 'Open recording check' }).waitFor();
  },
  'stage-evidence-changed': async (page) => {
    const view = await openStageEvidence(page, 'Chapter 7');
    await view.getByRole('button', { name: 'Revert to Recording' }).waitFor();
  },
  'editing-check-never-checked': async (page) => {
    await openEditingCheckFromHome(page, 'mockEditingSignal=never');
  },
  'editing-check-running': async (page) => {
    const panel = await openEditingCheckFromHome(page, 'mockEditing=hold&mockEditingSignal=not-met&mockEditingCandidates=1');
    await clickVisible(page, 'button', 'Check editing');
    await panel.getByRole('progressbar', { name: 'Editing check progress' }).waitFor();
  },
  'editing-check-partial': async (page) => {
    const panel = await openEditingCheckFromHome(page, 'mockEditing=hold&mockEditingSignal=not-met&mockEditingCandidates=1');
    await clickVisible(page, 'button', 'Check editing');
    await panel.getByRole('progressbar', { name: 'Editing check progress' }).waitFor();
    await clickVisible(page, 'button', 'Cancel');
    await panel.getByRole('button', { name: 'Check again' }).waitFor();
  },
  'editing-check-complete-candidates': async (page) => {
    const panel = await openEditingCheckFromHome(page, 'mockEditingCandidates=1&mockEditingSignal=not-met');
    await panel.getByText('1 empty-space candidate').waitFor();
  },
  'editing-check-complete-clean': async (page) => {
    const panel = await openEditingCheckFromHome(page, 'mockEditingSignal=met');
    await panel.getByText('Met.').waitFor();
  },
  'editing-check-stale': async (page) => {
    const panel = await openEditingCheckFromHome(page, 'mockEditingSignal=stale');
    await panel.getByText(/Check editing again: since the last check/).waitFor();
  },
  'editing-check-settings-unset': async (page) => {
    const panel = await openEditingCheckFromHome(page, 'mockEditingSignal=settings-unset');
    await panel.getByText(/No maximum gap is set/).waitFor();
  },
  'editing-check-unsupported': async (page) => {
    const panel = await openEditingCheckFromHome(page, 'mockEditingSignal=unsupported');
    await panel.getByText(/is not a WAV file/).waitFor();
  },
  'import-review-subtitles-off': async (page) => {
    const review = await openImportReview(page);
    // The default turned off: every Word heading's second line is joined back to its title (a title wrapped onto two lines).
    await review.getByRole('checkbox', { name: "Read a heading's second line as its subtitle" }).click();
    await review.getByRole('checkbox', { name: 'Subtitle — The Pool of Tears' }).click();
  },
  'import-review-text-subtitle': async (page) => {
    const review = await openImportReview(page, 'text');
    // A plain-text heading's second line turned off returns to the text: the row says the epigraph is read as text.
    await review.getByRole('checkbox', { name: /^Subtitle — “Curiouser and curiouser!”/ }).click();
  },
  'import-confirm-markdown': async (page) => {
    // The mock's Markdown seam (see main.tsx): the same book as a .md file, which is the one with the heading level choice.
    await page.goto('/?mockImportPreview=markdown');
    await settlePage(page);
    await clickVisible(page, 'button', 'Replace manuscript');
    await confirmDialog(page, 'Import Alice.md').waitFor();
  },
};
