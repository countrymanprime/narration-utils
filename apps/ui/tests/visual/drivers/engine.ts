// How to reach each `engine` state in STATE_CATALOG (see app.drivers.ts): the engine panel, opened from the header's engine chip
// (stage-navigation-and-page-replacement.prd.md Phase 6), and the REAPER tools' dialogs opened from it.
import { settlePage } from '../helpers/settle';
import { type Driver, clickVisible, openEditingCheckFromEngine, openEnginePanel } from './shared';

export const engineDrivers: Record<string, Driver> = {
  default: async (page) => {
    await openEnginePanel(page);
    await page.getByRole('table', { name: 'Chapter links' }).waitFor();
  },
  'sync-activity': async (page) => {
    await page.goto('/?mockChapterSync=activity');
    await settlePage(page);
    await openEnginePanel(page);
    await page.getByRole('button', { name: /^Undo: Linked/ }).waitFor();
  },
  'from-tracks-link': async (page) => {
    await page.goto('/tracks');
    await settlePage(page);
    // Proof's notes, behind the modal panel (so out of the accessibility tree, hence the CSS locator), have arrived too.
    await page.locator('table[aria-label="Notes"] tbody tr[data-row]').first().waitFor();
    await page.getByRole('dialog', { name: 'Audio engine' }).getByRole('table', { name: 'Tracks' }).waitFor();
  },
  'sync-off': async (page) => {
    await page.goto('/?mockChapterSync=off');
    await settlePage(page);
    await openEnginePanel(page);
    await page.getByText('Chapter sync is off.').waitFor();
  },
  'rpp-picker': async (page) => {
    // Reload with the mock's two-.rpp seam (see main.tsx) - the outer
    // loop's default page.goto('/') has already happened by now.
    await page.goto('/?mockMultipleRpp=1');
    await settlePage(page);
    await openEnginePanel(page);
    await page.getByText('Choose a REAPER project file').waitFor();
  },
  'no-rpp': async (page) => {
    await page.goto('/?mockNoRpp=1');
    await settlePage(page);
    await openEnginePanel(page);
    await page.getByText('No REAPER project file found').waitFor();
  },
  'no-daw-link': async (page) => {
    // Reload with the mock's no-linked-DAW seam (see main.tsx): the panel still reads its own .rpp discovery, but its
    // own DAW-link control switches from "Link a different REAPER project file" to "Link a REAPER project file".
    await page.goto('/?mockNoDaw=1');
    await settlePage(page);
    await openEnginePanel(page);
    await page.getByRole('button', { name: 'Link a REAPER project file' }).waitFor();
  },
  'chapter-link-confirmed': async (page) => {
    await openEnginePanel(page);
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
    await openEnginePanel(page);
    const table = page.getByRole('table', { name: 'Chapter links' });
    await table.scrollIntoViewIfNeeded();
    await page.getByText('Track missing').waitFor();
  },
  'editing-check-unmapped': async (page) => {
    const panel = await openEditingCheckFromEngine(page, 'mockEditingRefusal=unmapped');
    await clickVisible(page, 'button', 'Check editing');
    await panel.getByText('This chapter can’t be checked yet').waitFor();
  },
  'link-chapters-preview': async (page) => {
    await openEnginePanel(page);
    await clickVisible(page, 'button', 'Link chapters…');
    await page.getByRole('combobox', { name: 'Track for Chapter 1', exact: true }).selectOption({ label: 'Chapter 1' });
    await page.getByRole('button', { name: /^Stamp \d+ items?$/ }).waitFor();
  },
  'link-chapters-success': async (page) => {
    await page.goto('/?mockLineIdentity=success');
    await settlePage(page);
    await openEnginePanel(page);
    await clickVisible(page, 'button', 'Link chapters…');
    const message = page.getByText('Read 5 stamped lines.');
    await message.waitFor();
    await message.scrollIntoViewIfNeeded();
  },
  'link-chapters-conflict': async (page) => {
    await page.goto('/?mockLineIdentity=conflict');
    await settlePage(page);
    await openEnginePanel(page);
    await clickVisible(page, 'button', 'Link chapters…');
    const message = page.getByText(/Stamped 1 line, 1 stale item, 1 conflict\./);
    await message.waitFor();
    await message.scrollIntoViewIfNeeded();
  },
  'link-chapters-error': async (page) => {
    await page.goto('/?mockLineIdentity=error');
    await settlePage(page);
    await openEnginePanel(page);
    await clickVisible(page, 'button', 'Link chapters…');
    const message = page.getByText(/Narration Utils script/).first();
    await message.waitFor();
    await message.scrollIntoViewIfNeeded();
  },
  'render-config-prefilled': async (page) => {
    await openEnginePanel(page);
    await clickVisible(page, 'button', 'Prepare chapter render…');
    await page.getByRole('button', { name: 'Configure render' }).waitFor();
  },
  'render-config-success': async (page) => {
    await page.goto('/?mockRenderConfig=success');
    await settlePage(page);
    await openEnginePanel(page);
    await clickVisible(page, 'button', 'Prepare chapter render…');
    const message = page.getByText(/Render is configured/);
    await message.waitFor();
    await message.scrollIntoViewIfNeeded();
  },
  'render-config-no-regions': async (page) => {
    await page.goto('/?mockRenderConfig=no-regions');
    await settlePage(page);
    await openEnginePanel(page);
    await clickVisible(page, 'button', 'Prepare chapter render…');
    const message = page.getByText(/No chapter regions were found yet/);
    await message.waitFor();
    await message.scrollIntoViewIfNeeded();
  },
  'render-config-error': async (page) => {
    await page.goto('/?mockRenderConfig=error');
    await settlePage(page);
    await openEnginePanel(page);
    await clickVisible(page, 'button', 'Prepare chapter render…');
    const message = page.getByText(/cannot configure render settings/).first();
    await message.waitFor();
    await message.scrollIntoViewIfNeeded();
  },
  'create-regions-empty': async (page) => {
    await openEnginePanel(page);
    await clickVisible(page, 'button', 'Create chapter regions…');
    await page
      .getByText(/No track is linked to this chapter\./)
      .first()
      .waitFor();
  },
  'create-regions-preview': async (page) => {
    await page.goto('/?mockChapterLink=confirmed&mockRegionsCapabilityOn=1');
    await settlePage(page);
    await openEnginePanel(page);
    await clickVisible(page, 'button', 'Create chapter regions…');
    await page.getByRole('combobox', { name: 'Opening credits track' }).selectOption({ label: 'Chapter 2' });
    await page.getByRole('button', { name: 'Create 2 regions' }).waitFor();
  },
  'create-regions-success': async (page) => {
    await page.goto('/?mockChapterLink=confirmed&mockRegionsCapabilityOn=1');
    await settlePage(page);
    await openEnginePanel(page);
    await clickVisible(page, 'button', 'Create chapter regions…');
    await page.getByRole('combobox', { name: 'Opening credits track' }).selectOption({ label: 'Chapter 2' });
    await clickVisible(page, 'button', 'Create 2 regions');
    const message = page.getByText(/^Sent 2:/);
    await message.waitFor();
    await message.scrollIntoViewIfNeeded();
  },
  'create-regions-error': async (page) => {
    await page.goto('/?mockChapterLink=confirmed&mockRegionsCapabilityOn=1&mockRegionsCreateError=1');
    await settlePage(page);
    await openEnginePanel(page);
    await clickVisible(page, 'button', 'Create chapter regions…');
    await clickVisible(page, 'button', 'Create 1 region');
    const message = page.getByText(/REAPER refused to write the regions/).first();
    await message.waitFor();
    await message.scrollIntoViewIfNeeded();
  },
  'chapter-tags-idle': async (page) => {
    await openEnginePanel(page);
    await clickVisible(page, 'button', 'Embed chapter tags…');
    await page.getByText(/No chapter render is configured yet/).waitFor();
  },
  'chapter-tags-ready': async (page) => {
    await page.goto('/?mockChapterTags=ready');
    await settlePage(page);
    await openEnginePanel(page);
    await clickVisible(page, 'button', 'Embed chapter tags…');
    await page.getByRole('dialog', { name: 'Embed chapter tags' }).getByText('Chapter 2').waitFor();
  },
  'chapter-tags-not-rendered': async (page) => {
    await page.goto('/?mockChapterTags=not-rendered');
    await settlePage(page);
    await openEnginePanel(page);
    await clickVisible(page, 'button', 'Embed chapter tags…');
    await page.getByText('not rendered yet').waitFor();
  },
  'chapter-tags-success': async (page) => {
    await page.goto('/?mockChapterTags=ready');
    await settlePage(page);
    await openEnginePanel(page);
    await clickVisible(page, 'button', 'Embed chapter tags…');
    await page.getByLabel('Combined book MP3 to add chapters to').fill('C:\\Books\\Alice\\Alice in Wonderland.mp3');
    await page.getByRole('checkbox', { name: /I understand this writes a new file/ }).click();
    await clickVisible(page, 'button', 'Embed chapter tags');
    await page.getByText(/^Wrote /).waitFor();
  },
  'chapter-tags-error': async (page) => {
    await page.goto('/?mockChapterTags=ready&mockChapterTagsEmbedError=1');
    await settlePage(page);
    await openEnginePanel(page);
    await clickVisible(page, 'button', 'Embed chapter tags…');
    await page.getByLabel('Combined book MP3 to add chapters to').fill('C:\\Books\\Alice\\Alice in Wonderland.mp3');
    await page.getByRole('checkbox', { name: /I understand this writes a new file/ }).click();
    await clickVisible(page, 'button', 'Embed chapter tags');
    const message = page.getByText(/could not write chapter tags/).first();
    await message.waitFor();
    await message.scrollIntoViewIfNeeded();
  },
  'cleanup-tools-idle': async (page) => {
    await openEnginePanel(page);
    await clickVisible(page, 'button', 'Cleanup tools…');
    await page.getByRole('button', { name: 'Open Magnolius DeClick' }).waitFor();
  },
  'cleanup-tools-launched': async (page) => {
    await page.goto('/?mockCleanupTools=launched');
    await settlePage(page);
    await openEnginePanel(page);
    await clickVisible(page, 'button', 'Cleanup tools…');
    const message = page.getByText(/is open in REAPER/);
    await message.waitFor();
    await message.scrollIntoViewIfNeeded();
  },
  'cleanup-tools-error': async (page) => {
    await page.goto('/?mockCleanupTools=error');
    await settlePage(page);
    await openEnginePanel(page);
    await clickVisible(page, 'button', 'Cleanup tools…');
    const message = page.getByText(/Magnolius DeClick is not installed/).first();
    await message.waitFor();
    await message.scrollIntoViewIfNeeded();
  },
  'retake-lanes-list': async (page) => {
    await openEnginePanel(page);
    await clickVisible(page, 'button', 'Retakes on lanes…');
    await page.getByRole('button', { name: 'Play lane 2 for line-000013 on Chapter 1' }).waitFor();
  },
  'retake-lanes-picked': async (page) => {
    await page.goto('/?mockRetakeLanes=picked');
    await settlePage(page);
    await openEnginePanel(page);
    await clickVisible(page, 'button', 'Retakes on lanes…');
    const message = page.getByText(/is now the only lane playing/);
    await message.waitFor();
    await message.scrollIntoViewIfNeeded();
  },
  'retake-lanes-none': async (page) => {
    await page.goto('/?mockRetakeLanes=none');
    await settlePage(page);
    await openEnginePanel(page);
    await clickVisible(page, 'button', 'Retakes on lanes…');
    await page.getByText(/No track in the saved project uses fixed item lanes/).waitFor();
  },
  'retake-lanes-error': async (page) => {
    await page.goto('/?mockRetakeLanes=error');
    await settlePage(page);
    await openEnginePanel(page);
    await clickVisible(page, 'button', 'Retakes on lanes…');
    const message = page.getByText(/is not in fixed item lane mode/).first();
    await message.waitFor();
    await message.scrollIntoViewIfNeeded();
  },
};
