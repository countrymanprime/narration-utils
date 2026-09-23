import type { StateEntry } from './lib/types';
import { REFLOW_VIEWPORT } from './viewports';

export type { StateEntry };

// Every {page, state} pair captured by app.spec.ts, at every size in
// viewports.ts. This is the single naming authority for
// screenshots/app/<page>/<state>/<viewport>.png. app.spec.ts supplies its
// own driver (how to reach the state) keyed by page+state - see
// APP_DRIVERS in app.spec.ts.
// The Settings row stacks below `md`, so every Settings state is also captured at the reflow width (ADR 0061) and the
// collapsed-control check runs there.
const REFLOW = { extraViewports: [REFLOW_VIEWPORT] };

// `reloadPerViewport` (lib/types.ts), with the reason as the constant's name: these rows' pictures at a smaller width
// differ from a fresh load at that width when the suite drives the page once at desktop width and resizes (found by
// comparing every PNG when the suite moved to one load per state, ADR 0106). A tooltip closes when the window resizes; a
// scroll offset the driver set (a dialog body, a table, a tab strip) stays where the desktop layout put it; a popup keeps
// the place it opened at; live progress keeps running while the other viewports are captured. A driver that freezes the
// page clock cannot share a load at all (lib/capture.ts says why, and fails the row without this).
const TOOLTIP_CLOSES_ON_RESIZE = { reloadPerViewport: true } as const;
const KEEPS_DESKTOP_SCROLL = { reloadPerViewport: true } as const;
const POPUP_ANCHORED_AT_FIRST_WIDTH = { reloadPerViewport: true } as const;
const LIVE_PROGRESS_MOVES_ON = { reloadPerViewport: true } as const;
const FREEZES_THE_CLOCK = { reloadPerViewport: true } as const;

export const STATE_CATALOG: StateEntry[] = [
  // Project (pre-app: no project folder attached yet)
  {
    page: 'project',
    state: 'picker-empty',
    description: 'No project open yet - ProjectPicker with a recent-projects list, browse, and create actions',
  },

  // Startup (before the app has a Bootstrap)
  {
    page: 'startup',
    state: 'invalid-payload',
    description: 'Startup error for a Bootstrap that did not match its schema - plain message, technical details, Retry and Copy details (ADR 0069)',
  },

  // Home
  { page: 'home', state: 'default', description: 'Home, manuscript found' },
  { page: 'home', state: 'manuscript-not-found', description: 'Home, manuscript-not-found banner' },
  {
    page: 'home',
    state: 'chapter-table-collapsed',
    description: 'Home, chapter table collapsed',
    sameAs: { of: 'home/default', reason: 'The per-chapter table starts collapsed, so the default view already is this state.' },
  },
  { page: 'home', state: 'chapter-table-expanded', description: 'Home, chapter table expanded' },
  {
    page: 'home',
    state: 'hint-chips',
    description: 'Vocabulary hint chips widget (accepted + pending) - lives on Proofing, catalogued under "home" for historical reasons',
  },
  { page: 'home', state: 'info-tooltip', description: 'Home, info icon tooltip visible', pointer: 'keep', ...TOOLTIP_CLOSES_ON_RESIZE },
  { page: 'home', state: 'manuscript-candidate-offer', description: 'Home, offer to import a manuscript file found in the project folder' },
  { page: 'home', state: 'import-activity-log', description: 'Home, manuscript import finished with its live activity log populated' },
  {
    page: 'home',
    state: 'import-confirm',
    description:
      'Home, import manuscript confirm dialog with format/paragraph/chapter preview (reached via "Replace manuscript" since a manuscript is already loaded)',
  },
  {
    page: 'home',
    state: 'import-confirm-markdown',
    description: 'Home, import review dialog for a Markdown file: the same review plus the chapter heading level choice in an options group',
  },
  {
    page: 'home',
    state: 'import-review-collapsed',
    description: 'Home, import review with every group folded: the summary and one line per group say what was found',
  },
  {
    page: 'home',
    state: 'import-review-characters',
    description: 'Home, import review with the character suggestions open and one unchecked: the summary and the group count both say 2 of 3',
    ...KEEPS_DESKTOP_SCROLL,
  },
  {
    page: 'home',
    state: 'import-review-repaired',
    description: 'Home, import review of a Word file whose headings the importer repaired: the repairs are listed as a group',
  },

  {
    page: 'home',
    state: 'live-updates-degraded',
    description: 'Home, the notice that live updates from the desktop host could not be read and the page may be out of date (ADR 0069)',
  },
  {
    page: 'home',
    state: 'daw-not-linked',
    description:
      'Home with no linked REAPER project file (?mockNoDaw=1, PRD project-workspace-and-daw-link.prd.md W13-W16): the header pill reads "No REAPER project linked" and the Proofing nav item is locked',
  },

  // The recording check (recording-coverage-analysis.prd.md Phase 6), from a row of the per-chapter breakdown. The mock's chapters 1-3 have a
  // current check with every word, 4-6 a current check with a third of the text missing, the rest were never checked.
  {
    page: 'home',
    state: 'recording-check-never',
    description: 'Home, recording check dialog for a chapter never checked: the saved-project basis, what a check does, and Check recording',
  },
  {
    page: 'home',
    state: 'recording-check-running',
    description:
      'Home, a recording check running (?mockCoverage=hold): the work dialog with the real percent from the host, its activity log, Cancel and Continue in background',
    ...LIVE_PROGRESS_MOVES_ON,
  },
  {
    page: 'home',
    state: 'recording-check-complete',
    description: 'Home, recording check result for a chapter read in full: all the text is recorded, the paragraph list folded',
  },
  {
    page: 'home',
    state: 'recording-check-incomplete',
    description:
      'Home, recording check result with text missing: the count, the missing region with its paragraphs, first and last words and audio position, and every paragraph',
  },
  {
    page: 'home',
    state: 'recording-check-stale',
    description: 'Home, a stored recording check that is out of date (?mockCoverage=stale): the plain-language reason and the old counts labelled as from then',
  },
  {
    page: 'home',
    state: 'recording-check-refused',
    description:
      'Home, a recording check refused because the chapter has no confirmed track (?mockCoverageRefusal=unmapped): the reason in plain words and the track link in place',
  },
  {
    page: 'home',
    state: 'recording-check-model-required',
    description: 'Home, a recording check that needs the Whisper model first (?mockAssets=missing): the first-use download question, never a silent download',
  },
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
  { page: 'manuscript', state: 'selection-popup', description: 'Manuscript, text-selection action popup open', ...POPUP_ANCHORED_AT_FIRST_WIDTH },
  {
    page: 'manuscript',
    state: 'overlapping-highlights',
    description: 'Manuscript, entity highlight overlapping a note',
    sameAs: { of: 'manuscript/reader-text-medium', reason: 'Medium is the default reader size and the overlap is visible in the default view.' },
  },
  { page: 'manuscript', state: 'sticky-header-scrolled', description: 'Manuscript, scrolled with sticky chapter header', ...KEEPS_DESKTOP_SCROLL },
  { page: 'manuscript', state: 'chapter-collapsed', description: 'Manuscript, a chapter card collapsed' },
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
    state: 'invalid-payload',
    description:
      'Manuscript, the inline error with Retry when the data it loads could not be read, beside the notice Home raised for the same data; navigation still works (ADR 0069, 0075)',
  },
  {
    page: 'manuscript',
    state: 'read-aloud-setup',
    description:
      'Manuscript, the "Read aloud" full-size dialog (teleprompter-manuscript-integration.prd.md Phase 2) opened from a chapter header - Microphone, Engine and Model fields, no chapter picker (the chapter is fixed)',
  },
  {
    page: 'manuscript',
    state: 'read-aloud-listening',
    description:
      'Manuscript, the "Read aloud" dialog mid-session and listening - the setup fields collapse to a status bar with Stop, the current word highlighted and read words dimmed (reached via the ?mockTeleprompter=listening mock seam)',
  },
  {
    page: 'manuscript',
    state: 'read-aloud-seek-back',
    description:
      'Manuscript, the "Read aloud" dialog after clicking an earlier word ("Go back to here", teleprompter-manuscript-integration.prd.md Phase 4) - the highlight has jumped back to the clicked word without restarting the session',
  },

  // Proofing
  { page: 'proofing', state: 'setup-default', description: 'Proofing, setup panel default selection' },
  { page: 'proofing', state: 'setup-alt-selection', description: 'Proofing, setup panel alternate model/worker/chunk selection' },
  { page: 'proofing', state: 'running', description: 'Proofing, running panel mid-progress with log', ...LIVE_PROGRESS_MOVES_ON },
  { page: 'proofing', state: 'results-row-expanded', description: 'Proofing, results table with one discrepancy row expanded' },
  {
    page: 'proofing',
    state: 'results-extra-row-expanded',
    description: 'Proofing, results table with an EXTRA (words heard but not written) discrepancy row expanded',
  },
  {
    page: 'proofing',
    state: 'disabled-button',
    description: 'Home with no manuscript - the Proofing action is locked and its tooltip says why',
    pointer: 'keep',
    ...TOOLTIP_CLOSES_ON_RESIZE,
  },
  { page: 'proofing', state: 'toast', description: 'Proofing, a toast visible', ...FREEZES_THE_CLOCK },
  {
    page: 'proofing',
    state: 'no-daw',
    description: 'Proofing setup with no linked REAPER project file (?mockNoDaw=1, PRD W16): Start comparison is disabled',
  },
  {
    page: 'proofing',
    state: 'no-daw-review',
    description:
      'Proofing reviewing the last completed comparison with no linked REAPER project file (?mockNoDaw=1, PRD W16): offline review stays reachable, but every Play recorded audio button and the marker Export button are disabled',
  },

  // Story Bible
  {
    page: 'storybible',
    state: 'rebuild-running',
    description:
      'Story Bible, a rebuild still running: its dialog says the step cannot be cancelled but can go on in the background (ADR 0076, ?mockRebuildRunning=1)',
  },
  {
    page: 'storybible',
    state: 'entry-saving',
    description: 'Story Bible, an entry being saved: the Save button is busy and the other actions are off (ADR 0075, ?mockHoldEdits=1)',
  },
  {
    page: 'storybible',
    state: 'language-model-confirm',
    description:
      'Story Bible, the first-use question before the language model is downloaded: what it is, its sizes and where it goes, with Download, Build with rules-only and Cancel (?mockAssets=missing)',
  },
  {
    page: 'storybible',
    state: 'language-model-progress',
    description: 'Story Bible, the language model download with real bytes, 39 percent and Cancel (?mockAssets=downloading)',
  },
  {
    page: 'storybible',
    state: 'voice-download-confirm',
    description: 'Story Bible, the first-use question before the local preview voice is downloaded: what it is, its size, publisher and licence',
  },
  {
    page: 'storybible',
    state: 'voice-download-progress',
    description: 'Story Bible, the voice download with real bytes, 39 percent and Cancel (?mockAssets=downloading)',
  },
  {
    page: 'storybible',
    state: 'voice-download-failed',
    description: 'Story Bible, the voice download after it failed: the reason as an alert and Close (?mockAssets=download-fails)',
  },
  { page: 'storybible', state: 'category-all', description: 'Story Bible, All category tab' },
  { page: 'storybible', state: 'category-character', description: 'Story Bible, Character category tab' },
  { page: 'storybible', state: 'category-place', description: 'Story Bible, Place/Location category tab' },
  { page: 'storybible', state: 'category-organization', description: 'Story Bible, Organization category tab' },
  { page: 'storybible', state: 'category-needs-review', description: 'Story Bible, Needs Review category tab', ...KEEPS_DESKTOP_SCROLL },
  {
    page: 'storybible',
    state: 'entity-selected',
    description: 'Story Bible, an entity selected (detail panel open)',
    sameAs: { of: 'storybible/category-all', reason: 'Story Bible opens on All with the first entity already selected.' },
  },
  { page: 'storybible', state: 'alias-typeahead', description: 'Story Bible, alias-typeahead dropdown open' },
  { page: 'storybible', state: 'delete-confirm', description: 'Story Bible, delete confirm dialog open' },
  { page: 'storybible', state: 'entry-locked', description: 'Story Bible, a locked entry' },
  {
    page: 'storybible',
    state: 'entry-unlocked',
    description: 'Story Bible, an unlocked entry (read-only until Edit)',
    sameAs: { of: 'storybible/entity-selected', reason: 'The fixture entity a fresh selection lands on is unlocked, so selecting it is this state.' },
  },
  { page: 'storybible', state: 'entry-editing', description: 'Story Bible, an unlocked entry in edit mode (Save and Cancel shown)' },
  {
    page: 'storybible',
    state: 'entry-properties-editing',
    description: 'Story Bible, an entry in edit mode with its properties table: a new row with a value and no name, and the message that says so',
    ...KEEPS_DESKTOP_SCROLL,
  },
  { page: 'storybible', state: 'entry-needs-review', description: 'Story Bible, a Needs Review entry with review-colored evidence highlights' },
  {
    page: 'storybible',
    state: 'entry-pronunciation-missing',
    description: 'Story Bible, an entry with no pronunciation in edit mode: Play disabled with a reason, and Generate offered',
  },

  {
    page: 'storybible',
    state: 'invalid-payload',
    description: 'Story Bible, the inline error with Retry when the entities could not be read; navigation still works (ADR 0069)',
  },

  // Tracks
  {
    page: 'tracks',
    state: 'default',
    description: 'Tracks, a single .rpp auto-selected - first track active with transport controls, other tracks flagged for missing/unsupported items',
  },
  {
    page: 'tracks',
    state: 'unplayable-track-selected',
    description: 'Tracks, a track whose source file is missing selected - "no playable audio" message with disabled transport',
  },
  {
    page: 'tracks',
    state: 'rpp-picker',
    description: 'Tracks, more than one .rpp file found - choose-a-project-file prompt (reached via the ?mockMultipleRpp=1 mock seam)',
  },
  {
    page: 'tracks',
    state: 'no-rpp',
    description: 'Tracks, no .rpp file in the project folder - "No REAPER project file found" empty state (reached via the ?mockNoRpp=1 mock seam)',
  },
  {
    page: 'tracks',
    state: 'no-daw-link',
    description:
      'Tracks with no linked REAPER project file (?mockNoDaw=1, PRD W19): the page’s own DAW-link control reads "Link a REAPER project file" instead of "Link a different REAPER project file" - Tracks itself stays usable since it reads its .rpp through its own discovery flow',
  },
  {
    page: 'tracks',
    state: 'playing',
    description: 'Tracks, Play pressed - the button becomes Pause and the position/duration readout is live',
  },
  {
    page: 'tracks',
    state: 'skipped-forward',
    description: 'Tracks, playing then "skip forward 30 seconds" pressed - the readout jumps to about 0:30',
  },
  {
    page: 'tracks',
    state: 'last-track-selected',
    description: 'Tracks, the last track (muted, MIDI-only) selected - Muted badge shown and Next track disabled',
  },
  {
    page: 'tracks',
    state: 'chapter-link-confirmed',
    description:
      'Tracks, the Chapter links list at the foot of the page - the first chapter confirmed to a track shows Linked with the track name, Change and Clear (analysis evidence ledger PRD, Phase 7)',
    ...KEEPS_DESKTOP_SCROLL,
  },
  {
    page: 'tracks',
    state: 'chapter-link-missing',
    description:
      'Tracks, a chapter confirmed to a track GUID no longer in the project - Track missing, with the missing-track message and Change/Clear (reached via the ?mockChapterLink=missing mock seam)',
    ...KEEPS_DESKTOP_SCROLL,
  },
  {
    page: 'tracks',
    state: 'link-chapters-preview',
    description: 'Tracks, "Link chapters" dialog open with one chapter mapped to a track - preview of the items that will be stamped, nothing written yet',
  },
  {
    page: 'tracks',
    state: 'link-chapters-success',
    description: 'Tracks, "Link chapters" dialog after a completed Read - every row status shown at once (ok, drift, stale-source, removed, unrecognized)',
    ...KEEPS_DESKTOP_SCROLL,
  },
  {
    page: 'tracks',
    state: 'link-chapters-conflict',
    description: 'Tracks, "Link chapters" dialog after a Stamp that hit a stale item and a conflict - both GUID lists shown',
    ...KEEPS_DESKTOP_SCROLL,
  },
  {
    page: 'tracks',
    state: 'link-chapters-error',
    description: 'Tracks, "Link chapters" dialog when REAPER reports a problem - inline error message, nothing written',
    ...KEEPS_DESKTOP_SCROLL,
  },
  {
    page: 'tracks',
    state: 'pickups-empty',
    description: 'Tracks, "Pickups" dialog open before any import - "No pickups yet", Next disabled, Export disabled',
    ...KEEPS_DESKTOP_SCROLL,
  },
  {
    page: 'tracks',
    state: 'pickups-imported',
    description: 'Tracks, "Pickups" dialog after a completed CSV import - remaining count and the import summary shown',
  },
  {
    page: 'tracks',
    state: 'pickups-import-errors',
    description: 'Tracks, "Pickups" dialog after importing a CSV with an unusable row - the row error listed, the usable row still counted',
  },
  {
    page: 'tracks',
    state: 'pickups-next',
    description: 'Tracks, "Pickups" dialog after "Next pickup" - the pickup\'s tag and note shown with "Mark this pickup done"',
  },
  {
    page: 'tracks',
    state: 'pickups-error',
    description: 'Tracks, "Pickups" dialog when REAPER reports a problem - inline error message (reached via the ?mockPickups=error mock seam)',
  },
  {
    page: 'tracks',
    state: 'render-config-prefilled',
    description: 'Tracks, "Prepare chapter render" dialog open before any configure - the suggested output folder prefilled, Configure render enabled',
  },
  {
    page: 'tracks',
    state: 'render-config-success',
    description:
      'Tracks, "Prepare chapter render" dialog after a completed configure - the resulting chapter file names and the "press Render in REAPER" instruction shown',
  },
  {
    page: 'tracks',
    state: 'render-config-no-regions',
    description: 'Tracks, "Prepare chapter render" dialog after a configure with no chapter regions yet - 0 files, "create them before rendering"',
  },
  {
    page: 'tracks',
    state: 'render-config-error',
    description:
      'Tracks, "Prepare chapter render" dialog when REAPER reports a problem - inline error message, nothing rendered (reached via the ?mockRenderConfig=error mock seam)',
  },
  {
    page: 'tracks',
    state: 'chapter-tags-idle',
    description: 'Tracks, "Embed chapter tags" dialog open before any chapter render is configured - "Prepare chapter render first" message, Embed disabled',
    ...KEEPS_DESKTOP_SCROLL,
  },
  {
    page: 'tracks',
    state: 'chapter-tags-ready',
    description:
      'Tracks, "Embed chapter tags" dialog with two rendered chapters known - the chapter list, destination field and confirm checkbox, Embed enabled once both are filled in (reached via the ?mockChapterTags=ready mock seam)',
    ...KEEPS_DESKTOP_SCROLL,
  },
  {
    page: 'tracks',
    state: 'chapter-tags-not-rendered',
    description:
      'Tracks, "Embed chapter tags" dialog with a chapter configured but not yet rendered - "not rendered yet" and the press-Render-first message, Embed disabled (reached via the ?mockChapterTags=not-rendered mock seam)',
    ...KEEPS_DESKTOP_SCROLL,
  },
  {
    page: 'tracks',
    state: 'chapter-tags-success',
    description: 'Tracks, "Embed chapter tags" dialog after a completed embed - the new tagged file\'s path shown, the original file unmentioned as changed',
    ...KEEPS_DESKTOP_SCROLL,
  },
  {
    page: 'tracks',
    state: 'chapter-tags-error',
    description:
      'Tracks, "Embed chapter tags" dialog when the embed fails - inline error message (reached via the ?mockChapterTags=ready&mockChapterTagsEmbedError=1 mock seam)',
    ...KEEPS_DESKTOP_SCROLL,
  },
  {
    page: 'tracks',
    state: 'take-review-results',
    description:
      'Tracks, Scan for pickups & duplicates pressed on Chapter 1 - a pickup and a duplicate_read row, per-category evidence only (Q9, no composite score column)',
  },
  {
    page: 'tracks',
    state: 'take-review-empty',
    description: 'Tracks, a pickup/duplicate scan on a track with no repeats - "No repeated reads found on this track." with no results table',
  },
  {
    page: 'tracks',
    state: 'take-review-audition',
    description:
      'Tracks, Audition pressed on a pickup finding - the side-by-side A/B dialog with the "Raw source, no FX or edits applied" label and Read A/Read B pickers (phase 7, Q7)',
    ...KEEPS_DESKTOP_SCROLL,
  },

  // Teleprompter
  {
    page: 'teleprompter',
    state: 'setup-default',
    description:
      'Teleprompter, before a session - chapter, microphone (picker of enumerated devices), engine (Whisper or Moonshine, as a Windows host offers) and model choices with the chapter text below (no highlight yet)',
  },
  {
    page: 'teleprompter',
    state: 'model-download-progress',
    description: 'Teleprompter, the Whisper model download after Start reading, with real bytes and Cancel (?mockAssets=downloading)',
  },
  {
    page: 'teleprompter',
    state: 'moonshine-model-required',
    description:
      'Teleprompter, Moonshine chosen as the engine and Start reading pressed with its model not installed - the first-use question names the engine, its size, publisher and licence, and nothing downloads until Download model (?mockAssets=missing)',
  },
  {
    page: 'teleprompter',
    state: 'no-microphone-blocked',
    description:
      'Teleprompter, device enumeration found nothing - "No microphone found" blocking message, no dropdown and no typed fallback, Start reading disabled (?mockNoDevices=1)',
  },
  {
    page: 'teleprompter',
    state: 'listening',
    description:
      'Teleprompter, mid-session and listening - the setup fields collapse to a status bar with Stop, the current word has the solid accent highlight and read words are dimmed (reached via the ?mockTeleprompter=listening mock seam)',
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
      'Teleprompter, the session stopped itself at the end of the chapter (the host auto-stop, ADR 0106) - "Stopped at the end of the chapter." with Start reading offered again and the chapter still dimmed (reached via the ?mockTeleprompter=ended mock seam)',
  },

  // Settings
  { page: 'settings', state: 'global-general', description: 'Settings, Global scope / General category', ...REFLOW },
  { page: 'settings', state: 'global-appearance', description: 'Settings, Global scope / Appearance category (theme switcher)', ...REFLOW },
  {
    page: 'settings',
    state: 'global-recording-check',
    description:
      'Settings, Global scope / Recording check category (recording-coverage PRD Phase 7): the four number settings at their Proposed defaults (0.95, 3, 8, 3 words), under a summary that labels them uncalibrated and states the rule they make',
    ...REFLOW,
  },
  { page: 'settings', state: 'global-proofing', description: 'Settings, Global scope / Proofing category', ...REFLOW },
  { page: 'settings', state: 'global-storybible', description: 'Settings, Global scope / Story Bible category', ...REFLOW },
  {
    page: 'settings',
    state: 'global-delivery',
    description:
      'Settings, Global scope / Delivery category (diagnostics PRD Phase 2): the narrator’s own measurement limits as number boxes with units and ranges, none set, so the summary says "No limits set" (no distributor numbers ship, ADR 0025)',
    ...REFLOW,
  },
  {
    page: 'settings',
    state: 'global-delivery-invalid',
    description:
      'Settings, Global scope / Delivery with two unsaved limits typed: a valid true peak and an out-of-range sample peak whose row names the range instead of the hint',
    ...REFLOW,
  },
  {
    page: 'settings',
    state: 'global-daw',
    description:
      'Settings, Global scope / DAW Integration category, with the DAW catalog panel showing REAPER detected and a REAPER project already linked, so only the "Check again" action shows (docs/architecture/daw-integration.md)',
    ...REFLOW,
  },
  {
    page: 'settings',
    state: 'global-daw-not-detected',
    description:
      'Settings, Global scope / DAW Integration category with REAPER not detected (?mockDawNotDetected=1, docs/architecture/daw-integration.md): the not-detected dot and the "Get REAPER" button that opens the vendor\'s download page',
    ...REFLOW,
  },
  {
    page: 'settings',
    state: 'global-daw-handoff',
    description:
      'Settings, Global scope / DAW Integration category with REAPER detected but no REAPER project linked yet (?mockNoDaw=1, docs/architecture/daw-integration.md): the "Link a REAPER project file" handoff button next to the detected entry, and the "Check again" action below it',
    ...REFLOW,
  },
  { page: 'settings', state: 'global-manuscript', description: 'Settings, Global scope / Manuscript category (note color picker)', ...REFLOW },
  { page: 'settings', state: 'global-tts', description: 'Settings, Global scope / TTS category', ...REFLOW },
  {
    page: 'settings',
    state: 'global-teleprompter',
    description: 'Settings, Global scope / Teleprompter category (microphone, live engine and model choice)',
    ...REFLOW,
  },
  { page: 'settings', state: 'global-about', description: 'Settings, Global scope / About and updates category (the version, nothing checked yet)', ...REFLOW },
  {
    page: 'settings',
    state: 'about-update-available',
    description: 'Settings, About and updates with a newer release found (the mock seam ?mockUpdate=available)',
    ...REFLOW,
  },
  {
    page: 'settings',
    state: 'about-check-failed',
    description: 'Settings, About and updates after a check that could not reach GitHub (?mockUpdate=failed)',
    ...REFLOW,
  },
  {
    page: 'settings',
    state: 'about-download-confirm',
    description: 'Settings, About and updates: the confirm before an update is downloaded (?mockUpdate=available)',
    ...REFLOW,
  },
  {
    page: 'settings',
    state: 'about-download-progress',
    description: 'Settings, About and updates: the update download dialog with real bytes, 40 percent and Cancel (?mockUpdate=downloading)',
    ...REFLOW,
  },
  {
    page: 'settings',
    state: 'about-download-failed',
    description: 'Settings, About and updates: the update download dialog after the checksum check failed (?mockUpdate=download-fails)',
    ...REFLOW,
  },
  {
    page: 'settings',
    state: 'about-update-ready',
    description: 'Settings, About and updates with the update downloaded and checked, ready to install (?mockUpdate=ready)',
    ...REFLOW,
  },
  {
    page: 'settings',
    state: 'about-install-confirm',
    description: 'Settings, About and updates: the confirm before the app replaces itself and restarts (?mockUpdate=ready)',
    ...REFLOW,
  },
  {
    page: 'settings',
    state: 'about-installing',
    description:
      'Settings, About and updates: the blocking dialog while the app installs the update and restarts, with the cannot-be-cancelled notice (?mockUpdate=ready)',
    ...REFLOW,
  },
  {
    page: 'settings',
    state: 'about-install-refused',
    description: 'Settings, About and updates after an install was refused because work is running (?mockUpdate=install-refused)',
    ...REFLOW,
  },
  {
    page: 'settings',
    state: 'about-install-blocked',
    description:
      'Settings, About and updates where the app may not replace itself: why, and Show the downloaded file (?mockUpdate=install-blocked, after a download)',
    ...REFLOW,
  },
  {
    page: 'settings',
    state: 'about-development-build',
    description: 'Settings, About and updates in a development build, which has no release to compare with (?mockUpdate=development)',
    ...REFLOW,
  },
  {
    page: 'settings',
    state: 'local-assets',
    description:
      'Settings, Global scope / Local assets category: every voice and model with its sizes, licence and state, the folder and the total on disk (the voice is not installed, the others are)',
    ...REFLOW,
  },
  {
    page: 'settings',
    state: 'local-assets-downloading',
    description:
      'Settings, Local assets with a download that was already running when the page opened, followed through activeJobId: real bytes, 39 percent and Cancel (?mockAssets=installing)',
    ...REFLOW,
  },
  {
    page: 'settings',
    state: 'local-assets-verifying',
    description: 'Settings, Local assets with a download at its check: a busy button, no Cancel (?mockAssets=checking)',
    ...REFLOW,
  },
  {
    page: 'settings',
    state: 'local-assets-needs-repair',
    description: 'Settings, Local assets with a model that failed its verification: Needs repair, with Repair and Remove (?mockAssets=damaged)',
    ...REFLOW,
  },
  {
    page: 'settings',
    state: 'local-assets-failed',
    description: 'Settings, Local assets after a download failed: the reason is written in the row and Download stays (?mockAssets=download-fails)',
    ...REFLOW,
  },
  {
    page: 'settings',
    state: 'local-assets-remove-confirm',
    description: 'Settings, Local assets: the danger confirm before a model is removed, with what it frees and what asks again',
    ...REFLOW,
  },
  {
    page: 'settings',
    state: 'project-recording-check',
    description:
      'Settings, Project scope / Recording check category: every setting unset in the project and inheriting its default, with the note that a blank project value uses the Global one',
    ...REFLOW,
  },
  { page: 'settings', state: 'project-proofing', description: 'Settings, Project scope / Proofing category', ...REFLOW },
  { page: 'settings', state: 'project-storybible', description: 'Settings, Project scope / Story Bible category', ...REFLOW },
  {
    page: 'settings',
    state: 'project-delivery',
    description:
      'Settings, Project scope / Delivery category: every limit unset here and in Global, with the note that a blank project limit uses the Global one',
    ...REFLOW,
  },
  {
    page: 'settings',
    state: 'project-daw',
    description:
      'Settings, Project scope / DAW Integration category (PRD project-workspace-and-daw-link.prd.md W19, new: previously global-only): "REAPER project linked" and Change linked project file',
    ...REFLOW,
  },
  {
    page: 'settings',
    state: 'project-daw-not-linked',
    description:
      'Settings, Project scope / DAW Integration category with no linked REAPER project file (?mockNoDaw=1): "No REAPER project linked" and Link a REAPER project file',
    ...REFLOW,
  },
  { page: 'settings', state: 'project-data', description: 'Settings, Project scope / Project data category (clear derived project data)', ...REFLOW },
  {
    page: 'settings',
    state: 'project-credits',
    description:
      'Settings, Project scope / Credits category (PRD audiobook-credits-templates.prd.md, Phase 1): template library, live preview and project credit values',
    ...REFLOW,
  },
  { page: 'settings', state: 'dirty-footer', description: 'Settings, unsaved-changes footer visible', ...REFLOW, ...KEEPS_DESKTOP_SCROLL },
  { page: 'settings', state: 'navigate-away-confirm', description: 'Settings, navigate-away-while-dirty confirm dialog', ...REFLOW },
  {
    page: 'settings',
    state: 'reset-override',
    description: 'Settings, reset/clear-override control on a field',
    pointer: 'keep',
    ...REFLOW,
    ...KEEPS_DESKTOP_SCROLL,
  },

  // Global overlays (captured once against Home, not per-page)
  {
    page: 'global',
    state: 'tooltip',
    description: 'Global tooltip overlay',
    pointer: 'keep',
    sameAs: { of: 'home/info-tooltip', reason: 'The global overlay is captured by hovering the same Home info icon.' },
    ...TOOLTIP_CLOSES_ON_RESIZE,
  },
  {
    page: 'global',
    state: 'toast',
    description: 'Global toast overlay',
    sameAs: {
      of: 'proofing/toast',
      reason: 'The global overlay is captured by asking Proofing to suggest vocabulary hints, the same flow as the Proofing toast.',
    },
    ...FREEZES_THE_CLOCK,
  },
  {
    page: 'global',
    state: 'confirm-dialog',
    description: 'Global confirm dialog overlay',
    sameAs: { of: 'storybible/delete-confirm', reason: 'The global overlay is captured by opening the same delete-entity confirm dialog.' },
  },
  {
    page: 'global',
    state: 'nav-rail-tooltip',
    description:
      "Primary navigation - hovering an enabled icon in the icon-only rail shows that page's name; at desktop width there is no icon-only rail, so this is a no-op there",
    pointer: 'keep',
    sameAs: {
      of: 'home/default',
      reason: 'Only the icon-only rail shows tooltips; the full sidebar has nothing to hover.',
      viewports: ['desktop'],
    },
    ...TOOLTIP_CLOSES_ON_RESIZE,
  },

  // Theme smoke check (Home only, not the full page/state matrix - see
  // ADR 0010) - explicit Light/Dark selected via Settings > Appearance,
  // captured on Home across every viewport.
  {
    page: 'global',
    state: 'theme-light',
    description: 'Home with Light explicitly selected in Settings > Appearance',
    sameAs: { of: 'home/default', reason: 'Light is what Home already renders in by default, so explicitly selecting it changes nothing visible.' },
  },
  { page: 'global', state: 'theme-dark', description: 'Home with Dark explicitly selected in Settings > Appearance' },
];
