// The interaction feedback rows for the settings call sites (see interactionFeedback.catalog.ts for what a row says).
import { type FeedbackRow, row, subscription } from './row';

// prettier-ignore
export const settingsFeedback: Record<string, FeedbackRow> = {
  // Settings
  'src/components/settings/Settings.tsx::settingsForScope#1': row('mount', 'file-io', 'na', 'na', 'ui', 'toast', 'na', 'ok', 'A failed load shows an error and a toast.'),
  'src/components/settings/Settings.tsx::ttsCatalog#1': row('mount', 'file-io', 'na', 'na', 'ui', 'toast', 'na', 'ok', 'Loaded with the settings.'),
  'src/components/settings/Settings.tsx::whisperCatalog#1': row('mount', 'file-io', 'na', 'na', 'ui', 'toast', 'na', 'ok', 'Loaded with the settings.'),
  'src/components/settings/Settings.tsx::saveSettings#1': row('click', 'file-io', 'none', 'none', 'toast', 'toast', 'na', 'ok', 'Measured at about 3 ms (docs/research/interaction-latency-baseline.md), tier 1: nothing to acknowledge, and a second save writes the same values.'),
  'src/components/settings/Settings.tsx::saveSettings#2': row('click', 'file-io', 'none', 'none', 'toast', 'toast', 'na', 'ok', 'Clearing a project override is the same one-field write, about 3 ms: tier 1.'),
  'src/components/settings/Settings.tsx::clearProjectData#1': row('click', 'file-io', 'pending', 'pending', 'toast', 'toast', 'no', 'ok', 'The confirm stays open and busy until the files are removed, and cannot be confirmed twice (phase 6).'),
  'src/components/settings/Settings.tsx::ttsRemove#1': row('click', 'file-io', 'pending', 'pending', 'toast', 'toast', 'no', 'ok', 'The confirm stays open and busy until the voice is removed (phase 6).'),
  'src/components/settings/Settings.tsx::whisperRemove#1': row('click', 'file-io', 'pending', 'pending', 'toast', 'toast', 'no', 'ok', 'The confirm stays open and busy until the model is removed (phase 6).'),
  'src/components/settings/Settings.tsx::launchDaw#1': row('click', 'instant', 'pending', 'pending', 'toast', 'toast', 'no', 'ok', 'Phase 8: the button reads "Starting REAPER…" and disables while the detached spawn is in flight, so a second click cannot start a second REAPER process; the outcome is a toast, not page state, so it does not survive navigation.'),
  'src/components/settings/DawCatalogPanel.tsx::dawCatalogList#1': row('mount', 'instant', 'na', 'na', 'ui', 'inline', 'na', 'ok', 'The DAW catalog and its on-demand detection state (docs/architecture/daw-integration.md). A failed load shows an inline error, like the other mount-time loads in Settings; the panel re-runs detection whenever it remounts (opening or returning to the DAW Integration category) and on the manual "Check again" button, which shares this one call site (LocalAssets\' mount-plus-"Try again" pattern).'),
  'src/components/settings/DawCatalogPanel.tsx::dawCatalogOpenDownloadPage#1': row('click', 'os-dialog', 'pending', 'pending', 'ui', 'toast', 'na', 'ok', 'Opens the vendor\'s official download page in the default browser (never an installer); the button reads "Opening…" and every entry\'s button is disabled while it runs (usePendingAction), so a second click cannot open a second tab. Nothing here changes after success except the browser tab - the narrator sees the entry detected once they install it and use "Check again".'),

  // Settings > Local assets
  'src/components/assets/LocalAssets.tsx::assetsList#1': row('mount', 'file-io', 'na', 'na', 'ui', 'inline', 'na', 'ok', 'Reads only the manifests, so it opens at once; a failure is written on the page with Try again, and the rows stay while it reloads (phase 6).'),
  'src/components/assets/LocalAssetRow.tsx::assetsInstallState#1': row('effect', 'download', 'inline', 'na', 'poll', 'inline', 'no', 'ok', 'A download that was already running when the page opened is followed through the row activeJobId: the row shows its bytes at once (useAssetInstall).'),
  'src/components/assets/LocalAssetRow.tsx::assetsInstall#1': row('click', 'download', 'pending', 'host', 'poll', 'inline', 'no', 'ok', 'Download and Repair: the button is busy (Starting) until the job answers, then the row shows real bytes and Cancel; the host joins a download that is already running, so a second press starts no second one.'),
  'src/components/assets/LocalAssetRow.tsx::assetsInstallState#2': row('timer', 'download', 'inline', 'na', 'poll', 'inline', 'no', 'ok', 'The one install-poll loop (useAssetInstall), every 400 ms: the row shows the bytes as they arrive, and a failed poll is written in the row.'),
  'src/components/assets/LocalAssetRow.tsx::assetsInstallCancel#1': row('click', 'download', 'inline', 'none', 'ui', 'inline', 'no', 'ok', 'Cancel is drawn only while bytes arrive; the row says the download was cancelled, or why it could not be stopped.'),
  'src/components/assets/LocalAssetRow.tsx::assetsVerify#1': row('click', 'file-io', 'pending', 'pending', 'ui', 'inline', 'no', 'ok', 'Reads every byte, which can take seconds for a large model: the button is aria-busy with a spinner and ignores a second press (ADR 0075); the result or the failure is written in the row.'),
  'src/components/assets/LocalAssetRow.tsx::assetsRemove#1': row('click', 'file-io', 'pending', 'pending', 'toast', 'inline', 'no', 'ok', 'A danger confirm that stays open and busy until the files are gone (D12); a refusal closes it and is written in the row.'),
  'src/components/settings/UpdateDownloadDialog.tsx::updateJobState#1': row('timer', 'download', 'dialog', 'na', 'poll', 'dialog', 'no', 'ok', 'Modal dialog with real byte progress (ADR 0072); a job-end event carries the outcome (ADR 0076).'),
  'src/components/settings/UpdateDownloadDialog.tsx::updateDownload#1': row('click', 'download', 'dialog', 'dialog', 'poll', 'dialog', 'no', 'ok', 'Modal dialog with real byte progress and Cancel; the host refuses a second download.'),
  'src/components/settings/UpdateDownloadDialog.tsx::updateJobCancel#1': row('click', 'download', 'dialog', 'dialog', 'poll', 'dialog', 'no', 'ok', 'Cancel while downloading; the next poll shows it.'),
  'src/components/settings/UpdatesPanel.tsx::updateStatus#1': row('mount', 'file-io', 'na', 'na', 'ui', 'inline', 'na', 'ok', 'An unreadable status shows an inline error.'),
  'src/components/settings/UpdatesPanel.tsx::subscribeUpdate#1': subscription('Status changes while the page is open.'),
  'src/components/settings/UpdatesPanel.tsx::updateCheck#1': row('click', 'download', 'pending', 'pending', 'ui', 'inline', 'no', 'ok', '"Checking…" with the button disabled and focus put back afterwards (S15).'),
  'src/components/settings/UpdatesPanel.tsx::updateOpenNotes#1': row('click', 'os-dialog', 'none', 'none', 'ui', 'inline', 'na', 'ok', 'Opens the browser; instant.'),
  'src/components/settings/UpdatesPanel.tsx::updateShowDownload#1': row('click', 'os-dialog', 'none', 'none', 'ui', 'inline', 'na', 'ok', 'Opens Explorer; instant.'),
  'src/components/settings/UpdatesPanel.tsx::updateInstall#1': row('click', 'job', 'dialog', 'dialog', 'dialog', 'inline', 'no', 'ok', 'The install dialog is shown at once and the app restarts (ADR 0074).'),
  'src/components/settings/UpdatesPanel.tsx::updateStatus#2': row('effect', 'file-io', 'na', 'na', 'ui', 'inline', 'na', 'ok', 'Re-reads the status when the saved channel changes.'),

};
