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
  { page: 'home', state: 'info-tooltip', description: 'Home, info icon tooltip visible', pointer: 'keep' },
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
  { page: 'manuscript', state: 'selection-popup', description: 'Manuscript, text-selection action popup open' },
  {
    page: 'manuscript',
    state: 'overlapping-highlights',
    description: 'Manuscript, entity highlight overlapping a note',
    sameAs: { of: 'manuscript/reader-text-medium', reason: 'Medium is the default reader size and the overlap is visible in the default view.' },
  },
  { page: 'manuscript', state: 'sticky-header-scrolled', description: 'Manuscript, scrolled with sticky chapter header' },
  { page: 'manuscript', state: 'chapter-collapsed', description: 'Manuscript, a chapter card collapsed' },
  { page: 'manuscript', state: 'add-note-dialog', description: 'Manuscript, Add Note dialog open after selecting text' },
  { page: 'manuscript', state: 'formatted-text-and-line-breaks', description: 'Manuscript, paragraphs with preserved bold/italic/underline and a line break' },
  { page: 'manuscript', state: 'chapter-bookmarked', description: 'Manuscript, a chapter bookmarked (blue bookmark icon)' },
  { page: 'manuscript', state: 'go-to-line-highlight', description: 'Manuscript, arrived via Story Bible "Go to line" with the target line highlighted' },
  { page: 'manuscript', state: 'reader-dark', description: 'Manuscript, reader in the Dark theme (readable active controls, opaque sticky header)' },

  {
    page: 'manuscript',
    state: 'invalid-payload',
    description:
      'Manuscript, the inline error with Retry when the data it loads could not be read, beside the notice Home raised for the same data; navigation still works (ADR 0069, 0075)',
  },

  // Proofing
  { page: 'proofing', state: 'setup-default', description: 'Proofing, setup panel default selection' },
  { page: 'proofing', state: 'setup-alt-selection', description: 'Proofing, setup panel alternate model/worker/chunk selection' },
  { page: 'proofing', state: 'running', description: 'Proofing, running panel mid-progress with log' },
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
  },
  { page: 'proofing', state: 'toast', description: 'Proofing, a toast visible' },

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
  { page: 'storybible', state: 'category-needs-review', description: 'Story Bible, Needs Review category tab' },
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

  // Teleprompter
  {
    page: 'teleprompter',
    state: 'setup-default',
    description:
      'Teleprompter, before a session - chapter, microphone (picker of enumerated devices) and model choices with the chapter text below (no highlight yet)',
  },
  {
    page: 'teleprompter',
    state: 'model-download-progress',
    description: 'Teleprompter, the Whisper model download after Start reading, with real bytes and Cancel (?mockAssets=downloading)',
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
    description: 'Teleprompter, chapter finished - every word dimmed, no current word, "Done" status (reached via the ?mockTeleprompter=done mock seam)',
  },

  // Settings
  { page: 'settings', state: 'global-general', description: 'Settings, Global scope / General category', ...REFLOW },
  { page: 'settings', state: 'global-appearance', description: 'Settings, Global scope / Appearance category (theme switcher)', ...REFLOW },
  { page: 'settings', state: 'global-proofing', description: 'Settings, Global scope / Proofing category', ...REFLOW },
  { page: 'settings', state: 'global-storybible', description: 'Settings, Global scope / Story Bible category', ...REFLOW },
  { page: 'settings', state: 'global-daw', description: 'Settings, Global scope / DAW Integration category', ...REFLOW },
  { page: 'settings', state: 'global-manuscript', description: 'Settings, Global scope / Manuscript category (note color picker)', ...REFLOW },
  { page: 'settings', state: 'global-tts', description: 'Settings, Global scope / TTS category', ...REFLOW },
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
  { page: 'settings', state: 'project-proofing', description: 'Settings, Project scope / Proofing category', ...REFLOW },
  { page: 'settings', state: 'project-storybible', description: 'Settings, Project scope / Story Bible category', ...REFLOW },
  { page: 'settings', state: 'project-data', description: 'Settings, Project scope / Project data category (clear derived project data)', ...REFLOW },
  { page: 'settings', state: 'dirty-footer', description: 'Settings, unsaved-changes footer visible', ...REFLOW },
  { page: 'settings', state: 'navigate-away-confirm', description: 'Settings, navigate-away-while-dirty confirm dialog', ...REFLOW },
  {
    page: 'settings',
    state: 'reset-override',
    description: 'Settings, reset/clear-override control on a field',
    pointer: 'keep',
    ...REFLOW,
  },

  // Global overlays (captured once against Home, not per-page)
  {
    page: 'global',
    state: 'tooltip',
    description: 'Global tooltip overlay',
    pointer: 'keep',
    sameAs: { of: 'home/info-tooltip', reason: 'The global overlay is captured by hovering the same Home info icon.' },
  },
  {
    page: 'global',
    state: 'toast',
    description: 'Global toast overlay',
    sameAs: {
      of: 'proofing/toast',
      reason: 'The global overlay is captured by asking Proofing to suggest vocabulary hints, the same flow as the Proofing toast.',
    },
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
