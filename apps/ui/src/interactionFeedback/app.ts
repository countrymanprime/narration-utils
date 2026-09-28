// The interaction feedback rows for the app call sites (see interactionFeedback.catalog.ts for what a row says).
import { type FeedbackRow, row, startup, subscription } from './row';

// prettier-ignore
export const appFeedback: Record<string, FeedbackRow> = {
  // App.tsx
  'src/App.tsx::bootstrap#1': row('event', 'file-io', 'na', 'na', 'ui', 'toast', 'na', 'ok', 'refreshBootstrap catches its own failure and says so (phase 6); every caller runs it from an event or a `void`.'),
  'src/App.tsx::ready#1': startup('Startup: the startup screen shows the error and Retry.'),
  'src/App.tsx::bootstrap#2': startup('Startup: the startup screen shows the error and Retry.'),
  'src/App.tsx::reportClientDiagnostic#1': row('effect', 'file-io', 'na', 'na', 'na', 'silent', 'na', 'exempt', 'A diagnostic must never throw or show a second error while one is already being reported.'),
  'src/App.tsx::reportClientDiagnostic#2': row('event', 'file-io', 'na', 'na', 'na', 'silent', 'na', 'exempt', 'A diagnostic must never throw or show a second error while one is already being reported.'),
  'src/App.tsx::reportClientDiagnostic#3': row('event', 'file-io', 'na', 'na', 'na', 'silent', 'na', 'exempt', 'A diagnostic must never throw or show a second error while one is already being reported.'),
  'src/App.tsx::subscribeTranscript#1': subscription('The transcript state event.'),
  'src/App.tsx::subscribeJobEnded#1': subscription('A host job that ends becomes a toast for the jobs that can finish elsewhere (ADR 0076).'),
  'src/App.tsx::systemNotify#1': row('event', 'os-dialog', 'na', 'na', 'na', 'silent', 'na', 'exempt', 'An OS notification is a courtesy, not load-bearing: the host already swallows a failed or unavailable sender (N1-N4), and the app-level toast from the same job:ended event is the record of what happened.'),
  'src/App.tsx::subscribeNotices#1': subscription('Host notices (a file kept aside) become toasts.'),
  'src/App.tsx::subscribeUpdate#1': subscription('The update check finding a newer release becomes one toast.'),
  'src/App.tsx::subscribeLiveUpdateHealth#1': subscription('Degraded live updates become one toast.'),
  'src/App.tsx::subscribeProjectAttach#1': subscription('A project attach refreshes the bootstrap or shows why it was refused.'),
  'src/App.tsx::settingsForScope#1': row('mount', 'file-io', 'na', 'na', 'ui', 'silent', 'na', 'exempt', 'Cosmetic: the narrator\'s entity colours; the built-in colours stay if the settings cannot be read, and Settings reports the real error.'),
  'src/App.tsx::chapterSyncPreview#1': row('effect', 'file-io', 'na', 'na', 'ui', 'toast', 'na', 'ok', 'Fills the consent dialog once chapterSyncState().ask is true (daw-chapter-track-auto-sync.prd.md Phase 3); a failed read is a toast and the dialog keeps its "reading the saved project" placeholder.'),
  'src/App.tsx::chapterSyncSetEnabled#1': row('click', 'file-io', 'pending', 'pending', 'ui', 'toast', 'na', 'ok', 'Sync N chapters on the consent dialog: the button is busy until the first sync runs and the dialog closes on its own once ask flips false (the same chaptersync:state event Home\'s toast and Tracks\' panel read).'),
  'src/App.tsx::chapterSyncSetEnabled#2': row('click', 'file-io', 'none', 'none', 'ui', 'toast', 'na', 'ok', 'Not now on the consent dialog: a one-way write with nothing to wait for; the dialog closes once the event says consent is off, and a failure is a toast that leaves it open to try again.'),
  // Phase 1 (app-navigation-and-zoom-controls.prd.md) added two more transcriptReset call sites in this file (Back/Forward's
  // own guard, and the popstate-recovery effect for a browser/mouse gesture that bypassed it), renumbering this one from #1.
  'src/App.tsx::transcriptReset#1': row(
    'effect',
    'instant',
    'na',
    'na',
    'na',
    'silent',
    'na',
    'exempt',
    "Best effort recovery for a popstate the app did not start (Risk 3): if it left a Proof chapter view with a compare run, the run is reset the same way a guarded move would; a reset that fails leaves the finished results in place, which is harmless.",
  ),
  'src/App.tsx::transcriptReset#2': row('click', 'instant', 'na', 'na', 'na', 'silent', 'na', 'exempt', 'Best effort when leaving a Proof chapter view with a compare run through the nav: a reset that fails leaves the finished results in place, which is harmless.'),
  'src/App.tsx::transcriptReset#3': row('click', 'instant', 'na', 'na', 'na', 'silent', 'na', 'exempt', 'Best effort when leaving a Proof chapter view with a compare run through guarded Back/Forward (a button, Alt+Left/Right, or a mouse button): same as the nav.'),
  'src/App.tsx::linkDawFile#1': row(
    'click',
    'os-dialog',
    'pending',
    'pending',
    'ui',
    'toast',
    'yes',
    'ok',
    'The one shared binding behind the pill, Tracks and Settings\' DAW category (PRD project-workspace-and-daw-link.prd.md, W19): a single usePendingAction ref guards all three call sites, not just the one whose button visibly disables. A folder mismatch is its own toast, not an unhandled rejection (W15); the linked file persists in the project manifest, so it survives navigation.',
  ),

  // useCapability.ts (studio-ui-primitives.prd.md Phase 12): one capability's live entry from the DAW port's capability report, for any
  // caller wrapping a control in CapabilityGate.
  'src/useCapability.ts::dawCapabilities#1': row('mount', 'file-io', 'na', 'na', 'event', 'silent', 'na', 'exempt', 'Seeds the entry useCapability exposes before the very next daw_capabilities_changed event takes over; a failed seed just leaves the capability unsupported/unavailable a moment longer, the same as an unknown capability.'),
  'src/useCapability.ts::subscribeDawCapabilities#1': subscription("The DAW port's capability report (DAW port PRD Phase 4): every caller of useCapability for the same or a different capability reads this one subscription."),

  // useZoom.ts (app-navigation-and-zoom-controls.prd.md Phase 2): the header's zoom group. The readout is the only feedback surface
  // (Solution Detail); every call here is instant (the binding sets/reads a number on the window, no file or network,
  // docs/architecture/threat-model.md row 3) and a failure just leaves the readout at the level it already showed.
  'src/hooks/useZoom.ts::windowZoom#1': row('mount', 'instant', 'na', 'na', 'ui', 'silent', 'na', 'exempt', "Seeds the readout at the window's real level before the first paint settles; a failed read leaves it at the 100% default until the next resize re-reads it."),
  'src/hooks/useZoom.ts::windowSetZoom#1': row('click', 'instant', 'inline', 'none', 'ui', 'silent', 'yes', 'exempt', 'Zoom out, Zoom in, reset, and Ctrl+=/-/0: the readout itself is the acknowledgment and the completion. A failed set leaves the previous level shown, visibly unchanged, and survives navigation like the level itself.'),
  'src/hooks/useZoom.ts::windowZoom#2': row('effect', 'instant', 'na', 'na', 'ui', 'silent', 'na', 'exempt', "The resize-triggered re-read for an external Ctrl+wheel/pinch change (ADR 0201 item 3, no zoom-changed event on Windows); a failed read just leaves the readout at its last known level until the next resize."),
  // Phase 3 (app-navigation-and-zoom-controls.prd.md, Q4 A): the settled level is also persisted to disk, debounced by
  // the same settle as the announcement, so it survives a quit; the readout has already shown the new level, so there
  // is nothing more to acknowledge here.
  'src/hooks/useZoom.ts::windowSaveZoom#1': row('timer', 'file-io', 'na', 'na', 'na', 'silent', 'na', 'exempt', "The debounced persist of the settled level; a failed write just leaves the next launch opening at the last level that did save, with no error surfaced for a header control that already did what the narrator asked."),

  // useDawRecording.ts (input-commands-and-pedals.prd.md Phase 10): the DAW port's live transport state, read only
  // by LiveCommandRouter to silence `noisy` commands while REAPER records (PRD Q5). Not narrator-facing on its own -
  // the router's own status region, not a toast, is how a failed press is explained - so this is a background feed,
  // exempt like every other subscribe-based hook.
  'src/input/useDawRecording.ts::subscribeDawTransport#1': subscription('The DAW port\'s live transport state (DAW port PRD Phase 9, daw_transport_changed): every gesture the router resolves reads this one subscription\'s current value.'),

};
