export interface StateEntry {
  page: string;
  state: string;
  description: string;
}

// Every {page, state} pair captured by app.spec.ts, at every size in
// viewports.ts. This is the single naming authority for
// screenshots/app/<page>/<state>/<viewport>.png. app.spec.ts supplies its
// own driver (how to reach the state) keyed by page+state - see
// APP_DRIVERS in app.spec.ts.
export const STATE_CATALOG: StateEntry[] = [
  // Home
  { page: 'home', state: 'default', description: 'Home, manuscript found' },
  { page: 'home', state: 'manuscript-not-found', description: 'Home, manuscript-not-found banner' },
  { page: 'home', state: 'chapter-table-collapsed', description: 'Home, chapter table collapsed' },
  { page: 'home', state: 'chapter-table-expanded', description: 'Home, chapter table expanded' },
  {
    page: 'home',
    state: 'hint-chips',
    description: 'Vocabulary hint chips widget (accepted + pending) - lives on Proofing, catalogued under "home" for historical reasons',
  },
  { page: 'home', state: 'info-tooltip', description: 'Home, info icon tooltip visible' },

  // Manuscript
  { page: 'manuscript', state: 'reader-text-small', description: 'Manuscript, small text size' },
  { page: 'manuscript', state: 'reader-text-medium', description: 'Manuscript, medium text size' },
  { page: 'manuscript', state: 'reader-text-large', description: 'Manuscript, large text size' },
  { page: 'manuscript', state: 'chapters-overlay-open', description: 'Manuscript, chapters & search overlay open' },
  { page: 'manuscript', state: 'detail-sidebar-note', description: 'Manuscript, detail sidebar open on a note' },
  { page: 'manuscript', state: 'detail-sidebar-entity', description: 'Manuscript, detail sidebar open on an entity' },
  { page: 'manuscript', state: 'selection-popup', description: 'Manuscript, text-selection action popup open' },
  { page: 'manuscript', state: 'overlapping-highlights', description: 'Manuscript, entity highlight overlapping a note' },
  { page: 'manuscript', state: 'sticky-header-scrolled', description: 'Manuscript, scrolled with sticky chapter header' },
  { page: 'manuscript', state: 'chapter-collapsed', description: 'Manuscript, a chapter card collapsed' },
  { page: 'manuscript', state: 'chapter-expanded', description: 'Manuscript, a chapter card expanded' },

  // Proofing
  { page: 'proofing', state: 'setup-default', description: 'Proofing, setup panel default selection' },
  { page: 'proofing', state: 'setup-alt-selection', description: 'Proofing, setup panel alternate model/worker/chunk selection' },
  { page: 'proofing', state: 'running', description: 'Proofing, running panel mid-progress with log' },
  { page: 'proofing', state: 'results-row-expanded', description: 'Proofing, results table with one discrepancy row expanded' },
  { page: 'proofing', state: 'disabled-button', description: 'Proofing, a disabled-button precondition' },
  { page: 'proofing', state: 'toast', description: 'Proofing, a toast visible' },

  // Story Bible
  { page: 'storybible', state: 'category-all', description: 'Story Bible, All category tab' },
  { page: 'storybible', state: 'category-character', description: 'Story Bible, Character category tab' },
  { page: 'storybible', state: 'category-place', description: 'Story Bible, Place/Location category tab' },
  { page: 'storybible', state: 'category-organization', description: 'Story Bible, Organization category tab' },
  { page: 'storybible', state: 'category-needs-review', description: 'Story Bible, Needs Review category tab' },
  { page: 'storybible', state: 'entity-selected', description: 'Story Bible, an entity selected (detail panel open)' },
  { page: 'storybible', state: 'alias-typeahead', description: 'Story Bible, alias-typeahead dropdown open' },
  { page: 'storybible', state: 'delete-confirm', description: 'Story Bible, delete confirm dialog open' },
  { page: 'storybible', state: 'entry-locked', description: 'Story Bible, a locked entry' },
  { page: 'storybible', state: 'entry-unlocked', description: 'Story Bible, an unlocked entry' },

  // Settings
  { page: 'settings', state: 'global-general', description: 'Settings, Global scope / General category' },
  { page: 'settings', state: 'global-appearance', description: 'Settings, Global scope / Appearance category (theme switcher)' },
  { page: 'settings', state: 'global-proofing', description: 'Settings, Global scope / Proofing category' },
  { page: 'settings', state: 'global-storybible', description: 'Settings, Global scope / Story Bible category' },
  { page: 'settings', state: 'global-daw', description: 'Settings, Global scope / DAW Integration category' },
  { page: 'settings', state: 'global-tts', description: 'Settings, Global scope / TTS category' },
  { page: 'settings', state: 'project-proofing', description: 'Settings, Project scope / Proofing category' },
  { page: 'settings', state: 'project-storybible', description: 'Settings, Project scope / Story Bible category' },
  { page: 'settings', state: 'dirty-footer', description: 'Settings, unsaved-changes footer visible' },
  { page: 'settings', state: 'navigate-away-confirm', description: 'Settings, navigate-away-while-dirty confirm dialog' },
  { page: 'settings', state: 'reset-override', description: 'Settings, reset/clear-override control on a field' },

  // Global overlays (captured once against Home, not per-page)
  { page: 'global', state: 'tooltip', description: 'Global tooltip overlay' },
  { page: 'global', state: 'toast', description: 'Global toast overlay' },
  { page: 'global', state: 'confirm-dialog', description: 'Global confirm dialog overlay' },
  {
    page: 'global',
    state: 'nav-drawer-open',
    description:
      'Primary navigation - the mobile slide-in drawer opened via the hamburger button; a no-op at desktop/small-desktop/tablet widths where the persistent nav rail is already visible',
  },

  // Theme smoke check (Home only, not the full page/state matrix - see
  // ADR 0010) - explicit Light/Dark selected via Settings > Appearance,
  // captured on Home across every viewport.
  { page: 'global', state: 'theme-light', description: 'Home with Light explicitly selected in Settings > Appearance' },
  { page: 'global', state: 'theme-dark', description: 'Home with Dark explicitly selected in Settings > Appearance' },
];
