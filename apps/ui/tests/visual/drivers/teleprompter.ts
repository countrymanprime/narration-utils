// How to reach each `teleprompter` state in STATE_CATALOG (see app.drivers.ts).
import { settlePage } from '../helpers/settle';
import { type Driver, goToPage, openMicPopover, openSettingsPopover, scrollReaderByHand } from './shared';

export const teleprompterDrivers: Record<string, Driver> = {
  'setup-default': async (page) => {
    await goToPage(page, 'Teleprompter');
    await page.getByText('Alice was beginning').first().waitFor();
  },
  'chapter-suggested': async (page) => {
    await page.goto('/?mockChapterSuggestion=matched');
    await settlePage(page);
    await goToPage(page, 'Teleprompter');
    await page.getByText(/Chosen from REAPER's armed track/).waitFor();
    await page
      .getByText(/Curiouser and curiouser/)
      .first()
      .waitFor();
  },
  'chapter-suggestion-choices': async (page) => {
    await page.goto('/?mockChapterSuggestion=ambiguous');
    await settlePage(page);
    await goToPage(page, 'Teleprompter');
    await page.getByRole('group', { name: 'Chapters suggested by REAPER' }).waitFor();
    await page.getByText('Alice was beginning').first().waitFor();
  },
  // The credits (credits PRD Phase 4): picked in the chapter picker like a chapter; a microphone is chosen so Play shows enabled.
  'credits-opening': async (page) => {
    await page.goto('/?mockCredits=filled');
    await settlePage(page);
    await goToPage(page, 'Teleprompter');
    await page.getByText('Alice was beginning').first().waitFor();
    await page.getByRole('combobox', { name: 'Chapter' }).selectOption({ label: 'Opening credits' });
    await page.getByText('Alice’s Adventures in Wonderland, written by Lewis Carroll, narrated by Ada Finch.').waitFor();
    await openMicPopover(page);
    await page.getByRole('combobox', { name: 'Microphone' }).selectOption({ label: 'Microphone Array (Realtek(R) Audio)' });
  },
  'credits-unresolved-warning': async (page) => {
    await goToPage(page, 'Teleprompter');
    await page.getByText('Alice was beginning').first().waitFor();
    await page.getByRole('combobox', { name: 'Chapter' }).selectOption({ label: 'Closing credits' });
    await page.getByRole('status', { name: /have no value/ }).waitFor();
    await openMicPopover(page);
    await page.getByRole('combobox', { name: 'Microphone' }).selectOption({ label: 'Microphone Array (Realtek(R) Audio)' });
  },
  // The Whisper model is not installed under ?mockAssets, so Play asks to download it; the mock holds the download at 40 percent.
  'model-download-progress': async (page) => {
    await page.goto('/?mockAssets=downloading');
    await settlePage(page);
    await goToPage(page, 'Teleprompter');
    await page.getByText('Alice was beginning').first().waitFor();
    await openMicPopover(page);
    await page.getByRole('combobox', { name: 'Microphone' }).selectOption({ label: 'Microphone Array (Realtek(R) Audio)' });
    await page.getByRole('button', { name: 'Play' }).click();
    await page.getByRole('button', { name: 'Download model' }).click();
    await page.getByRole('dialog', { name: 'Downloading Whisper model' }).waitFor();
    await page.getByText(/185 of 464 MB/).waitFor();
  },
  // Choosing Moonshine never downloads: its model is missing under ?mockAssets=missing, so Play asks first, naming the engine.
  'moonshine-model-required': async (page) => {
    await page.goto('/?mockAssets=missing');
    await settlePage(page);
    await goToPage(page, 'Teleprompter');
    await page.getByText('Alice was beginning').first().waitFor();
    await openMicPopover(page);
    await page.getByRole('combobox', { name: 'Microphone' }).selectOption({ label: 'Microphone Array (Realtek(R) Audio)' });
    await openSettingsPopover(page);
    await page.getByRole('group', { name: 'Engine' }).getByRole('button', { name: 'Moonshine' }).click();
    await page.getByRole('button', { name: 'Play' }).click();
    await page.getByRole('alertdialog', { name: 'Download local Moonshine model?' }).waitFor();
  },
  'no-microphone-blocked': async (page) => {
    await page.goto('/?mockNoDevices=1');
    await settlePage(page);
    await goToPage(page, 'Teleprompter');
    await page.getByText('Alice was beginning').first().waitFor();
    await page.getByRole('button', { name: 'Microphone: not chosen' }).click();
    await page.getByText('No microphone found').waitFor();
  },
  // The seams boot a session already 30 words into the first paragraph (word
  // 35 of the chapter). Wait for the highlight to land there so the shot is
  // never taken mid-walk.
  listening: async (page) => {
    await page.goto('/?mockTeleprompter=listening');
    await settlePage(page);
    await goToPage(page, 'Teleprompter');
    await page.locator('[data-word="32"] [data-highlight="Cursor"]').waitFor();
  },
  // Manual scroll (teleprompter-engines-and-input-devices.prd.md Phase 10): from the listening state, a mouse wheel over
  // the text pauses following; the text stays where the narrator scrolled it, well past the highlighted word.
  'following-paused': async (page) => {
    await page.goto('/?mockTeleprompter=listening');
    await settlePage(page);
    await goToPage(page, 'Teleprompter');
    await page.locator('[data-word="32"] [data-highlight="Cursor"]').waitFor();
    await scrollReaderByHand(page);
  },
  waiting: async (page) => {
    await page.goto('/?mockTeleprompter=waiting');
    await settlePage(page);
    await goToPage(page, 'Teleprompter');
    await page.locator('[data-word="32"] [data-highlight="Cursor"]').waitFor();
  },
  done: async (page) => {
    await page.goto('/?mockTeleprompter=done');
    await settlePage(page);
    await goToPage(page, 'Teleprompter');
    await page.getByRole('status').filter({ hasText: 'Done' }).waitFor();
  },
  'stopped-at-end': async (page) => {
    await page.goto('/?mockTeleprompter=ended');
    await settlePage(page);
    await goToPage(page, 'Teleprompter');
    await page.getByRole('status').filter({ hasText: 'Stopped at the end of the chapter.' }).waitFor();
  },
};
