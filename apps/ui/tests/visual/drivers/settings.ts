// How to reach each `settings` state in STATE_CATALOG (see app.drivers.ts).
import { settlePage } from '../helpers/settle';
import { type Driver, clickNav, clickSettingsCategory, clickVisible, confirmDialog, goToPage, openLocalAssets } from './shared';

export const settingsDrivers: Record<string, Driver> = {
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
  'global-stage-recommendations': async (page) => {
    await goToPage(page, 'Settings');
    await clickVisible(page, 'tab', 'Global');
    await clickSettingsCategory(page, 'Stage suggestions');
    await page.getByText('Suggest stage advances').waitFor();
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
    await page.getByRole('combobox', { name: 'Default delivery profile' }).waitFor();
  },
  'delivery-profile-editor': async (page) => {
    await goToPage(page, 'Settings');
    await clickVisible(page, 'tab', 'Global');
    await clickSettingsCategory(page, 'Delivery');
    await page.getByRole('button', { name: 'Duplicate' }).click();
    const editor = page.getByRole('dialog', { name: 'Edit profile' });
    await editor.getByRole('textbox', { name: 'Peak, highest (dBFS)' }).fill('-3.5');
    await editor.getByText('Changed').waitFor();
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
    await page.goto('/?mockDeliveryProfile=custom');
    await settlePage(page);
    await goToPage(page, 'Settings');
    await clickVisible(page, 'tab', 'This Project');
    await clickSettingsCategory(page, 'Delivery');
    await page.getByRole('combobox', { name: 'Delivery profile for this project' }).waitFor();
    await page.getByText('My ACX, tighter peak', { exact: true }).waitFor();
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
  // Every empty field with a manuscript-detected candidate shows its own source caption (credits-token-setup-and-
  // front-matter-detection.prd.md Phase 1), not just Title and Author.
  'project-credits-detected': async (page) => {
    await page.goto('/?mockCredits=detected');
    await settlePage(page);
    await goToPage(page, 'Settings');
    await clickVisible(page, 'tab', 'This Project');
    await clickSettingsCategory(page, 'Credits');
    const detected = page.getByText('Detected from the copyright line: “1865”.');
    await detected.waitFor();
    await page.getByText(/Detected from a line ending in .Publishers.: “Macmillan” \(check this\)\./).waitFor();
    // Scrolled into view: at the desktop viewport's own scroll position (single load, no reloadPerViewport) this
    // caption sits below the fold, making the desktop capture pixel-identical to plain project-credits otherwise.
    await detected.scrollIntoViewIfNeeded();
  },
  // Credits PRD Phase 5: the chapter announcement template ?mockCredits=extras adds, previewed for Chapter 1.
  'project-credits-chapter-announcement': async (page) => {
    await page.goto('/?mockCredits=extras');
    await settlePage(page);
    await goToPage(page, 'Settings');
    await clickVisible(page, 'tab', 'This Project');
    await clickSettingsCategory(page, 'Credits');
    await page.getByRole('combobox', { name: 'Template' }).selectOption({ label: 'Chapter announcement (Chapter announcement)' });
    await page.getByText(/Shown for Chapter 1/).waitFor();
  },
  // The retail sample ?mockCredits=extras picked (Chapter 3, lines 1-3), scrolled into view.
  'project-credits-retail-sample': async (page) => {
    await page.goto('/?mockCredits=extras');
    await settlePage(page);
    await goToPage(page, 'Settings');
    await clickVisible(page, 'tab', 'This Project');
    await clickSettingsCategory(page, 'Credits');
    await page.getByText(/line 1 to Chapter 3, line 3/).waitFor();
    await page.getByRole('heading', { name: 'Retail sample' }).scrollIntoViewIfNeeded();
  },
  // A range over 5 minutes (Chapter 1 to Chapter 12) is refused, and the refusal says why.
  'project-credits-retail-sample-refused': async (page) => {
    await goToPage(page, 'Settings');
    await clickVisible(page, 'tab', 'This Project');
    await clickSettingsCategory(page, 'Credits');
    await page.getByRole('combobox', { name: 'Sample ends in' }).selectOption({ label: 'Chapter 12' });
    await page.getByRole('button', { name: 'Save sample' }).click();
    await page.getByText(/at most 5 minutes/).waitFor();
    await page.getByRole('button', { name: 'Save sample' }).scrollIntoViewIfNeeded();
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
};
