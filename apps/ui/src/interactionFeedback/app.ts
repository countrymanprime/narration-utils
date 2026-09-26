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
    "Best effort recovery for a popstate the app did not start (Risk 3): if it left Proofing, the run is reset the same way a guarded move would; a reset that fails leaves the finished results in place, which is harmless.",
  ),
  'src/App.tsx::transcriptReset#2': row('click', 'instant', 'na', 'na', 'na', 'silent', 'na', 'exempt', 'Best effort when leaving Proofing through the nav: a reset that fails leaves the finished results in place, which is harmless.'),
  'src/App.tsx::transcriptReset#3': row('click', 'instant', 'na', 'na', 'na', 'silent', 'na', 'exempt', 'Best effort when leaving Proofing through guarded Back/Forward (a button, Alt+Left/Right, or a mouse button): same as the nav.'),
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

};
