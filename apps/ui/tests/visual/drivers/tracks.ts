// How to reach each `tracks` state in STATE_CATALOG (see app.drivers.ts).
import { settlePage } from '../helpers/settle';
import { type Driver, clickVisible, goToPage, openEditingCheckFromTracks } from './shared';

export const tracksDrivers: Record<string, Driver> = {
  default: async (page) => {
    await goToPage(page, 'Tracks');
    // The heading renders before the track list does.
    await page.getByRole('button', { name: 'Play', exact: true }).first().waitFor();
  },
  'unplayable-track-selected': async (page) => {
    await goToPage(page, 'Tracks');
    // Chapter 2's mock source file is missing on disk.
    await clickVisible(page, 'button', /Chapter 2/);
  },
  'sync-off': async (page) => {
    await page.goto('/?mockChapterSync=off');
    await settlePage(page);
    await goToPage(page, 'Tracks');
    await page.getByText('Chapter sync is off.').waitFor();
  },
  'sync-consent': async (page) => {
    // The consent dialog is a global, modal alertdialog (App.tsx): it can appear on any page and blocks the nav
    // behind it, so this goes straight to Tracks by URL instead of navigating there through the (blocked) sidebar.
    await page.goto('/tracks?mockChapterSync=ask');
    await settlePage(page);
    await page.getByRole('alertdialog', { name: 'Sync chapters to tracks?' }).waitFor();
  },
  'rpp-picker': async (page) => {
    // Reload with the mock's two-.rpp seam (see main.tsx) - the outer
    // loop's default page.goto('/') has already happened by now.
    await page.goto('/?mockMultipleRpp=1');
    await settlePage(page);
    await goToPage(page, 'Tracks');
    await page.getByText('Choose a REAPER project file').waitFor();
  },
  'no-rpp': async (page) => {
    await page.goto('/?mockNoRpp=1');
    await settlePage(page);
    await goToPage(page, 'Tracks');
    await page.getByText('No REAPER project file found').waitFor();
  },
  'no-daw-link': async (page) => {
    // Reload with the mock's no-linked-DAW seam (see main.tsx): Tracks still reads its own .rpp discovery, but its
    // own DAW-link control switches from "Link a different REAPER project file" to "Link a REAPER project file".
    await page.goto('/?mockNoDaw=1');
    await settlePage(page);
    await goToPage(page, 'Tracks');
    await page.getByRole('button', { name: 'Play', exact: true }).first().waitFor();
  },
  playing: async (page) => {
    await goToPage(page, 'Tracks');
    await clickVisible(page, 'button', 'Play');
    // The mock serves a real silent 10-minute WAV; wait for its metadata so
    // the readout shows a duration instead of 0:00 / 0:00.
    await page.getByText(/^0:0\d \/ 10:00$/).waitFor();
  },
  'skipped-forward': async (page) => {
    await goToPage(page, 'Tracks');
    await clickVisible(page, 'button', 'Play');
    await page.getByText(/^0:0\d \/ 10:00$/).waitFor();
    await clickVisible(page, 'button', 'Skip forward 30 seconds');
    await page.getByText(/^0:3\d \/ 10:00$/).waitFor();
  },
  'last-track-selected': async (page) => {
    await goToPage(page, 'Tracks');
    await clickVisible(page, 'button', /Click Track/);
  },
  'chapter-link-confirmed': async (page) => {
    await goToPage(page, 'Tracks');
    await page.getByRole('button', { name: 'Play', exact: true }).first().waitFor();
    const table = page.getByRole('table', { name: 'Chapter links' });
    await table.scrollIntoViewIfNeeded();
    // The first body row, by position: filtering by "has a combobox" would stop matching this same row the
    // instant Confirm turns it into the linked view (no combobox), so `waitFor` below would wait forever.
    const firstRow = table.locator('tbody tr').first();
    await firstRow.getByRole('combobox').selectOption({ index: 0 });
    await firstRow.getByRole('button', { name: 'Confirm' }).click();
    await firstRow.getByRole('button', { name: 'Change' }).waitFor();
  },
  'chapter-link-missing': async (page) => {
    // Reload with the mock's missing-track seam (see main.tsx): a confirmed link whose
    // trackGuid is not among the mock project's tracks.
    await page.goto('/?mockChapterLink=missing');
    await settlePage(page);
    await goToPage(page, 'Tracks');
    const table = page.getByRole('table', { name: 'Chapter links' });
    await table.scrollIntoViewIfNeeded();
    await page.getByText('Track missing').waitFor();
  },
  'editing-check-unmapped': async (page) => {
    const panel = await openEditingCheckFromTracks(page, 'mockEditingRefusal=unmapped');
    await clickVisible(page, 'button', 'Check editing');
    await panel.getByText('This chapter can’t be checked yet').waitFor();
  },
  'link-chapters-preview': async (page) => {
    await goToPage(page, 'Tracks');
    await clickVisible(page, 'button', 'Link chapters…');
    await page.getByRole('combobox', { name: 'Track for Chapter 1', exact: true }).selectOption({ label: 'Chapter 1' });
    await page.getByRole('button', { name: /^Stamp \d+ items?$/ }).waitFor();
  },
  'link-chapters-success': async (page) => {
    await page.goto('/?mockLineIdentity=success');
    await settlePage(page);
    await goToPage(page, 'Tracks');
    await clickVisible(page, 'button', 'Link chapters…');
    const message = page.getByText('Read 5 stamped lines.');
    await message.waitFor();
    await message.scrollIntoViewIfNeeded();
  },
  'link-chapters-conflict': async (page) => {
    await page.goto('/?mockLineIdentity=conflict');
    await settlePage(page);
    await goToPage(page, 'Tracks');
    await clickVisible(page, 'button', 'Link chapters…');
    const message = page.getByText(/Stamped 1 line, 1 stale item, 1 conflict\./);
    await message.waitFor();
    await message.scrollIntoViewIfNeeded();
  },
  'link-chapters-error': async (page) => {
    await page.goto('/?mockLineIdentity=error');
    await settlePage(page);
    await goToPage(page, 'Tracks');
    await clickVisible(page, 'button', 'Link chapters…');
    const message = page.getByText(/Narration Utils script/).first();
    await message.waitFor();
    await message.scrollIntoViewIfNeeded();
  },
  'pickups-empty': async (page) => {
    await goToPage(page, 'Tracks');
    await clickVisible(page, 'button', 'Pickups…');
    await page.getByText('No pickups yet').waitFor();
  },
  'pickups-imported': async (page) => {
    await goToPage(page, 'Tracks');
    await clickVisible(page, 'button', 'Pickups…');
    await page.locator('input[type="file"]').setInputFiles({
      name: 'pickups.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from('start,note,tag\n1.5,Mispronounced "labyrinthine",narrator\n42,Dog barked in the background,\n'),
    });
    await page.getByText('2 pickups remaining of 2').waitFor();
  },
  'pickups-import-errors': async (page) => {
    await goToPage(page, 'Tracks');
    await clickVisible(page, 'button', 'Pickups…');
    await page.locator('input[type="file"]').setInputFiles({
      name: 'pickups.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from('1.5,Good row\nnot-a-number,Bad row\n'),
    });
    await page.getByText(/1 row could not be used/).waitFor();
    // The row report lands immediately; the run itself settles 300ms later in the mock. Wait for the
    // completed message too, so the screenshot shows the settled "1 pickup remaining" count, not a still-busy
    // Import button over a stale "No pickups yet".
    await page.getByText('Imported 1 pickup.').waitFor();
  },
  'pickups-next': async (page) => {
    await page.goto('/?mockPickups=import-success');
    await settlePage(page);
    await goToPage(page, 'Tracks');
    await clickVisible(page, 'button', 'Pickups…');
    await clickVisible(page, 'button', 'Next pickup');
    await page.getByRole('button', { name: 'Mark this pickup done' }).waitFor();
  },
  'pickups-error': async (page) => {
    await page.goto('/?mockPickups=error');
    await settlePage(page);
    await goToPage(page, 'Tracks');
    await clickVisible(page, 'button', 'Pickups…');
    const message = page.getByText(/Narration Utils script/).first();
    await message.waitFor();
    await message.scrollIntoViewIfNeeded();
  },
  'render-config-prefilled': async (page) => {
    await goToPage(page, 'Tracks');
    await clickVisible(page, 'button', 'Prepare chapter render…');
    await page.getByRole('button', { name: 'Configure render' }).waitFor();
  },
  'render-config-success': async (page) => {
    await page.goto('/?mockRenderConfig=success');
    await settlePage(page);
    await goToPage(page, 'Tracks');
    await clickVisible(page, 'button', 'Prepare chapter render…');
    const message = page.getByText(/Render is configured/);
    await message.waitFor();
    await message.scrollIntoViewIfNeeded();
  },
  'render-config-no-regions': async (page) => {
    await page.goto('/?mockRenderConfig=no-regions');
    await settlePage(page);
    await goToPage(page, 'Tracks');
    await clickVisible(page, 'button', 'Prepare chapter render…');
    const message = page.getByText(/No chapter regions were found yet/);
    await message.waitFor();
    await message.scrollIntoViewIfNeeded();
  },
  'render-config-error': async (page) => {
    await page.goto('/?mockRenderConfig=error');
    await settlePage(page);
    await goToPage(page, 'Tracks');
    await clickVisible(page, 'button', 'Prepare chapter render…');
    const message = page.getByText(/cannot configure render settings/).first();
    await message.waitFor();
    await message.scrollIntoViewIfNeeded();
  },
  'chapter-tags-idle': async (page) => {
    await goToPage(page, 'Tracks');
    await clickVisible(page, 'button', 'Embed chapter tags…');
    await page.getByText(/No chapter render is configured yet/).waitFor();
  },
  'chapter-tags-ready': async (page) => {
    await page.goto('/?mockChapterTags=ready');
    await settlePage(page);
    await goToPage(page, 'Tracks');
    await clickVisible(page, 'button', 'Embed chapter tags…');
    await page.getByRole('dialog', { name: 'Embed chapter tags' }).getByText('Chapter 2').waitFor();
  },
  'chapter-tags-not-rendered': async (page) => {
    await page.goto('/?mockChapterTags=not-rendered');
    await settlePage(page);
    await goToPage(page, 'Tracks');
    await clickVisible(page, 'button', 'Embed chapter tags…');
    await page.getByText('not rendered yet').waitFor();
  },
  'chapter-tags-success': async (page) => {
    await page.goto('/?mockChapterTags=ready');
    await settlePage(page);
    await goToPage(page, 'Tracks');
    await clickVisible(page, 'button', 'Embed chapter tags…');
    await page.getByLabel('Combined book MP3 to add chapters to').fill('C:\\Books\\Alice\\Alice in Wonderland.mp3');
    await page.getByRole('checkbox', { name: /I understand this writes a new file/ }).click();
    await clickVisible(page, 'button', 'Embed chapter tags');
    await page.getByText(/^Wrote /).waitFor();
  },
  'chapter-tags-error': async (page) => {
    await page.goto('/?mockChapterTags=ready&mockChapterTagsEmbedError=1');
    await settlePage(page);
    await goToPage(page, 'Tracks');
    await clickVisible(page, 'button', 'Embed chapter tags…');
    await page.getByLabel('Combined book MP3 to add chapters to').fill('C:\\Books\\Alice\\Alice in Wonderland.mp3');
    await page.getByRole('checkbox', { name: /I understand this writes a new file/ }).click();
    await clickVisible(page, 'button', 'Embed chapter tags');
    const message = page.getByText(/could not write chapter tags/).first();
    await message.waitFor();
    await message.scrollIntoViewIfNeeded();
  },
  'cleanup-tools-idle': async (page) => {
    await goToPage(page, 'Tracks');
    await clickVisible(page, 'button', 'Cleanup tools…');
    await page.getByRole('button', { name: 'Open Magnolius DeClick' }).waitFor();
  },
  'cleanup-tools-launched': async (page) => {
    await page.goto('/?mockCleanupTools=launched');
    await settlePage(page);
    await goToPage(page, 'Tracks');
    await clickVisible(page, 'button', 'Cleanup tools…');
    const message = page.getByText(/is open in REAPER/);
    await message.waitFor();
    await message.scrollIntoViewIfNeeded();
  },
  'cleanup-tools-error': async (page) => {
    await page.goto('/?mockCleanupTools=error');
    await settlePage(page);
    await goToPage(page, 'Tracks');
    await clickVisible(page, 'button', 'Cleanup tools…');
    const message = page.getByText(/Magnolius DeClick is not installed/).first();
    await message.waitFor();
    await message.scrollIntoViewIfNeeded();
  },
  'retake-lanes-list': async (page) => {
    await goToPage(page, 'Tracks');
    await clickVisible(page, 'button', 'Retakes on lanes…');
    await page.getByRole('button', { name: 'Play lane 2 for line-000013 on Chapter 1' }).waitFor();
  },
  'retake-lanes-picked': async (page) => {
    await page.goto('/?mockRetakeLanes=picked');
    await settlePage(page);
    await goToPage(page, 'Tracks');
    await clickVisible(page, 'button', 'Retakes on lanes…');
    const message = page.getByText(/is now the only lane playing/);
    await message.waitFor();
    await message.scrollIntoViewIfNeeded();
  },
  'retake-lanes-none': async (page) => {
    await page.goto('/?mockRetakeLanes=none');
    await settlePage(page);
    await goToPage(page, 'Tracks');
    await clickVisible(page, 'button', 'Retakes on lanes…');
    await page.getByText(/No track in the saved project uses fixed item lanes/).waitFor();
  },
  'retake-lanes-error': async (page) => {
    await page.goto('/?mockRetakeLanes=error');
    await settlePage(page);
    await goToPage(page, 'Tracks');
    await clickVisible(page, 'button', 'Retakes on lanes…');
    const message = page.getByText(/is not in fixed item lane mode/).first();
    await message.waitFor();
    await message.scrollIntoViewIfNeeded();
  },
};
