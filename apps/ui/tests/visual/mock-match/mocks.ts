// The approved mocks the pixel-match tool scores (mock-fidelity-primitives-and-components.prd.md, "The approved set", D91 on
// #509), each with the visual-suite state that shows the same screen. Only approved mocks are the spec:
// - the seven benchmark mocks in stage-navigation-and-page-replacement/, approved as the build spec (D69, 2026-09-27);
// - the per-PRD sets the owner approved on 2026-09-24 (input commands and pedals on 2026-09-27), drawn from the real app in
//   the dark theme, less their `before` pictures (what was there), their `alt` pictures (the option not chosen) and the
//   copies of the benchmark mocks (`*-concept.webp` outside stage-navigation-and-page-replacement/, scored once there).
// Concept pictures are listed in the PRD and never set the spec. A mock with no `target` is listed with why it is not
// scored; a later phase gives it a target (a new catalog state, or a region) and it is scored from then on.

import { fileURLToPath } from 'node:url';

interface Region {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ApprovedMock {
  /** Path under docs/prds/mockups/. */
  file: string;
  /** The visual-suite state (tests/visual/state-catalog.ts) that shows this screen; its driver reaches it. */
  target?: { page: string; state: string };
  /** The theme the mock is drawn in: the capture uses it too, so a theme is never counted as a difference (D69). */
  theme: 'light' | 'dark';
  /**
   * Compare only this part of the mock, captured at its size: a mock that draws the app beside something that is not the
   * app (mock 07 draws REAPER to the left of the companion panel).
   */
  mockRegion?: Region;
  /**
   * The viewport to capture at, when it is not the mock's own size: a crop of a wider screen is captured at the screen's
   * size and its top-left `width × height` compared (a header crop is the top of the page).
   */
  viewport?: { width: number; height: number };
  /** Why the mock has no target yet. */
  unscored?: string;
}

const BENCHMARK = 'stage-navigation-and-page-replacement';
const REPLACED_HOME = 'Home was replaced by Production (D79, ADR 0407): benchmark mock 01 is the spec for this screen now';
const REPLACED_MANUSCRIPT_CROP =
  'a crop of the Manuscript page, whose position on the page the mock does not record; the full-frame mocks of the same set are scored';

export const APPROVED_MOCKS: ApprovedMock[] = [
  // The benchmark mocks (D69), light except the Booth and the companion panel.
  { file: `${BENCHMARK}/01-production-home-concept.webp`, target: { page: 'production', state: 'on-pace' }, theme: 'light' },
  { file: `${BENCHMARK}/02-prep-script-concept.webp`, target: { page: 'script', state: 'prep-rail-characters' }, theme: 'light' },
  { file: `${BENCHMARK}/03-booth-concept.webp`, target: { page: 'booth', state: 'speaker-tags' }, theme: 'dark' },
  { file: `${BENCHMARK}/04-proof-pickups-concept.webp`, target: { page: 'proof', state: 'default' }, theme: 'light' },
  { file: `${BENCHMARK}/05-master-delivery-concept.webp`, target: { page: 'master', state: 'measured' }, theme: 'light' },
  { file: `${BENCHMARK}/06-series-voice-bible-concept.webp`, target: { page: 'storybible', state: 'series-tab-populated' }, theme: 'light' },
  {
    file: `${BENCHMARK}/07-daw-companion-concept.webp`,
    target: { page: 'booth', state: 'companion-default' },
    theme: 'dark',
    mockRegion: { x: 1020, y: 0, width: 420, height: 900 },
  },

  // actual-recorded-column (2026-09-24): the Home chapter table, now Production's board.
  { file: 'actual-recorded-column/01-after-table.webp', theme: 'dark', unscored: REPLACED_HOME },
  { file: 'actual-recorded-column/02-dash-reason-tooltip.webp', theme: 'dark', unscored: REPLACED_HOME },
  { file: 'actual-recorded-column/03-headline-stat-tooltip.webp', theme: 'dark', unscored: REPLACED_HOME },
  { file: 'actual-recorded-column/04-column-header-tooltip.webp', theme: 'dark', unscored: REPLACED_HOME },

  // app-navigation-and-zoom-controls (2026-09-24): the header. The crops are the top of a 1440 px window.
  {
    file: 'app-navigation-and-zoom-controls/01-desktop-default-first-page-100.webp',
    target: { page: 'production', state: 'on-pace' },
    theme: 'dark',
  },
  {
    file: 'app-navigation-and-zoom-controls/01a-header-crop-default.webp',
    target: { page: 'production', state: 'on-pace' },
    theme: 'dark',
    viewport: { width: 1440, height: 900 },
  },
  {
    file: 'app-navigation-and-zoom-controls/02-desktop-back-enabled-zoom-125.webp',
    target: { page: 'shell', state: 'zoom-level' },
    theme: 'dark',
  },
  {
    file: 'app-navigation-and-zoom-controls/02a-header-crop-back-enabled-zoom-125.webp',
    target: { page: 'shell', state: 'zoom-level' },
    theme: 'dark',
    viewport: { width: 1440, height: 900 },
  },
  {
    file: 'app-navigation-and-zoom-controls/03-tooltip-back-shortcut.webp',
    theme: 'dark',
    unscored: 'a crop around a tooltip, whose position the mock does not record',
  },
  {
    file: 'app-navigation-and-zoom-controls/04-tooltip-reset-zoom.webp',
    theme: 'dark',
    unscored: 'a crop around a tooltip, whose position the mock does not record',
  },
  {
    file: 'app-navigation-and-zoom-controls/05-tooltip-back-disabled.webp',
    theme: 'dark',
    unscored: 'a crop around a tooltip, whose position the mock does not record',
  },
  {
    file: 'app-navigation-and-zoom-controls/06-tablet-768-both-enabled-zoom-150.webp',
    target: { page: 'shell', state: 'history-forward' },
    theme: 'dark',
    viewport: { width: 768, height: 1024 },
  },
  {
    file: 'app-navigation-and-zoom-controls/07-reflow-390-header-optionA.webp',
    theme: 'dark',
    unscored: 'the shell is not captured at 390 px (ADR 0037); needs a reflow row',
  },
  {
    file: 'app-navigation-and-zoom-controls/07a-reflow-390-header-optionA-100.webp',
    theme: 'dark',
    unscored: 'the shell is not captured at 390 px (ADR 0037); needs a reflow row',
  },
  { file: 'app-navigation-and-zoom-controls/08-header-crop-max-200.webp', theme: 'dark', unscored: 'zoom at 200% has no catalog state' },
  {
    file: 'app-navigation-and-zoom-controls/09-window-1280-at-150-real-zoom.webp',
    theme: 'dark',
    unscored: 'real WebView2 zoom is a host feature the browser capture cannot reproduce',
  },

  // app-shell-vertical-overflow (2026-09-24).
  {
    file: 'app-shell-vertical-overflow/01-after.webp',
    target: { page: 'production', state: 'on-pace' },
    theme: 'dark',
  },

  // chapter-title-display-consistency (2026-09-24): crops of pages now replaced or reshaped.
  { file: 'chapter-title-display-consistency/01-manuscript-cards-after.webp', theme: 'dark', unscored: REPLACED_MANUSCRIPT_CROP },
  { file: 'chapter-title-display-consistency/02-home-table-after.webp', theme: 'dark', unscored: REPLACED_HOME },
  {
    file: 'chapter-title-display-consistency/03-chapters-search-after.webp',
    theme: 'dark',
    unscored: 'a crop of the Chapters & Search slide-over, whose position the mock does not record',
  },
  {
    file: 'chapter-title-display-consistency/04-read-aloud-heading-after.webp',
    theme: 'dark',
    unscored: 'the read-aloud dialog became the Booth (D79); benchmark mock 03 is its spec',
  },
  {
    file: 'chapter-title-display-consistency/05-read-aloud-heading-prologue-after.webp',
    theme: 'dark',
    unscored: 'the read-aloud dialog became the Booth (D79); benchmark mock 03 is its spec',
  },
  {
    file: 'chapter-title-display-consistency/06-read-aloud-while-reading-after.webp',
    theme: 'dark',
    unscored: 'the read-aloud dialog became the Booth (D79); benchmark mock 03 is its spec',
  },
  {
    file: 'chapter-title-display-consistency/07-teleprompter-select-after.webp',
    theme: 'dark',
    unscored: 'the Teleprompter page became the Booth (D79); benchmark mock 03 is its spec',
  },

  // chapter-track-link-control (2026-09-24): the track slide-over, now opened from Production's board.
  { file: 'chapter-track-link-control/01-track-button-states.webp', theme: 'dark', unscored: REPLACED_HOME },
  { file: 'chapter-track-link-control/02-slideover-linked.webp', target: { page: 'production', state: 'chapter-track-panel-linked' }, theme: 'dark' },
  { file: 'chapter-track-link-control/03-slideover-ambiguous.webp', target: { page: 'production', state: 'chapter-track-panel-ambiguous' }, theme: 'dark' },
  {
    file: 'chapter-track-link-control/04-slideover-suggested-relink-warning.webp',
    theme: 'dark',
    unscored: 'the relink warning before linking is not built (visual audit TL10)',
  },
  { file: 'chapter-track-link-control/05-slideover-track-missing.webp', target: { page: 'production', state: 'chapter-track-panel-missing' }, theme: 'dark' },
  { file: 'chapter-track-link-control/06-remove-from-recording-confirm.webp', target: { page: 'production', state: 'chapter-remove-confirm' }, theme: 'dark' },
  { file: 'chapter-track-link-control/07-removed-from-recording-list.webp', theme: 'dark', unscored: REPLACED_HOME },
  { file: 'chapter-track-link-control/08-no-project-line.webp', theme: 'dark', unscored: REPLACED_HOME },
  { file: 'chapter-track-link-control/09-tablet-768-track-column.webp', theme: 'dark', unscored: REPLACED_HOME },

  // credits-in-chapter-table (2026-09-24): crops of the Home table.
  { file: 'credits-in-chapter-table/01-opening-credits-first-row.webp', theme: 'dark', unscored: REPLACED_HOME },
  { file: 'credits-in-chapter-table/02-closing-credits-last-row.webp', theme: 'dark', unscored: REPLACED_HOME },
  { file: 'credits-in-chapter-table/03-disabled-check-reason.webp', theme: 'dark', unscored: REPLACED_HOME },
  { file: 'credits-in-chapter-table/04-unresolved-token-warning.webp', theme: 'dark', unscored: REPLACED_HOME },
  { file: 'credits-in-chapter-table/05-closing-not-set-up.webp', theme: 'dark', unscored: REPLACED_HOME },

  // credits-token-setup-and-front-matter-detection (2026-09-24).
  {
    file: 'credits-token-setup-and-front-matter-detection/01-setup-dialog-on-open.webp',
    target: { page: 'production', state: 'credits-setup-dialog' },
    theme: 'dark',
  },
  { file: 'credits-token-setup-and-front-matter-detection/02-home-banner-after-not-now.webp', theme: 'dark', unscored: REPLACED_HOME },
  { file: 'credits-token-setup-and-front-matter-detection/03-manuscript-banner-and-fill-in.webp', theme: 'dark', unscored: REPLACED_MANUSCRIPT_CROP },

  // daw-chapter-track-auto-sync (2026-09-24).
  { file: 'daw-chapter-track-auto-sync/01-sync-consent-dialog.webp', target: { page: 'production', state: 'chapter-sync-consent' }, theme: 'dark' },
  { file: 'daw-chapter-track-auto-sync/02-needs-you-list-tracks-page.webp', target: { page: 'engine', state: 'sync-activity' }, theme: 'dark' },
  { file: 'daw-chapter-track-auto-sync/03-auto-linked-toast-undo.webp', target: { page: 'production', state: 'chapter-sync-toast-undo' }, theme: 'dark' },
  { file: 'daw-chapter-track-auto-sync/04-row-check-status-replaces-check.webp', theme: 'dark', unscored: REPLACED_HOME },

  // delivery-platform-profiles (2026-09-24): the Delivery page became Master & QC (benchmark mock 05).
  { file: 'delivery-platform-profiles/01-profile-panel-acx-rules-and-sources.webp', target: { page: 'master', state: 'profile-rules' }, theme: 'dark' },
  { file: 'delivery-platform-profiles/02-measured-pass-acx.webp', target: { page: 'master', state: 'measured' }, theme: 'dark' },
  { file: 'delivery-platform-profiles/03-measured-failing-acx.webp', target: { page: 'master', state: 'file-rules' }, theme: 'dark' },
  {
    file: 'delivery-platform-profiles/04-failing-file-rule-by-rule-with-source.webp',
    theme: 'dark',
    unscored: 'a crop of the per-file rules, whose position the mock does not record',
  },
  { file: 'delivery-platform-profiles/05-settings-project-profile-picker.webp', target: { page: 'settings', state: 'project-delivery' }, theme: 'dark' },
  { file: 'delivery-platform-profiles/06-custom-profile-editor.webp', target: { page: 'settings', state: 'delivery-profile-editor' }, theme: 'dark' },
  {
    file: 'delivery-platform-profiles/07-page-judged-by-custom-profile.webp',
    theme: 'dark',
    unscored: 'a crop of the Delivery page, which Master & QC replaced (D79)',
  },
  { file: 'delivery-platform-profiles/08-report-header-names-profile.webp', theme: 'dark', unscored: 'the exported HTML report, not an app screen' },
  { file: 'delivery-platform-profiles/09-settings-picker-reflow-390.webp', target: { page: 'settings', state: 'project-delivery' }, theme: 'dark' },
  { file: 'delivery-platform-profiles/10-measured-failing-tablet-768.webp', target: { page: 'master', state: 'file-rules' }, theme: 'dark' },

  // edit-and-proof-workspace (2026-09-24): the chapter workspace, now Proof's chapter view.
  { file: 'edit-and-proof-workspace/01-playing-follow.webp', target: { page: 'proof-chapter', state: 'playing' }, theme: 'dark' },
  { file: 'edit-and-proof-workspace/01-playing-follow-1024.webp', target: { page: 'proof-chapter', state: 'playing' }, theme: 'dark' },
  { file: 'edit-and-proof-workspace/01a-entry-open-workspace-from-tracks.webp', target: { page: 'engine', state: 'default' }, theme: 'dark' },
  { file: 'edit-and-proof-workspace/01a-entry-open-workspace-from-tracks-1024.webp', target: { page: 'engine', state: 'default' }, theme: 'dark' },
  { file: 'edit-and-proof-workspace/02-flag-detail-open.webp', target: { page: 'proof-chapter', state: 'flag-finding-open' }, theme: 'dark' },
  { file: 'edit-and-proof-workspace/02-flag-detail-open-1024.webp', target: { page: 'proof-chapter', state: 'flag-finding-open' }, theme: 'dark' },
  { file: 'edit-and-proof-workspace/03-click-word-to-seek.webp', target: { page: 'proof-chapter', state: 'note-selected' }, theme: 'dark' },
  { file: 'edit-and-proof-workspace/03-click-word-to-seek-1024.webp', target: { page: 'proof-chapter', state: 'note-selected' }, theme: 'dark' },
  {
    file: 'edit-and-proof-workspace/04-takes-panel-ab.webp',
    theme: 'dark',
    unscored: 'the takes A/B panel in the chapter view is not built (edit-and-proof Phase 5)',
  },
  {
    file: 'edit-and-proof-workspace/04-takes-panel-ab-1024.webp',
    theme: 'dark',
    unscored: 'the takes A/B panel in the chapter view is not built (edit-and-proof Phase 5)',
  },
  {
    file: 'edit-and-proof-workspace/05-selection-context-menu-fx.webp',
    theme: 'dark',
    unscored: 'the selection FX menu is not built (edit-and-proof Phase 8)',
  },
  {
    file: 'edit-and-proof-workspace/05-selection-context-menu-fx-1024.webp',
    theme: 'dark',
    unscored: 'the selection FX menu is not built (edit-and-proof Phase 8)',
  },
  { file: 'edit-and-proof-workspace/05c-apply-fx-confirm.webp', theme: 'dark', unscored: 'the apply-FX confirm is not built (edit-and-proof Phase 8)' },
  { file: 'edit-and-proof-workspace/05c-apply-fx-confirm-1024.webp', theme: 'dark', unscored: 'the apply-FX confirm is not built (edit-and-proof Phase 8)' },
  { file: 'edit-and-proof-workspace/06-reaper-offline.webp', target: { page: 'proof-chapter', state: 'standalone' }, theme: 'dark' },
  { file: 'edit-and-proof-workspace/06-reaper-offline-1024.webp', target: { page: 'proof-chapter', state: 'standalone' }, theme: 'dark' },
  { file: 'edit-and-proof-workspace/07-unsaved-changes-in-reaper.webp', target: { page: 'proof-chapter', state: 'stale' }, theme: 'dark' },
  { file: 'edit-and-proof-workspace/07-unsaved-changes-in-reaper-1024.webp', target: { page: 'proof-chapter', state: 'stale' }, theme: 'dark' },

  // home-combined and home-stage-check-line (2026-09-24).
  { file: 'home-combined/01-home-after.webp', theme: 'dark', unscored: REPLACED_HOME },
  { file: 'home-combined/02-home-after-summary-open.webp', target: { page: 'production', state: 'recording-check-complete' }, theme: 'dark' },
  { file: 'home-stage-check-line/01-after-normal-no-line.webp', theme: 'dark', unscored: REPLACED_HOME },
  { file: 'home-stage-check-line/02-after-error-try-again.webp', theme: 'dark', unscored: REPLACED_HOME },

  // input-commands-and-pedals (2026-09-27).
  { file: 'input-commands-and-pedals/01-settings-global-keyboard.webp', target: { page: 'settings', state: 'global-keyboard' }, theme: 'dark' },
  {
    file: 'input-commands-and-pedals/02-settings-global-keyboard-recording.webp',
    target: { page: 'settings', state: 'global-keyboard-recording' },
    theme: 'dark',
  },
  {
    file: 'input-commands-and-pedals/03-settings-global-keyboard-conflict.webp',
    target: { page: 'settings', state: 'global-keyboard-conflict' },
    theme: 'dark',
  },
  { file: 'input-commands-and-pedals/04-shortcut-sheet.webp', target: { page: 'global', state: 'shortcut-sheet' }, theme: 'dark' },
  { file: 'input-commands-and-pedals/05-settings-global-keyboard-reflow-390.webp', target: { page: 'settings', state: 'global-keyboard' }, theme: 'dark' },

  // manuscript-* (2026-09-24): the Manuscript page, now Prep › Script.
  { file: 'manuscript-chapter-header-alignment/01-after.webp', target: { page: 'script', state: 'chapter-header-columns' }, theme: 'dark' },
  { file: 'manuscript-chapter-header-alignment/02-after-tablet.webp', target: { page: 'script', state: 'chapter-header-columns' }, theme: 'dark' },
  { file: 'manuscript-chapter-header-alignment/03-after-with-retail-sample.webp', target: { page: 'script', state: 'retail-sample' }, theme: 'dark' },
  { file: 'manuscript-combined/01-manuscript-after.webp', target: { page: 'script', state: 'reader-text-medium' }, theme: 'dark' },
  { file: 'manuscript-credits-card-parity/01-credits-open-by-default.webp', target: { page: 'script', state: 'credits-entries' }, theme: 'dark' },
  { file: 'manuscript-credits-card-parity/02-whole-header-toggle-focus.webp', theme: 'dark', unscored: REPLACED_MANUSCRIPT_CROP },
  { file: 'manuscript-credits-card-parity/03-credits-text-size-large.webp', theme: 'dark', unscored: REPLACED_MANUSCRIPT_CROP },
  { file: 'manuscript-credits-card-parity/04-collapse-all-closing-credits-last.webp', theme: 'dark', unscored: REPLACED_MANUSCRIPT_CROP },
  { file: 'manuscript-credits-card-parity/05-read-aloud-dialog-opening-credits.webp', target: { page: 'booth', state: 'credits-opening' }, theme: 'dark' },

  // read-aloud-control-bar (2026-09-24): the read-aloud dialog, now the Booth.
  { file: 'read-aloud-control-bar/01-idle.webp', target: { page: 'booth', state: 'setup' }, theme: 'dark' },
  { file: 'read-aloud-control-bar/01-idle-1024.webp', target: { page: 'booth', state: 'setup' }, theme: 'dark' },
  { file: 'read-aloud-control-bar/02-reading-scrolled.webp', target: { page: 'booth', state: 'listening' }, theme: 'dark' },
  { file: 'read-aloud-control-bar/02-reading-scrolled-1024.webp', target: { page: 'booth', state: 'listening' }, theme: 'dark' },
  { file: 'read-aloud-control-bar/03-mic-popover.webp', target: { page: 'booth', state: 'mic-popover' }, theme: 'dark' },
  { file: 'read-aloud-control-bar/03-mic-popover-1024.webp', target: { page: 'booth', state: 'mic-popover' }, theme: 'dark' },
  { file: 'read-aloud-control-bar/04-gear-popover.webp', target: { page: 'booth', state: 'settings-popover' }, theme: 'dark' },
  { file: 'read-aloud-control-bar/04-gear-popover-1024.webp', target: { page: 'booth', state: 'settings-popover' }, theme: 'dark' },
  { file: 'read-aloud-control-bar/05-reaper-first-confirm.webp', target: { page: 'booth', state: 'reaper-confirm' }, theme: 'dark' },
  { file: 'read-aloud-control-bar/05-reaper-first-confirm-1024.webp', target: { page: 'booth', state: 'reaper-confirm' }, theme: 'dark' },
  { file: 'read-aloud-control-bar/06-reaper-armed.webp', target: { page: 'booth', state: 'reaper-recording' }, theme: 'dark' },
  { file: 'read-aloud-control-bar/06-reaper-armed-1024.webp', target: { page: 'booth', state: 'reaper-recording' }, theme: 'dark' },
  { file: 'read-aloud-control-bar/07-reaper-recording.webp', target: { page: 'booth', state: 'reaper-rec' }, theme: 'dark' },
  { file: 'read-aloud-control-bar/07-reaper-recording-1024.webp', target: { page: 'booth', state: 'reaper-rec' }, theme: 'dark' },
  { file: 'read-aloud-control-bar/08-reaper-not-armed.webp', target: { page: 'booth', state: 'reaper-not-armed' }, theme: 'dark' },
  { file: 'read-aloud-control-bar/08-reaper-not-armed-1024.webp', target: { page: 'booth', state: 'reaper-not-armed' }, theme: 'dark' },
  { file: 'read-aloud-control-bar/09-paused.webp', target: { page: 'booth', state: 'paused' }, theme: 'dark' },
  { file: 'read-aloud-control-bar/09-paused-1024.webp', target: { page: 'booth', state: 'paused' }, theme: 'dark' },
  { file: 'read-aloud-control-bar/10-finished-still-recording.webp', target: { page: 'booth', state: 'finished-still-recording' }, theme: 'dark' },
  { file: 'read-aloud-control-bar/10-finished-still-recording-1024.webp', target: { page: 'booth', state: 'finished-still-recording' }, theme: 'dark' },

  // read-aloud-resume-from-daw (2026-09-24): the resume card, now in the Booth.
  { file: 'read-aloud-resume-from-daw/01-agree.webp', target: { page: 'booth', state: 'resume-agree' }, theme: 'dark' },
  { file: 'read-aloud-resume-from-daw/01-agree-1024.webp', target: { page: 'booth', state: 'resume-agree' }, theme: 'dark' },
  { file: 'read-aloud-resume-from-daw/02-disagree.webp', target: { page: 'booth', state: 'resume-disagree' }, theme: 'dark' },
  { file: 'read-aloud-resume-from-daw/02-disagree-1024.webp', target: { page: 'booth', state: 'resume-disagree' }, theme: 'dark' },
  { file: 'read-aloud-resume-from-daw/03-recorded-to-end.webp', target: { page: 'booth', state: 'resume-complete' }, theme: 'dark' },
  { file: 'read-aloud-resume-from-daw/03-recorded-to-end-1024.webp', target: { page: 'booth', state: 'resume-complete' }, theme: 'dark' },
  { file: 'read-aloud-resume-from-daw/04-after-play-prompt-gone.webp', target: { page: 'booth', state: 'resume-after-reaper-plays' }, theme: 'dark' },
  { file: 'read-aloud-resume-from-daw/04-after-play-prompt-gone-1024.webp', target: { page: 'booth', state: 'resume-after-reaper-plays' }, theme: 'dark' },
  { file: 'read-aloud-resume-from-daw/05-checking.webp', theme: 'dark', unscored: 'the resume check in flight has no catalog state' },
  { file: 'read-aloud-resume-from-daw/05-checking-1024.webp', theme: 'dark', unscored: 'the resume check in flight has no catalog state' },
  { file: 'read-aloud-resume-from-daw/06-last-reading-only.webp', target: { page: 'booth', state: 'resume-prompter-only' }, theme: 'dark' },
  { file: 'read-aloud-resume-from-daw/06-last-reading-only-1024.webp', target: { page: 'booth', state: 'resume-prompter-only' }, theme: 'dark' },
];

/** Concept pictures and copies: listed so nothing is lost, never the spec (D91, D68). */
export const NOT_THE_SPEC: { file: string; why: string }[] = [
  { file: 'booth-mode-and-companion-panel/03-booth-concept.webp', why: `a copy of ${BENCHMARK}/03, scored there` },
  { file: 'booth-mode-and-companion-panel/07-daw-companion-concept.webp', why: `a copy of ${BENCHMARK}/07, scored there` },
  { file: 'character-continuity-review/06-series-voice-bible-concept.webp', why: `a copy of ${BENCHMARK}/06` },
  { file: 'prep-depth/02-prep-script-concept.webp', why: `a copy of ${BENCHMARK}/02, scored there` },
  { file: 'production-tracking/01-production-home-concept.webp', why: `a copy of ${BENCHMARK}/01, scored there` },
  { file: 'render-encode-master/05-master-delivery-concept.webp', why: `a copy of ${BENCHMARK}/05, scored there` },
  { file: 'delivery-platform-profiles/11-book-wide-spread-concept.webp', why: `a copy of ${BENCHMARK}/05, scored there` },
  {
    file: 'edit-and-proof-workspace/08-long-run-page-consolidation.webp',
    why: 'a concept of the long-run page consolidation, superseded by the benchmark set',
  },
];

export function scoredMocks(): (ApprovedMock & { target: { page: string; state: string } })[] {
  return APPROVED_MOCKS.filter((mock): mock is ApprovedMock & { target: { page: string; state: string } } => Boolean(mock.target));
}

/** The mock's path on disk. */
export function mockPath(file: string): string {
  return fileURLToPath(new URL(`../../../../../docs/prds/mockups/${file}`, import.meta.url));
}

/** The file name the capture, the diff and the record of one mock are written under. */
export function slugOf(file: string): string {
  return file.replace(/\.webp$/, '').replace(/\//g, '__');
}
