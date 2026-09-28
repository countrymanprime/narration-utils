// How to reach each `booth` state in STATE_CATALOG (see app.drivers.ts): the Booth page (stage-navigation-and-page-replacement.prd.md
// Phase 4), reached through the nav as a narrator would. It opens on Chapter 1 (the mock's last chapter read) unless a
// state picks otherwise.
import type { Page } from '@playwright/test';
import {
  type Driver,
  clickSettingsCategory,
  clickVisible,
  controlBar,
  goToPage,
  openBooth,
  openFlaggedBooth,
  openMicPopover,
  openResumePrompt,
  openSettingsPopover,
  scrollReaderByHand,
} from './shared';

const MICROPHONE = 'Microphone Array (Realtek(R) Audio)';
// The seams boot a session already 30 words into the first paragraph (word 35 of the chapter). Wait for the highlight to
// land there so the shot is never taken mid-walk.
const LISTENING_WORD = '[data-word="32"] [data-highlight="Cursor"]';

async function chooseMicrophone(page: Page): Promise<void> {
  await openMicPopover(page);
  await page.getByRole('combobox', { name: 'Microphone' }).selectOption({ label: MICROPHONE });
}

async function openListening(page: Page, extraQuery = ''): Promise<void> {
  await openBooth(page, `?mockTeleprompter=listening${extraQuery}`);
  await page.locator(LISTENING_WORD).waitFor();
}

const status = (page: Page) => page.getByRole('region', { name: 'Status' });

// Where the page's fake clock is paused when Play is pressed, so REAPER's recording starts at exactly this time and the
// driver can move the clock on by a known amount (read-aloud-control-bar mocks 07 and 10: "REC 06:42", "REC 14:08").
const REC_START = new Date('2026-09-28T10:00:00Z').getTime();
const PAUSED_AT = REC_START + 5_000;

// Record in REAPER turned on for this project (the first-time confirm answered) with the record capability on
// (?mockRecordCapabilityOn=1), a microphone chosen and the microphone popover closed again.
async function turnOnRecordInReaper(page: Page): Promise<void> {
  await openResumePrompt(page, '?mockRecordCapabilityOn=1&mockLevel=-18');
  await controlBar(page).getByRole('button', { name: 'Record in REAPER: Chapter 1 armed' }).click();
  await page.getByRole('alertdialog', { name: 'Record in REAPER when you press Play?' }).getByRole('button', { name: 'Turn on' }).click();
  await chooseMicrophone(page);
  await page.keyboard.press('Escape');
  await page.getByRole('combobox', { name: 'Microphone' }).waitFor({ state: 'detached' });
}

// Play with Record in REAPER on, on a paused fake clock: REAPER starts recording first (the mock confirms it), then
// reading starts, and nothing moves until the driver runs the clock on.
async function playRecording(page: Page): Promise<void> {
  await turnOnRecordInReaper(page);
  await page.clock.install({ time: REC_START });
  await page.clock.pauseAt(PAUSED_AT);
  await controlBar(page).getByRole('button', { name: 'Play' }).click();
  await controlBar(page).getByText('REC 00:00').waitFor();
}

export const boothDrivers: Record<string, Driver> = {
  setup: async (page) => {
    await openResumePrompt(page);
    await page.getByRole('button', { name: 'Resume from here' }).waitFor();
  },
  // REAPER's suggested chapter (teleprompter-engines-and-input-devices.prd.md Phase 11, ADR 0113), in the setup's picker.
  'chapter-suggested': async (page) => {
    await openBooth(page, '?mockChapterSuggestion=matched');
    await page.getByText(/Chosen from REAPER's armed track/).waitFor();
  },
  'chapter-suggestion-choices': async (page) => {
    await openBooth(page, '?mockChapterSuggestion=ambiguous');
    await page.getByRole('group', { name: 'Chapters suggested by REAPER' }).waitFor();
  },
  'resume-low-confidence': async (page) => {
    await openResumePrompt(page, '?mockResume=low_confidence');
    await page.getByText(/could also fit elsewhere/).waitFor();
  },
  'resume-complete': async (page) => {
    await openResumePrompt(page, '?mockResume=complete');
    await page.getByText('This chapter is recorded to the end. Play reads from the top.').waitFor();
  },
  // Reconciliation (read-aloud-resume-from-daw.prd.md Phase 3): agree presets Start reading without a click.
  'resume-agree': async (page) => {
    await openResumePrompt(page, '?mockResume=agree');
    await page.getByText(/REAPER and your last reading agree/).waitFor();
  },
  'resume-disagree': async (page) => {
    await openResumePrompt(page, '?mockResume=disagree');
    await page.getByText(/different places/).waitFor();
  },
  'resume-prompter-only': async (page) => {
    await openResumePrompt(page, '?mockResume=prompter_only');
    await page.getByText(/Your last reading stopped at/).waitFor();
  },
  // Live DAW state (read-aloud-resume-from-daw.prd.md Phase 4): the REAPER place read from REAPER now, and a recording.
  'resume-disagree-live': async (page) => {
    await openResumePrompt(page, '?mockResume=disagree_live');
    await page.getByText(/in REAPER now/).waitFor();
  },
  'resume-recording': async (page) => {
    await openResumePrompt(page, '?mockResume=recording');
    await page.getByText(/REAPER is recording on this track now/).waitFor();
  },
  'resume-not-found': async (page) => {
    await openResumePrompt(page, '?mockResume=not_found');
    await page.getByText(/did not match this chapter/).waitFor();
  },
  'resume-no-track': async (page) => {
    await openResumePrompt(page, '?mockResume=none');
    await page.getByText(/No track in Alice.rpp matches this chapter/).waitFor();
  },
  'resume-model-required': async (page) => {
    await openResumePrompt(page, '?mockAssets=missing');
    await page.getByRole('button', { name: 'Download model…' }).waitFor();
  },
  'resume-error': async (page) => {
    await openResumePrompt(page, '?mockResume=error');
    await page.getByRole('button', { name: 'Try again' }).waitFor();
  },
  // The prompt is gone the instant a choice is made (read-aloud-resume-from-daw.prd.md Phase 1): no summary, no Change.
  'resume-after-choice': async (page) => {
    await openResumePrompt(page);
    await page.getByRole('button', { name: 'Resume from here' }).click();
    await page.getByRole('region', { name: 'Where you stopped' }).waitFor({ state: 'detached' });
  },
  // A full session (start, then stop) on the same visit, then a wait for the Booth to settle back to idle: the prompt must
  // not return for the rest of this chapter's visit, so the next Start begins at the top with nothing to clear.
  'resume-after-session': async (page) => {
    await openResumePrompt(page);
    await chooseMicrophone(page);
    await controlBar(page).getByRole('button', { name: 'Play' }).click();
    await page.getByRole('button', { name: 'Stop reading', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Stop reading', exact: true }).click();
    await controlBar(page).getByRole('button', { name: 'Play' }).waitFor();
    await page.getByRole('region', { name: 'Where you stopped' }).waitFor({ state: 'detached' });
  },
  // REAPER playing makes the prompt go away by itself (read-aloud-resume-from-daw.prd.md Phase 5, RD7): the DAW mock pushes
  // its seeded transport (playing) on subscribe, as the host's heartbeat push would when REAPER starts.
  'resume-after-reaper-plays': async (page) => {
    await openBooth(page, '?mockDawPlayhead=12');
    await controlBar(page).getByRole('button', { name: 'Play' }).waitFor();
    await page.getByRole('region', { name: 'Where you stopped' }).waitFor({ state: 'detached' });
  },
  listening: async (page) => {
    await openListening(page);
  },
  // Manual scroll (teleprompter-engines-and-input-devices.prd.md Phase 10): a mouse wheel over the text pauses following;
  // the text stays where the narrator scrolled it, well past the highlighted word.
  'following-paused': async (page) => {
    await openListening(page);
    await scrollReaderByHand(page);
  },
  // Pause keeps the session, it does not stop it (read-aloud-control-bar.prd.md Phase 5, Q3, ADR 0248).
  paused: async (page) => {
    await openListening(page);
    await controlBar(page).getByRole('button', { name: 'Pause' }).click();
    await controlBar(page).getByRole('button', { name: 'Play' }).waitFor();
    await controlBar(page).getByRole('status').getByText('Paused').waitFor();
  },
  waiting: async (page) => {
    await openBooth(page, '?mockTeleprompter=waiting');
    await page.locator(LISTENING_WORD).waitFor();
  },
  done: async (page) => {
    await openBooth(page, '?mockTeleprompter=done');
    await controlBar(page).getByRole('status').filter({ hasText: 'Done' }).waitFor();
  },
  'stopped-at-end': async (page) => {
    await openBooth(page, '?mockTeleprompter=ended');
    await controlBar(page).getByRole('status').filter({ hasText: 'Stopped at the end of the chapter.' }).waitFor();
  },
  // Word-click seek (teleprompter-manuscript-integration.prd.md Phase 4): click the earliest "Go back to here" word (word 0)
  // and wait for the highlight to land there without restarting.
  'seek-back': async (page) => {
    await openListening(page);
    await page
      .getByRole('button', { name: /^Go back to here/ })
      .first()
      .click();
    await page.locator('[data-word="0"] [data-highlight="Cursor"]').waitFor();
  },
  // Story bible and note marks (teleprompter-manuscript-integration.prd.md Phase 5): a mark opens its entry in the rail.
  'story-bible-entry': async (page) => {
    await openListening(page);
    await page.getByRole('region', { name: 'Chapter text' }).locator('[data-highlight="Character"][role="button"]').first().click();
    await page.getByRole('tab', { name: 'Story bible', selected: true }).waitFor();
  },
  'note-open': async (page) => {
    await openBooth(page);
    await page.getByRole('region', { name: 'Chapter text' }).locator('[data-highlight="Note"][role="button"]').first().click();
    await page.getByRole('tab', { name: 'Notes', selected: true }).waitFor();
  },
  'rail-hidden': async (page) => {
    await openBooth(page);
    await page.getByRole('button', { name: 'Hide reading panel' }).click();
    await page.getByRole('button', { name: 'Show reading panel' }).waitFor();
  },
  // The command bar's microphone popover (read-aloud-control-bar.prd.md Phases 3-4): the device list, Refresh, and a live
  // level meter - fixed to -18 dBFS (?mockLevel=-18) for a stable, still capture (ADR 0247).
  'mic-popover': async (page) => {
    await openResumePrompt(page, '?mockLevel=-18');
    await chooseMicrophone(page);
    await page.getByRole('meter', { name: 'Input level' }).waitFor();
  },
  // The command bar's Settings popover (Phase 3): Engine and Model, each a toggle group, and "More in Settings".
  'settings-popover': async (page) => {
    await openResumePrompt(page);
    await openSettingsPopover(page);
  },
  // The bar's REAPER state (Phase 6, ADR 0249) on the Record in REAPER toggle. The mock's default, the chapter's track
  // armed and ready ("Chapter 1 armed", mock 06), is what `setup` shows, so it has no row of its own.
  'reaper-not-armed': async (page) => {
    await openResumePrompt(page, '?mockReaperState=not_armed');
    await controlBar(page).getByRole('button', { name: 'Record in REAPER: Not armed' }).waitFor();
  },
  'reaper-recording': async (page) => {
    await openResumePrompt(page, '?mockReaperState=recording_elsewhere');
    await controlBar(page).getByRole('button', { name: 'Record in REAPER: Recording' }).waitFor();
  },
  // The first-time confirm turning Record in REAPER on for the project (read-aloud-control-bar mock 05).
  'reaper-confirm': async (page) => {
    await openResumePrompt(page, '?mockRecordCapabilityOn=1');
    await controlBar(page).getByRole('button', { name: 'Record in REAPER: Chapter 1 armed' }).click();
    await page.getByRole('alertdialog', { name: 'Record in REAPER when you press Play?' }).waitFor();
  },
  // Reading while REAPER records the take this app started (mock 07): the toggle shows "REC 06:42".
  'reaper-rec': async (page) => {
    await playRecording(page);
    // A few seconds of reading, then the clock set 6 min 41 s into the take and one more second run, so the toggle's own
    // once-a-second tick shows 06:42 without replaying the whole chapter.
    await page.clock.runFor(5_000);
    await page.clock.setSystemTime(PAUSED_AT + 401_000);
    await page.clock.runFor(1_000);
    await controlBar(page).getByText('REC 06:42').waitFor();
    await page.locator('[data-highlight="Cursor"]').waitFor();
  },
  // Reading reached the end and stopped itself while REAPER keeps recording (mock 10, Q8 Done B): the bar says so and Stop,
  // highlighted, is the way to end it. The clock runs 14 min 8 s on: the mock's replay reaches the last word, the reading
  // stops itself five seconds later, and REAPER's take keeps counting.
  'finished-still-recording': async (page) => {
    await playRecording(page);
    await page.clock.runFor(848_000);
    await controlBar(page).getByText('Reading finished. REAPER is still recording').waitFor();
    await controlBar(page).getByText('REC 14:08').waitFor();
  },
  // Speaker tags in the text's gutter (mock 03, audit BO4): Chapter 3 is the demo chapter prep-depth's recorded cues attribute.
  'speaker-tags': async (page) => {
    await openBooth(page);
    await page.getByRole('combobox', { name: 'Chapter' }).selectOption({ value: 'chapter-3' });
    const tag = page.locator('[data-speaker-tag]').first();
    await tag.waitFor();
    await tag.scrollIntoViewIfNeeded();
  },
  // Suspected flags (teleprompter-manuscript-integration.prd.md Phase 7): the `flagged` mock seam is a session further into
  // the chapter whose flags arrive as the Booth subscribes. The rail's key has flag swatches too, so marks are found as controls.
  flags: async (page) => {
    await openFlaggedBooth(page);
  },
  'flag-open': async (page) => {
    await openFlaggedBooth(page);
    await page.locator('[data-highlight="Restart"][role="button"]').first().click();
    await page.getByRole('tab', { name: 'Flags', selected: true }).waitFor();
    await page.getByRole('region', { name: 'Suspected restart' }).waitFor();
  },
  // "Punch from here" wired to the real dawport.Puncher (booth-actions-enablement PRD Phase 3): the punch capability is
  // turned on directly (?mockPunchCapabilityOn=1) so the button is enabled without also exercising the Settings toggle.
  'flag-punch-confirm': async (page) => {
    await openFlaggedBooth(page, '&mockPunchCapabilityOn=1');
    await page.locator('[data-highlight="Restart"][role="button"]').first().click();
    await page.getByRole('button', { name: 'Punch from here' }).click();
    await page.getByRole('alertdialog', { name: 'Punch from here' }).waitFor();
  },
  'flags-all-kinds': async (page) => {
    await openFlaggedBooth(page);
    await page.getByRole('tab', { name: 'Flags' }).click();
    await page.getByRole('checkbox', { name: 'Misreads' }).click();
    await page.getByRole('checkbox', { name: 'Extra words' }).click();
    await page.locator('[data-highlight="Misread"][role="button"]').first().waitFor();
    await page.locator('[data-highlight="Extra"][role="button"]').first().waitFor();
  },
  // The credits (audiobook-credits-templates.prd.md Phase 4, manuscript-credits-card-parity.prd.md Phase 2): picked in the
  // setup's picker like a chapter; a microphone is chosen so Play shows enabled.
  'credits-opening': async (page) => {
    await openBooth(page, '?mockCredits=filled');
    await page.getByRole('combobox', { name: 'Chapter' }).selectOption({ label: 'Opening credits' });
    await page.getByText('Alice’s Adventures in Wonderland, written by Lewis Carroll, narrated by Ada Finch.').waitFor();
    await chooseMicrophone(page);
  },
  'credits-unresolved': async (page) => {
    await openBooth(page);
    await page.getByRole('combobox', { name: 'Chapter' }).selectOption({ label: 'Closing credits' });
    await page.getByRole('status', { name: /have no value/ }).waitFor();
    await chooseMicrophone(page);
  },
  // The Whisper model is not installed under ?mockAssets, so Play asks to download it; the mock holds the download at 40 percent.
  'model-download-progress': async (page) => {
    await openBooth(page, '?mockAssets=downloading');
    await chooseMicrophone(page);
    await controlBar(page).getByRole('button', { name: 'Play' }).click();
    await page.getByRole('button', { name: 'Download model' }).click();
    await page.getByRole('dialog', { name: 'Downloading Whisper model' }).waitFor();
    await page.getByText(/185 of 464 MB/).waitFor();
  },
  // Choosing Moonshine never downloads: its model is missing under ?mockAssets=missing, so Play asks first, naming the engine.
  'moonshine-model-required': async (page) => {
    await openBooth(page, '?mockAssets=missing');
    await chooseMicrophone(page);
    await openSettingsPopover(page);
    await page.getByRole('group', { name: 'Engine' }).getByRole('button', { name: 'Moonshine' }).click();
    await controlBar(page).getByRole('button', { name: 'Play' }).click();
    await page.getByRole('alertdialog', { name: 'Download local Moonshine model?' }).waitFor();
  },
  'no-microphone-blocked': async (page) => {
    await openBooth(page, '?mockNoDevices=1');
    await controlBar(page).getByRole('button', { name: 'Microphone: not chosen' }).click();
    await page.getByText('No microphone found').waitFor();
  },
  // Leaving while listening asks first (the read-aloud dialog's rule, kept on the page).
  'exit-confirm': async (page) => {
    await openListening(page);
    await status(page).getByRole('button', { name: 'Exit booth' }).click();
    await page.getByRole('alertdialog', { name: 'Stop reading?' }).waitFor();
  },
  // The Booth in the Dark theme, chosen the way a narrator chooses it (Settings > Appearance). The Booth follows the app
  // theme (ADR 0365): if it ever forced one palette again, this would render the same as 'setup' and the suite's
  // identical-states check would fail the run.
  dark: async (page) => {
    await goToPage(page, 'Settings');
    await clickVisible(page, 'tab', 'Global');
    await clickSettingsCategory(page, 'Appearance');
    await clickVisible(page, 'button', 'Dark');
    await openResumePrompt(page);
    await page.getByRole('button', { name: 'Resume from here' }).waitFor();
  },
  // Companion mode (booth-mode-and-companion-panel.prd.md Phase 7): the Booth header's Companion opens the same session in
  // CompanionShell, which covers the whole window.
  'companion-default': async (page) => {
    await openResumePrompt(page);
    await status(page).getByRole('button', { name: 'Companion' }).click();
    await page.getByRole('heading', { level: 1, name: 'Companion' }).waitFor();
  },
  'companion-listening': async (page) => {
    await openListening(page, '&mockDawPlayhead=134.6');
    await status(page).getByRole('button', { name: 'Companion' }).click();
    await page.getByText('Playhead 2:14.6').waitFor();
    await page.locator(LISTENING_WORD).waitFor();
  },
};
