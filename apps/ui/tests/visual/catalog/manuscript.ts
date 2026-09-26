// The `manuscript` rows of STATE_CATALOG (see state-catalog.ts), in the order they are captured.
import type { StateEntry } from '../lib/types';
import { REFLOW, KEEPS_DESKTOP_SCROLL, POPUP_ANCHORED_AT_FIRST_WIDTH } from './shared';

export const manuscriptStates: StateEntry[] = [
  // Manuscript
  { page: 'manuscript', state: 'reader-text-small', description: 'Manuscript, small text size' },
  { page: 'manuscript', state: 'reader-text-medium', description: 'Manuscript, medium text size' },
  { page: 'manuscript', state: 'reader-text-large', description: 'Manuscript, large text size' },
  { page: 'manuscript', state: 'chapters-overlay-open', description: 'Manuscript, chapters & search overlay open' },
  {
    page: 'manuscript',
    state: 'chapters-overlay-searching',
    description:
      'Manuscript, a query typed into Chapters & Search before the debounce settles - matching chapter titles show at once and a "Searching…" hint replaces "No matches" (R1, R2)',
  },
  {
    page: 'manuscript',
    state: 'chapters-overlay-search',
    description:
      'Manuscript, settled search results in Chapters & Search - a line hit reads "[icon] Line n: ...windowed text..." with the matched term highlighted (R3, R4)',
  },
  { page: 'manuscript', state: 'detail-sidebar-note', description: 'Manuscript, detail sidebar open on a note' },
  { page: 'manuscript', state: 'detail-sidebar-entity', description: 'Manuscript, detail sidebar open on an entity' },
  {
    page: 'manuscript',
    state: 'selection-popup',
    description: 'Manuscript, text-selection action popup open on one word: + Note, + Story Bible and Look up (Look up is offered for one word only)',
    ...POPUP_ANCHORED_AT_FIRST_WIDTH,
  },
  {
    page: 'manuscript',
    state: 'word-lookup-definition',
    description:
      'Manuscript, the Look up panel for "bank" - each part of speech with numbered definitions, examples and synonyms, and the CC BY 4.0 credit of the dictionary (ADR 0097)',
  },
  {
    page: 'manuscript',
    state: 'word-lookup-not-found',
    description: 'Manuscript, the Look up panel for a word the dictionary does not have ("Alice"), said plainly, with the credit',
  },
  {
    page: 'manuscript',
    state: 'word-lookup-not-installed',
    description:
      'Manuscript, Look up with the dictionary not installed - the first-use question with its size, where it is kept and its licence; nothing downloads until Download dictionary',
  },
  {
    page: 'manuscript',
    state: 'word-lookup-damaged',
    description: 'Manuscript, Look up with a dictionary whose index fails its check - asked as a repair (Download again), in plain language',
  },
  {
    page: 'manuscript',
    state: 'overlapping-highlights',
    description: 'Manuscript, entity highlight overlapping a note',
    sameAs: { of: 'manuscript/reader-text-medium', reason: 'Medium is the default reader size and the overlap is visible in the default view.' },
  },
  { page: 'manuscript', state: 'sticky-header-scrolled', description: 'Manuscript, scrolled with sticky chapter header', ...KEEPS_DESKTOP_SCROLL },
  { page: 'manuscript', state: 'chapter-collapsed', description: 'Manuscript, a chapter card collapsed' },
  {
    page: 'manuscript',
    state: 'chapter-header-columns',
    description:
      'Manuscript, mixed chapter rows (?mockManuscript=mixed): a Front Matter row with no Read aloud and 3-, 4- and 5-digit word counts - the stats and the buttons in two aligned columns, a chevron last (manuscript-chapter-header-alignment.prd.md, manuscript-credits-card-parity.prd.md)',
  },
  { page: 'manuscript', state: 'add-note-dialog', description: 'Manuscript, Add Note dialog open after selecting text' },
  { page: 'manuscript', state: 'formatted-text-and-line-breaks', description: 'Manuscript, paragraphs with preserved bold/italic/underline and a line break' },
  { page: 'manuscript', state: 'chapter-bookmarked', description: 'Manuscript, a chapter bookmarked (blue bookmark icon)' },
  { page: 'manuscript', state: 'go-to-line-highlight', description: 'Manuscript, arrived via Story Bible "Go to line" with the target line highlighted' },
  { page: 'manuscript', state: 'reader-dark', description: 'Manuscript, reader in the Dark theme (readable active controls, opaque sticky header)' },
  {
    page: 'manuscript',
    state: 'credits-entries',
    description:
      'Manuscript, the Opening credits pseudo-entry expanded before Chapter 1 with an unresolved-token chip (audiobook-credits-templates.prd.md Phase 3)',
  },
  {
    page: 'manuscript',
    state: 'credits-entries-fill-in',
    description:
      'Manuscript, the credits-setup banner above the Opening credits card and its own "Fill in" button beside the unresolved-token line (credits-token-setup-and-front-matter-detection.prd.md Phase 3, ?mockCredits=setup, mockups/credits-token-setup-and-front-matter-detection/03-manuscript-banner-and-fill-in.webp)',
  },
  {
    page: 'manuscript',
    state: 'retail-sample',
    description:
      'Manuscript, the retail sample picked on lines 1-3 of Chapter 3 (?mockCredits=extras, audiobook-credits-templates.prd.md Phase 5): a "Retail sample" tag on the chapter header, the sampled lines marked with a left rule, "Retail sample starts · about ..." above the first and "Retail sample ends" above the last',
  },

  {
    page: 'manuscript',
    state: 'invalid-payload',
    description:
      'Manuscript, the inline error with Retry when the data it loads could not be read, beside the notice Home raised for the same data; navigation still works (ADR 0069, 0075)',
  },
  {
    page: 'manuscript',
    state: 'read-aloud-setup',
    description:
      'Manuscript, the "Read aloud" full-size dialog opened from a chapter header - a non-scrolling control bar at the bottom (read-aloud-control-bar.prd.md Phase 3) with Play, Stop reading, status, the microphone and Settings popover buttons, no chapter picker (the chapter is fixed); above the text the resume prompt (read-aloud-resume-from-daw.prd.md Phase 1) offers where the recording ends as a compact choice: the matched track, "as of the project\'s last save", the matched sentence, and Resume from here / Start from the top / Pick a word',
    ...REFLOW,
  },
  {
    page: 'manuscript',
    state: 'read-aloud-resume-low-confidence',
    description:
      'Manuscript, the resume prompt when the end of the recording also fits elsewhere in the chapter (?mockResume=low_confidence) - offered as a guess to check, with its confidence and sentence; Resume from here is not the primary action',
  },
  {
    page: 'manuscript',
    state: 'read-aloud-resume-complete',
    description:
      'Manuscript, the resume prompt when the recording already reaches the chapter\'s last word - "This chapter is recorded to the end", no Resume from here, only Pick a word (fixes offering to resume past the end)',
  },
  {
    page: 'manuscript',
    state: 'read-aloud-resume-agree',
    description:
      "Manuscript, the resume prompt when REAPER's recording and the prompter's last reading agree (read-aloud-resume-from-daw.prd.md Phase 3, RD3/RD4, ?mockResume=agree) - a one-line notice presets Start reading to the DAW word without asking, with Change and Start from the top as links; the control bar's start-point chip shows the same preset with no click made",
    ...REFLOW,
  },
  {
    page: 'manuscript',
    state: 'read-aloud-resume-disagree',
    description:
      'Manuscript, the resume prompt when REAPER and the last reading are far apart (Phase 3, RD1, ?mockResume=disagree) - a compact two-way choice, REAPER and Last reading side by side with their own sentence and word number, plus Start from the top and Pick a word',
    ...REFLOW,
  },
  {
    page: 'manuscript',
    state: 'read-aloud-resume-prompter-only',
    description:
      'Manuscript, the resume prompt when only the prompter remembers a last reading - no track, no recording (Phase 3, RD8, ?mockResume=prompter_only) - one line, "Your last reading stopped at … Continue there?", never taken silently',
    ...REFLOW,
  },
  {
    page: 'manuscript',
    state: 'read-aloud-resume-not-found',
    description:
      "Manuscript, the resume prompt when the recording's tail did not match the chapter (?mockResume=not_found) - no resume word; says reading starts from the top, shows what was heard, offers Pick a word",
  },
  {
    page: 'manuscript',
    state: 'read-aloud-resume-no-track',
    description:
      'Manuscript, the resume prompt when no track in the REAPER project matches the chapter (?mockResume=none) - says reading starts from the top, with a "Link a track" link to the Tracks page instead of a picker in place (Chapter Track Link Control owns linking)',
  },
  {
    page: 'manuscript',
    state: 'read-aloud-resume-model-required',
    description:
      'Manuscript, the resume prompt when the Whisper model the lookup needs is not downloaded (?mockAssets=missing) - says so with a Download model button that opens the first-use confirm; nothing downloads by itself',
  },
  {
    page: 'manuscript',
    state: 'read-aloud-resume-error',
    description: 'Manuscript, the resume prompt when the lookup failed (?mockResume=error) - the reason as an alert, Try again, reading from the top meanwhile',
  },
  {
    page: 'manuscript',
    state: 'read-aloud-resume-after-choice',
    description:
      'Manuscript, the "Read aloud" dialog after "Resume from here" - the resume prompt is gone at once (no summary, no Change): the header slot above the text is empty',
  },
  {
    page: 'manuscript',
    state: 'read-aloud-resume-after-session',
    description:
      'Manuscript, the "Read aloud" dialog after a session has started and ended once - the resume prompt does not come back for the rest of this dialog\'s open, so the next Play begins at the top with nothing to clear',
  },
  {
    page: 'manuscript',
    state: 'read-aloud-listening',
    description:
      'Manuscript, the "Read aloud" dialog mid-session and listening - the control bar shows Listening, the word count, Stop reading and Follow (disabled, following), the current word highlighted and read words dimmed (reached via the ?mockTeleprompter=listening mock seam)',
  },
  {
    page: 'manuscript',
    state: 'read-aloud-following-paused',
    description:
      'Manuscript, the "Read aloud" dialog listening after the narrator scrolled the text by hand (teleprompter-engines-and-input-devices.prd.md Phase 10) - "Following paused" and an enabled Follow button beside Stop, the highlighted word scrolled out of view',
  },
  {
    page: 'manuscript',
    state: 'read-aloud-paused',
    description:
      'Manuscript, the "Read aloud" dialog after pressing Pause mid-session (read-aloud-control-bar.prd.md Phase 5, Q3, ADR 0248) - the control bar\'s toggle shows Play (not pressed), the status reads "Paused", and the session keeps its place rather than stopping',
    ...REFLOW,
  },
  {
    page: 'manuscript',
    state: 'read-aloud-seek-back',
    description:
      'Manuscript, the "Read aloud" dialog after clicking an earlier word ("Go back to here", teleprompter-manuscript-integration.prd.md Phase 4) - the highlight has jumped back to the clicked word without restarting the session',
  },
  {
    page: 'manuscript',
    state: 'read-aloud-story-bible-entry',
    description:
      'Manuscript, the "Read aloud" dialog listening, after clicking a Story Bible name in the text (teleprompter-manuscript-integration.prd.md Phase 5) - the rail switches to its Story bible tab with the entry, read-only; the highlight and the text stay where they were',
  },
  {
    page: 'manuscript',
    state: 'read-aloud-note-open',
    description:
      'Manuscript, the "Read aloud" dialog before a session, after clicking a note mark (Phase 5) - the rail switches to its Notes tab with that note current',
  },
  {
    page: 'manuscript',
    state: 'read-aloud-rail-hidden',
    description:
      'Manuscript, the "Read aloud" dialog with its reading panel hidden (Phase 5) - the text takes the width, a "Show reading panel" button stays at the side',
  },
  {
    page: 'manuscript',
    state: 'read-aloud-rail-full-height',
    description:
      'Manuscript, the "Read aloud" dialog with the resume card present and the reading panel open (read-aloud-control-bar.prd.md Phase 1) - the resume card shares the text column\'s left and right edges, and the panel spans the dialog body from its content top to its bottom',
    sameAs: {
      of: 'manuscript/read-aloud-setup',
      reason:
        'The rail is already open and the resume prompt already shown in read-aloud-setup, the same default state this row measures; the alignment and full-height checks run as bounding-box assertions in the driver, not from the screenshot.',
    },
  },
  {
    page: 'manuscript',
    state: 'read-aloud-mic-popover',
    description:
      'Manuscript, the "Read aloud" dialog with the control bar\'s microphone popover open (read-aloud-control-bar.prd.md Phases 3-4) - the device list, the selected device, Refresh, and a live input-level meter (a fixed -18 dBFS reading, ?mockLevel=-18, ADR 0247) both inside the popover and, decoratively, in the bar\'s own microphone button',
    ...REFLOW,
  },
  {
    page: 'manuscript',
    state: 'read-aloud-settings-popover',
    description:
      'Manuscript, the "Read aloud" dialog with the control bar\'s Settings popover open (read-aloud-control-bar.prd.md Phase 3) - Engine (when the host offers more than one) and Model as toggle groups, and a "More in Settings" link',
    ...REFLOW,
  },
  {
    page: 'manuscript',
    state: 'read-aloud-reaper-ready',
    description:
      'Manuscript, the "Read aloud" dialog with the control bar\'s read-only REAPER state showing the chapter\'s linked track armed and ready (read-aloud-control-bar.prd.md Phase 6, ADR 0249, ?mockReaperState=ready) - always disabled, since Phase 7\'s "Record in REAPER" toggle is not built',
    ...REFLOW,
  },
  {
    page: 'manuscript',
    state: 'read-aloud-reaper-not-armed',
    description:
      'Manuscript, the "Read aloud" dialog with the control bar\'s read-only REAPER state showing the chapter\'s linked track not armed (Phase 6, ?mockReaperState=not_armed)',
  },
  {
    page: 'manuscript',
    state: 'read-aloud-reaper-recording',
    description:
      'Manuscript, the "Read aloud" dialog with the control bar\'s read-only REAPER state showing REAPER already recording elsewhere, marked in the danger colour (Phase 6, ?mockReaperState=recording_elsewhere)',
  },
  {
    page: 'manuscript',
    state: 'read-aloud-flags',
    description:
      'Manuscript, the "Read aloud" dialog listening with suspected flags raised (teleprompter-manuscript-integration.prd.md Phase 7) - by default only skipped words (dotted underline) and restarts (dashed underline on the word read again from) show; misreads and extra words wait behind toggles (?mockTeleprompter=flagged)',
  },
  {
    page: 'manuscript',
    state: 'read-aloud-flag-open',
    description:
      'Manuscript, the "Read aloud" dialog after clicking a restart flag (Phase 7) - the rail switches to its Flags tab: what the script says and what was heard, Dismiss, the disabled "Punch from here" placeholder, and the session’s flags',
  },
  {
    page: 'manuscript',
    state: 'read-aloud-flags-all-kinds',
    description:
      'Manuscript, the "Read aloud" dialog with misreads and extra words turned on in the Flags tab (Phase 7) - a misread is a wavy underline, extra words heard are an insertion bar before the word they came before',
  },
  {
    page: 'manuscript',
    state: 'read-aloud-credits',
    description:
      'Manuscript, the "Read aloud" dialog opened from the Opening credits card\'s own Read aloud button (manuscript-credits-card-parity.prd.md Phase 2, ADR 0260) - titled "Read aloud: Opening credits" (chapter-title-display-consistency.prd.md Q4), every token filled (?mockCredits=filled), no resume prompt and no unresolved-token warning',
  },
  {
    page: 'manuscript',
    state: 'read-aloud-credits-unresolved',
    description:
      'Manuscript, the "Read aloud" dialog on the Opening credits with no project credits values set (Phase 2, MC2) - the C6 warning names the unresolved tokens with "Fill them in Settings" in the resume prompt\'s slot, Play still enabled',
  },
];
