// The `booth` rows of STATE_CATALOG (see state-catalog.ts), in the order they are captured: the Booth page
// (stage-navigation-and-page-replacement.prd.md Phase 4), which replaced the Teleprompter page's `teleprompter/*` rows and the
// Manuscript's read-aloud, booth and companion dialog rows (`manuscript/read-aloud-*`, `booth-*`, `companion-*`).
import type { StateEntry } from '../lib/types';
import { COMPANION, FREEZES_THE_CLOCK, REFLOW } from './shared';

export const boothStates: StateEntry[] = [
  {
    page: 'booth',
    state: 'setup',
    description:
      'Booth (stage-navigation-and-page-replacement.prd.md Phase 4, mock 03), before a session - on FocusShell: a status line (Ready, the chapter, a decorative Input meter, Companion and Exit booth Esc), the pre-session setup above the text (with "Record with": REAPER chosen, the built-in recorder offered as Experimental, native-recording Phase 2), the text itself full-bleed and large with no card around it (audit BO3) (the Chapter picker, credits included), the resume prompt (read-aloud-resume-from-daw.prd.md Phase 1) offering where the recording ends - the matched track, "as of the project\'s last save", the sentence, and Resume from here / Start from the top / Pick a word - the rail (Voices in scene, Coming up - the next names with a Story Bible pronunciation, audit BO8 - then the reading panel) and, as the command bar, the reading controls with Play, Stop reading, the microphone, Record in REAPER ("Chapter 1 armed", mock 06) and Settings',
    ...REFLOW,
  },
  {
    page: 'booth',
    state: 'chapter-suggested',
    description:
      'Booth, the chapter preselected from REAPER (teleprompter-engines-and-input-devices.prd.md Phase 11, ADR 0113) - the saved .rpp\'s armed track "Chapter 2" is named for Chapter 2, so the picker opens on it with "Chosen from REAPER\'s armed track ... as of its last save" beneath (?mockChapterSuggestion=matched)',
  },
  {
    page: 'booth',
    state: 'chapter-suggestion-choices',
    description:
      'Booth, two armed tracks naming different chapters (Phase 11, ADR 0113) - nothing is preselected (the picker keeps Chapter 1) and the other suggested chapter is offered as a button beneath, "could be for more than one chapter" (?mockChapterSuggestion=ambiguous)',
  },
  {
    page: 'booth',
    state: 'resume-low-confidence',
    description:
      'Booth, the resume prompt when the end of the recording also fits elsewhere in the chapter (?mockResume=low_confidence) - offered as a guess to check, with its confidence and sentence; Resume from here is not the primary action',
  },
  {
    page: 'booth',
    state: 'resume-complete',
    description:
      'Booth, the resume prompt when the recording already reaches the chapter\'s last word - "This chapter is recorded to the end", no Resume from here, only Pick a word (fixes offering to resume past the end)',
  },
  {
    page: 'booth',
    state: 'resume-agree',
    description:
      "Booth, the resume prompt when REAPER's recording and the prompter's last reading agree (read-aloud-resume-from-daw.prd.md Phase 3, RD3/RD4, ?mockResume=agree) - a one-line notice presets Start reading to the DAW word without asking, with Change and Start from the top as links; the control bar's start-point chip shows the same preset with no click made",
    ...REFLOW,
  },
  {
    page: 'booth',
    state: 'resume-disagree',
    description:
      'Booth, the resume prompt when REAPER and the last reading are far apart (Phase 3, RD1, ?mockResume=disagree) - a compact two-way choice, REAPER and Last reading side by side with their own sentence and word number, plus Start from the top and Pick a word',
    ...REFLOW,
  },
  {
    page: 'booth',
    state: 'resume-prompter-only',
    description:
      'Booth, the resume prompt when only the prompter remembers a last reading - no track, no recording (Phase 3, RD8, ?mockResume=prompter_only) - one line, "Your last reading stopped at … Continue there?", never taken silently',
    ...REFLOW,
  },
  {
    page: 'booth',
    state: 'resume-disagree-live',
    description:
      'Booth, the resume prompt disagreeing when the REAPER place comes from REAPER\'s live edit cursor, not the saved project (read-aloud-resume-from-daw.prd.md Phase 4, RD2, ADR 0349, ?mockResume=disagree_live) - the REAPER card reads "in REAPER now" instead of "as of the project\'s last save", as in the approved 02-disagree mockup',
    ...REFLOW,
  },
  {
    page: 'booth',
    state: 'resume-recording',
    description:
      'Booth, the resume prompt while REAPER records onto the chapter\'s track (Phase 4, ?mockResume=recording) - "in REAPER now", nothing located because the take is still being written, reading starts from the top; no resume button',
    ...REFLOW,
  },
  {
    page: 'booth',
    state: 'resume-not-found',
    description:
      "Booth, the resume prompt when the recording's tail did not match the chapter (?mockResume=not_found) - no resume word; says reading starts from the top, shows what was heard, offers Pick a word",
  },
  {
    page: 'booth',
    state: 'resume-no-track',
    description:
      'Booth, the resume prompt when no track in the REAPER project matches the chapter (?mockResume=none) - says reading starts from the top, with a "Link a track" link to the Tracks page instead of a picker in place (Chapter Track Link Control owns linking)',
  },
  {
    page: 'booth',
    state: 'resume-model-required',
    description:
      'Booth, the resume prompt when the Whisper model the lookup needs is not downloaded (?mockAssets=missing) - says so with a Download model button that opens the first-use confirm; nothing downloads by itself',
  },
  {
    page: 'booth',
    state: 'resume-error',
    description: 'Booth, the resume prompt when the lookup failed (?mockResume=error) - the reason as an alert, Try again, reading from the top meanwhile',
  },
  {
    page: 'booth',
    state: 'resume-after-choice',
    description: 'Booth after "Resume from here" - the resume prompt is gone at once (no summary, no Change): the header slot above the text is empty',
  },
  {
    page: 'booth',
    state: 'resume-after-session',
    description:
      "Booth after a session has started and ended once - the resume prompt does not come back for the rest of this chapter's visit, so the next Play begins at the top with nothing to clear",
  },
  {
    page: 'booth',
    state: 'resume-after-reaper-plays',
    description:
      'Booth opened while REAPER plays (read-aloud-resume-from-daw.prd.md Phase 5, RD7, ADR 0350, ?mockDawPlayhead=12) - the resume prompt has gone away by itself and nothing was preset: the text starts at the top of the text column and Play begins at the top, as in the approved 04-after-play-prompt-gone mockup',
  },
  {
    page: 'booth',
    state: 'listening',
    description:
      'Booth mid-session and listening (?mockTeleprompter=listening) - the status badge reads Reading, the status line\'s progress ("¶ 1 of N · n% · ~m:ss finished left", audit BO5) beside the chapter, the command bar shows Listening, the word count, Pause, Stop reading and Follow (disabled, following), the setup above the text is gone, the current word highlighted and read words dimmed',
  },
  {
    page: 'booth',
    state: 'following-paused',
    description:
      'Booth listening after the narrator scrolled the text by hand (teleprompter-engines-and-input-devices.prd.md Phase 10) - "Following paused" and an enabled Follow button beside Stop, the highlighted word scrolled out of view',
  },
  {
    page: 'booth',
    state: 'paused',
    description:
      'Booth after pressing Pause mid-session (read-aloud-control-bar.prd.md Phase 5, Q3, ADR 0248) - the control bar\'s toggle shows Play (not pressed), the status reads "Paused", and the session keeps its place rather than stopping',
    ...REFLOW,
  },
  {
    page: 'booth',
    state: 'waiting',
    description:
      'Booth, mid-session but the narrator has paused - "Waiting for you to return to the script" (reached via the ?mockTeleprompter=waiting mock seam)',
  },
  {
    page: 'booth',
    state: 'done',
    description:
      'Booth, chapter finished - every word dimmed, no current word, "Done - stopping in a few seconds unless you read on" status (the host auto-stop is pending) (reached via the ?mockTeleprompter=done mock seam)',
  },
  {
    page: 'booth',
    state: 'stopped-at-end',
    description:
      'Booth, the session stopped itself at the end of the chapter (the host auto-stop, ADR 0106) - "Stopped at the end of the chapter." with Play offered again and the chapter still dimmed (reached via the ?mockTeleprompter=ended mock seam)',
  },
  {
    page: 'booth',
    state: 'seek-back',
    description:
      'Booth after clicking an earlier word ("Go back to here", teleprompter-manuscript-integration.prd.md Phase 4) - the highlight has jumped back to the clicked word without restarting the session',
  },
  {
    page: 'booth',
    state: 'story-bible-entry',
    description:
      'Booth listening, after clicking a Story Bible name in the text (teleprompter-manuscript-integration.prd.md Phase 5) - the rail switches to its Story bible tab with the entry, read-only; the highlight and the text stay where they were',
  },
  {
    page: 'booth',
    state: 'note-open',
    description: 'Booth before a session, after clicking a note mark (Phase 5) - the rail switches to its Notes tab with that note current',
  },
  {
    page: 'booth',
    state: 'rail-hidden',
    description: 'Booth with its reading panel hidden (Phase 5) - the text takes the width, a "Show reading panel" button stays at the side',
  },
  {
    page: 'booth',
    state: 'mic-popover',
    description:
      "Booth with the control bar's microphone popover open (read-aloud-control-bar.prd.md Phases 3-4) - the device list, the selected device, Refresh, and a live input-level meter (a fixed -18 dBFS reading, ?mockLevel=-18, ADR 0247) both inside the popover and, decoratively, in the bar's own microphone button",
    ...REFLOW,
  },
  {
    page: 'booth',
    state: 'settings-popover',
    description:
      'Booth with the control bar\'s Settings popover open (read-aloud-control-bar.prd.md Phase 3) - Engine (when the host offers more than one) and Model as toggle groups, and a "More in Settings" link',
    ...REFLOW,
  },
  {
    page: 'booth',
    state: 'reaper-not-armed',
    description:
      "Booth with the command bar's REAPER state showing the chapter's linked track not armed (Phase 6, ?mockReaperState=not_armed); the mock's default, the track armed and ready, is setup's",
    sameAs: {
      of: 'booth/setup',
      viewports: ['tablet'],
      reason:
        'Below `lg` the Record in REAPER button shows its icon only (ReadingControlBar keeps the width for the controls): the REAPER state is its accessible name there, and its visible text from `lg`, where this row differs.',
    },
  },
  {
    page: 'booth',
    state: 'reaper-confirm',
    description:
      'Booth, Record in REAPER pressed for the first time in this project with the record capability on (?mockRecordCapabilityOn=1) - the confirm in read-aloud-control-bar mock 05\'s words: "Record in REAPER when you press Play?", the track linked to the chapter, "a recording you started in REAPER yourself is never stopped by the app" and "You will be asked this once for this project"',
  },
  {
    page: 'booth',
    state: 'reaper-rec',
    description:
      'Booth reading while REAPER records the take this app started (read-aloud-control-bar mock 07): Record in REAPER on, Play pressed, and the toggle showing "REC 06:42" in the danger colour (the page clock held 6 min 42 s after REAPER confirmed); the status badge reads REC · P&R',
    ...FREEZES_THE_CLOCK,
  },
  {
    page: 'booth',
    state: 'finished-still-recording',
    description:
      'Booth after reading reached the end and stopped itself while REAPER goes on recording (read-aloud-control-bar mock 10, Q8 Done B, D28/D39) - "Reading finished. REAPER is still recording", "Press Stop when you are done; nothing is cut off until you do.", Stop reading enabled and highlighted, and the toggle at "REC 14:08"',
    ...FREEZES_THE_CLOCK,
  },
  {
    page: 'booth',
    state: 'speaker-tags',
    description:
      "Booth on Chapter 3, the chapter prep-depth's recorded dialogue cues attribute (audit BO4, mock 03) - each attributed paragraph carries its speaker tag (ALICE) in a gutter left of the text, the unattributed ones leave it empty rather than guess; below `lg` the tag sits above its paragraph",
    ...REFLOW,
  },
  {
    page: 'booth',
    state: 'reaper-recording',
    description:
      "Booth with the control bar's read-only REAPER state showing REAPER already recording elsewhere, marked in the danger colour (Phase 6, ?mockReaperState=recording_elsewhere)",
  },
  {
    page: 'booth',
    state: 'flags',
    description:
      'Booth listening with suspected flags raised (teleprompter-manuscript-integration.prd.md Phase 7) - by default only skipped words (dotted underline) and restarts (dashed underline on the word read again from) show; misreads and extra words wait behind toggles (?mockTeleprompter=flagged)',
  },
  {
    page: 'booth',
    state: 'flag-open',
    description:
      'Booth after clicking a restart flag (Phase 7) - the rail switches to its Flags tab: what the script says and what was heard, Dismiss, "Punch from here" gated on the DAW port\'s punch capability (DAW port PRD Phase 7; wired to dawport.Puncher by booth-actions-enablement PRD Phase 3) - experimental and off by default, so shown disabled here - and the session’s flags',
  },
  {
    page: 'booth',
    state: 'flag-punch-confirm',
    description:
      'Booth after clicking "Punch from here" on an open restart flag with the punch capability turned on (booth-actions-enablement PRD Phase 3, ?mockPunchCapabilityOn=1) - a confirm dialog names the resolved time, its source and the pre-roll before anything moves in REAPER',
  },
  {
    page: 'booth',
    state: 'flags-all-kinds',
    description:
      'Booth with misreads and extra words turned on in the Flags tab (Phase 7) - a misread is a wavy underline, extra words heard are an insertion bar before the word they came before',
  },
  {
    page: 'booth',
    state: 'credits-opening',
    description:
      'Booth, "Opening credits" chosen (audiobook-credits-templates.prd.md Phase 4) - first in the picker, before the chapters; the credits the host rendered from the first opening template are the text below, every token filled (?mockCredits=filled), no warning',
  },
  {
    page: 'booth',
    state: 'credits-unresolved',
    description:
      'Booth, "Closing credits" chosen with no project credits values - a warning names the tokens with no value (Title, Author, Narrator) with "Fill them in Settings", the placeholders show in brackets in the text, and Play is still enabled (C6: warn, never block)',
  },
  {
    page: 'booth',
    state: 'model-download-progress',
    description: 'Booth, the Whisper model download after Play, with real bytes and Cancel (?mockAssets=downloading)',
  },
  {
    page: 'booth',
    state: 'moonshine-model-required',
    description:
      'Booth, Moonshine chosen as the engine and Play pressed with its model not installed - the first-use question names the engine, its size, publisher and licence, and nothing downloads until Download model (?mockAssets=missing)',
  },
  {
    page: 'booth',
    state: 'no-microphone-blocked',
    description:
      'Booth, device enumeration found nothing - "No microphone found" blocking message, no dropdown and no typed fallback, Play disabled (?mockNoDevices=1)',
  },
  {
    page: 'booth',
    state: 'exit-confirm',
    description:
      'Booth, Exit booth (or Escape) pressed while listening - the "Stop reading?" confirm the read-aloud dialog asked before closing, kept on the page: leaving stops the session, and the confirm says whether REAPER\'s recording stops too',
  },
  {
    page: 'booth',
    state: 'dark',
    description:
      'Booth (as setup) with Dark selected in Settings > Appearance - the Booth follows the app theme and forces neither light nor dark (D69, ADR 0365), so this differs from setup only in the palette',
  },
  {
    page: 'booth',
    state: 'companion-default',
    description:
      'Booth, Companion pressed in its header (booth-mode-and-companion-panel.prd.md Phase 7, stage navigation Q9): the same session in CompactShell, the whole window (the host narrows it to 380 px and pins it beside the DAW, ADR 0401; also captured at that companion width) - the Companion heading with REAPER\'s playhead badge ("Playhead stopped") and Full app, then the Script (chapter title, Play Kbd-labelled Space, Stop reading, the resume prompt and the text in its own scroll box), the reserved Note at playhead and Pickups sections ("Coming soon"), and the Hotkeys that work while this window has focus',
    ...COMPANION,
  },
  {
    page: 'booth',
    state: 'companion-listening',
    description:
      'Booth, the companion panel mid-session (same mock seam and word as listening) with REAPER playing (?mockDawPlayhead=134.6) - the header badge reads "Playhead 2:14.6", the Script shows Pause (Kbd Space), Stop reading and Follow, and the current word highlighted in its scroll box',
    ...COMPANION,
  },
  // The built-in recorder (native-recording-suite Phase 2, ADR 0455; D79: the Booth is the Record surface, no page of its own),
  // with the project on "Built-in recorder" (?mockEngine=builtin) and the mock recorder (D67) standing in for the microphone.
  {
    page: 'booth',
    state: 'recorder-builtin',
    description:
      'Booth recording with the built-in recorder (mock 03\'s Record area with the built-in recorder in REAPER\'s place) - the status line\'s Input meter and "— pk" readout and the "Built-in · 3 takes" chip; the setup\'s "Record with" (REAPER / Built-in recorder, Experimental), the Recorder input picker (the shared device picker, Q6), Check level and where the takes are saved; the command bar\'s Record where "Record in REAPER" was; the rail\'s Takes (mock 03\'s "Recorded 41:12 · …": "Recorded 01:55 · 3 takes", newest first, the unfinished partial marked)',
    ...REFLOW,
  },
  {
    page: 'booth',
    state: 'recorder-recording',
    description:
      'Booth, a built-in recorder take 42 s in (?mockRecorder=recording, the page clock held) - the status badge "REC · Built-in", the meter at mock 03\'s "−14.2 pk", the chip "Built-in · take 4" (the mock\'s "REAPER · take 4"), the command bar\'s Record now "REC 00:42" in the danger colour, "Record with" and Check level disabled while the take runs',
    ...REFLOW,
    ...FREEZES_THE_CLOCK,
  },
  {
    page: 'booth',
    state: 'recorder-level-check',
    description:
      'Booth, Check level pressed before a take - the recorder meters the chosen input with no file written: the setup\'s meter and the status line\'s at "−14.2 pk", the button now "Stop level check"',
  },
  {
    page: 'booth',
    state: 'recorder-take-failed',
    description:
      "Booth, the last take ended by itself (?mockRecorder=failed) - the rail's Takes says once, in the warning colour, that the input stopped delivering audio; the take and the audio before it are kept",
  },
  {
    page: 'booth',
    state: 'recorder-no-devices',
    description:
      'Booth, the built-in recorder with no input device listed (?mockRecorder=no-devices) - the shared picker\'s "No microphone found" with "Recording cannot start until a device is listed.", Record disabled, and "No takes yet. Record starts the first."',
  },
  {
    page: 'booth',
    state: 'recorder-start-refused',
    description:
      'Booth, Record pressed on an input another application holds (?mockRecorder=start-fails) - the refusal in a sentence under "Record with", nothing recording',
  },
  {
    page: 'booth',
    state: 'recorder-unavailable',
    description:
      'Booth on REAPER where the built-in recorder\'s capture row is not available (?mockRecorder=unavailable) - "Built-in recorder" disabled in "Record with" and the row\'s sentence beneath; the command bar keeps Record in REAPER',
  },
];
