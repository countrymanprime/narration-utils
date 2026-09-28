// How to reach each `storybible` state in STATE_CATALOG (see app.drivers.ts).
import { settlePage } from '../helpers/settle';
import { type Driver, askForTheLanguageModel, askForThePreviewVoice, clickNav, clickVisible, confirmDialog, goToPage, saveOnlineDictionaryKey } from './shared';

export const storybibleDrivers: Record<string, Driver> = {
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
  'entry-pronunciation-work': async (page) => {
    await goToPage(page, 'Story Bible');
    await page.locator('tr[data-row]').first().click();
    const unlock = page.getByRole('button', { name: 'Unlock entry' });
    if (await unlock.count()) await unlock.click();
    await clickVisible(page, 'button', 'Edit this entry');
    await clickVisible(page, 'button', 'Pronunciation details');
    await page.getByRole('textbox', { name: 'Your pronunciation' }).fill('ˈæ.lɪs');
    await clickVisible(page, 'button', 'Use mine');
    await page.getByText('Also kept:').waitFor();
    await page.getByRole('combobox', { name: /^Pronunciation status for / }).selectOption('query_sent');
    await page.getByRole('textbox', { name: 'Pronunciation note' }).fill('Asked the author by email.');
    await clickVisible(page, 'button', 'Save status');
    await page.getByText('Asked the author by email.', { exact: true }).first().waitFor();
    await page.getByRole('button', { name: 'Save status' }).scrollIntoViewIfNeeded();
  },
  'entry-pronunciation-online': async (page) => {
    await saveOnlineDictionaryKey(page);
    // The "key saved" toast belongs to Settings; dismissed so it does not cover the answer this state is about.
    await page.getByRole('button', { name: 'Dismiss message' }).click();
    await goToPage(page, 'Story Bible');
    await page.locator('tr[data-row]').first().click();
    const unlock = page.getByRole('button', { name: 'Unlock entry' });
    if (await unlock.count()) await unlock.click();
    await clickVisible(page, 'button', 'Edit this entry');
    await clickVisible(page, 'button', 'Pronunciation details');
    await page.getByRole('button', { name: /^Look up .+ online in Merriam-Webster$/ }).click();
    const answer = page.getByRole('button', { name: /^Use .+ as your pronunciation of / }).first();
    await answer.waitFor();
    await answer.evaluate((element) => element.scrollIntoView({ block: 'center' }));
  },
  'pronunciation-queries-online-confirm': async (page) => {
    await goToPage(page, 'Story Bible');
    await clickVisible(page, 'button', 'Pronunciation queries');
    await page.getByRole('list', { name: 'Pronunciation queries' }).waitFor();
    await clickVisible(page, 'button', 'Look up online…');
    await page.getByRole('alertdialog', { name: /^Look up \d+ names? online\?$/ }).waitFor();
  },
  'pronunciation-queries': async (page) => {
    await goToPage(page, 'Story Bible');
    await clickVisible(page, 'button', 'Pronunciation queries');
    const list = page.getByRole('list', { name: 'Pronunciation queries' });
    await list.waitFor();
    await list
      .getByRole('button', { name: /^Mark .+ as sent$/ })
      .first()
      .click();
    await page.getByRole('status').filter({ hasText: '1 sent' }).waitFor();
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
  'character-voice-references': async (page) => {
    await goToPage(page, 'Story Bible');
    // The Hatter's fixture reference is changed since approval (the mock's snapshot no longer matches a current
    // region by that GUID), so selecting them shows the warning badge alongside a steady reference elsewhere.
    await page.locator('tr[data-row]', { hasText: 'Hatter' }).click();
    await page.getByText('Reference clips').waitFor();
    await page.getByText('Changed since approval').waitFor();
    await page.getByText('Dialogue cues').waitFor();
  },
  'voice-data-panel': async (page) => {
    await goToPage(page, 'Story Bible');
    await clickVisible(page, 'button', 'Voice data');
    await page.getByRole('dialog', { name: 'Voice data' }).waitFor();
    await page.getByRole('combobox', { name: 'Approve a region for Narration' }).waitFor();
  },
  'remove-voice-data-confirm': async (page) => {
    await goToPage(page, 'Story Bible');
    await clickVisible(page, 'button', 'Voice data');
    await clickVisible(page, 'button', 'Remove voice data…');
    await confirmDialog(page, 'Remove voice data').waitFor();
  },
  'series-tab-empty': async (page) => {
    await page.goto('/?mockSeries=not-in-series');
    await settlePage(page);
    await clickNav(page, 'Story Bible');
    await clickVisible(page, 'tab', 'Series');
    await page.getByText(/no other books in this series yet/i).waitFor();
  },
  'series-tab-populated': async (page) => {
    await goToPage(page, 'Story Bible');
    await clickVisible(page, 'tab', 'Series');
    await page.getByText('Wonderland', { exact: true }).waitFor();
    await page.getByText('Alice ref, Looking-Glass Ch. 1').waitFor();
  },
};
