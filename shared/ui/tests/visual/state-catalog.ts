import type { StateEntry } from './lib/types';

export type { StateEntry };

// Every {page, state} pair captured by app.spec.ts, at every size in
// viewports.ts. This is the single naming authority for
// screenshots/app/<page>/<state>/<viewport>.png. app.spec.ts supplies its
// own driver (how to reach the state) keyed by page+state - see
// APP_DRIVERS in app.spec.ts.
export const STATE_CATALOG: StateEntry[] = [
  // Project (pre-app: no project folder attached yet)
  {
    page: 'project',
    state: 'picker-empty',
    description: 'No project open yet - ProjectPicker with a recent-projects list, browse, and create actions',
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

  // Manuscript
  { page: 'manuscript', state: 'reader-text-small', description: 'Manuscript, small text size' },
  { page: 'manuscript', state: 'reader-text-medium', description: 'Manuscript, medium text size' },
  { page: 'manuscript', state: 'reader-text-large', description: 'Manuscript, large text size' },
  { page: 'manuscript', state: 'chapters-overlay-open', description: 'Manuscript, chapters & search overlay open' },
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
  { page: 'storybible', state: 'entry-needs-review', description: 'Story Bible, a Needs Review entry with review-colored evidence highlights' },

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
    description: 'Teleprompter, before a session - chapter, microphone and model choices with the chapter text below (no highlight yet)',
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
  { page: 'settings', state: 'global-general', description: 'Settings, Global scope / General category' },
  { page: 'settings', state: 'global-appearance', description: 'Settings, Global scope / Appearance category (theme switcher)' },
  { page: 'settings', state: 'global-proofing', description: 'Settings, Global scope / Proofing category' },
  { page: 'settings', state: 'global-storybible', description: 'Settings, Global scope / Story Bible category' },
  { page: 'settings', state: 'global-daw', description: 'Settings, Global scope / DAW Integration category' },
  { page: 'settings', state: 'global-manuscript', description: 'Settings, Global scope / Manuscript category (note color picker)' },
  { page: 'settings', state: 'global-tts', description: 'Settings, Global scope / TTS category' },
  { page: 'settings', state: 'project-proofing', description: 'Settings, Project scope / Proofing category' },
  { page: 'settings', state: 'project-storybible', description: 'Settings, Project scope / Story Bible category' },
  { page: 'settings', state: 'project-data', description: 'Settings, Project scope / Project data category (clear derived project data)' },
  { page: 'settings', state: 'dirty-footer', description: 'Settings, unsaved-changes footer visible' },
  { page: 'settings', state: 'navigate-away-confirm', description: 'Settings, navigate-away-while-dirty confirm dialog' },
  { page: 'settings', state: 'reset-override', description: 'Settings, reset/clear-override control on a field', pointer: 'keep' },

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
    sameAs: { of: 'proofing/toast', reason: 'The global overlay is captured by adding a vocabulary term, the same flow as the Proofing toast.' },
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
      "Primary navigation - hovering an enabled icon in the icon-only rail shows that page's name; at desktop and mobile widths there is no icon-only rail, so this is a no-op there",
    pointer: 'keep',
    sameAs: {
      of: 'home/default',
      reason: 'Only the icon-only rail shows tooltips; the full sidebar and mobile view have nothing to hover.',
      viewports: ['desktop', 'mobile'],
    },
  },
  {
    page: 'global',
    state: 'nav-drawer-open',
    description:
      'Primary navigation - the mobile slide-in drawer opened via the hamburger button; a no-op at desktop/small-desktop/tablet widths where the persistent nav rail is already visible',
    sameAs: {
      of: 'home/default',
      reason: 'Above the md breakpoint the nav rail is always visible, so there is no drawer to open.',
      viewports: ['desktop', 'small-desktop', 'tablet'],
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
