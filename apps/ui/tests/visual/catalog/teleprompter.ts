// The `teleprompter` rows of STATE_CATALOG (see state-catalog.ts), in the order they are captured.
import type { StateEntry } from '../lib/types';

export const teleprompterStates: StateEntry[] = [
  // Teleprompter
  {
    page: 'teleprompter',
    state: 'setup-default',
    description:
      'Teleprompter, before a session - chapter, microphone (picker of enumerated devices), engine (Whisper or Moonshine, as a Windows host offers) and model choices with the chapter text below (no highlight yet)',
  },
  {
    page: 'teleprompter',
    state: 'chapter-suggested',
    description:
      'Teleprompter, the chapter preselected from REAPER (teleprompter-engines-and-input-devices.prd.md Phase 11, ADR 0113) - the saved .rpp\'s armed track "Chapter 2" is named for Chapter 2, so the picker opens on it with "Chosen from REAPER\'s armed track ... as of its last save" beneath (?mockChapterSuggestion=matched)',
  },
  {
    page: 'teleprompter',
    state: 'chapter-suggestion-choices',
    description:
      'Teleprompter, two armed tracks naming different chapters (Phase 11, ADR 0113) - nothing is preselected (the picker keeps Chapter 1) and the other suggested chapter is offered as a button beneath, "could be for more than one chapter" (?mockChapterSuggestion=ambiguous)',
  },
  {
    page: 'teleprompter',
    state: 'credits-opening',
    description:
      'Teleprompter, "Opening credits" chosen (audiobook-credits-templates.prd.md Phase 4) - first in the picker, before the chapters; the credits the host rendered from the first opening template are the text below, every token filled (?mockCredits=filled), no warning',
  },
  {
    page: 'teleprompter',
    state: 'credits-unresolved-warning',
    description:
      'Teleprompter, "Closing credits" chosen with no project credits values - a warning names the tokens with no value (Title, Author, Narrator) with "Fill them in Settings", the placeholders show in brackets in the text, and Play is still enabled (C6: warn, never block)',
  },
  {
    page: 'teleprompter',
    state: 'model-download-progress',
    description: 'Teleprompter, the Whisper model download after Play, with real bytes and Cancel (?mockAssets=downloading)',
  },
  {
    page: 'teleprompter',
    state: 'moonshine-model-required',
    description:
      'Teleprompter, Moonshine chosen as the engine and Play pressed with its model not installed - the first-use question names the engine, its size, publisher and licence, and nothing downloads until Download model (?mockAssets=missing)',
  },
  {
    page: 'teleprompter',
    state: 'no-microphone-blocked',
    description:
      'Teleprompter, device enumeration found nothing - "No microphone found" blocking message, no dropdown and no typed fallback, Play disabled (?mockNoDevices=1)',
  },
  {
    page: 'teleprompter',
    state: 'listening',
    description:
      'Teleprompter, mid-session and listening - the setup fields collapse to a status bar with Stop, the current word has the solid accent highlight and read words are dimmed (reached via the ?mockTeleprompter=listening mock seam)',
  },
  {
    page: 'teleprompter',
    state: 'following-paused',
    description:
      'Teleprompter, listening after the narrator scrolled the text by hand (teleprompter-engines-and-input-devices.prd.md Phase 10) - following is paused ("Following paused" under the status), the Follow button beside Stop is enabled, and the highlighted word has scrolled out of view without being pulled back',
  },
  {
    page: 'teleprompter',
    state: 'waiting',
    description:
      'Teleprompter, mid-session but the narrator has paused - "Waiting for you to return to the script" (reached via the ?mockTeleprompter=waiting mock seam)',
  },
  {
    page: 'teleprompter',
    state: 'done',
    description:
      'Teleprompter, chapter finished - every word dimmed, no current word, "Done - stopping in a few seconds unless you read on" status (the host auto-stop is pending) (reached via the ?mockTeleprompter=done mock seam)',
  },
  {
    page: 'teleprompter',
    state: 'stopped-at-end',
    description:
      'Teleprompter, the session stopped itself at the end of the chapter (the host auto-stop, ADR 0106) - "Stopped at the end of the chapter." with Play offered again and the chapter still dimmed (reached via the ?mockTeleprompter=ended mock seam)',
  },
];
