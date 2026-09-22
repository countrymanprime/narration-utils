// The interaction feedback catalog (ADR 0075, docs/architecture/interaction-feedback.md): one row for every place the UI calls the host, with a
// verdict against the standard. `interactionFeedback.test.ts` fails on a call site that has no row, on a row whose site is gone, and on a row that
// breaks the rules for its verdict, so the inventory cannot rot.
//
// A site is `<file under apps/ui>::<NarrationApi method>#<n>`, the n-th call of that method in that file, in source order. Adding or removing a call
// renumbers the ones after it in the same file; the test names the keys that changed.

/** What made the call: a click or key, a value the narrator changed, a page or component mounting, an effect reacting, a host event. */
type Trigger = 'click' | 'input' | 'mount' | 'effect' | 'timer' | 'event';
/** What the host does to answer. `instant` is a Go call that never leaves memory, `file-io` reads or writes a project file. */
type Cost = 'instant' | 'file-io' | 'python' | 'job' | 'download' | 'os-dialog' | 'subscription';
/** How the narrator learns the call was heard before the answer arrives. `na` is a mount-time load that has no control to acknowledge. */
type Acknowledgment = 'na' | 'none' | 'disabled' | 'pending' | 'dialog' | 'inline';
/** What stops a second call while the first is running. `host` means the host refuses a second start and says so. */
type Guard = 'na' | 'none' | 'disabled' | 'pending' | 'dialog' | 'host';
/** How the narrator is told it finished. */
type Completion = 'na' | 'ui' | 'toast' | 'dialog' | 'poll' | 'event';
/** Where a failure shows up. `silent` and `unhandled` are the ones the standard forbids for a narrator's action. */
type FailurePath = 'na' | 'toast' | 'inline' | 'dialog' | 'silent' | 'unhandled';
/** Whether the outcome is still visible after the narrator leaves the page the action started on. */
type SurvivesNavigation = 'yes' | 'no' | 'na';
/**
 * `ok` meets the standard. `gap` does not, and its `plan` says who fixes it (an issue, `#123`).
 * `owned` belongs to another piece of work named in `plan`. `exempt` is on purpose and `note` says why (a mount-time load with a page error state, a diagnostic
 * that must never throw).
 */
type Verdict = 'ok' | 'gap' | 'owned' | 'exempt';

export type FeedbackRow = {
  trigger: Trigger;
  cost: Cost;
  acknowledgment: Acknowledgment;
  guard: Guard;
  completion: Completion;
  failure: FailurePath;
  survivesNavigation: SurvivesNavigation;
  verdict: Verdict;
  plan?: string;
  note: string;
};

const row = (
  trigger: Trigger,
  cost: Cost,
  acknowledgment: Acknowledgment,
  guard: Guard,
  completion: Completion,
  failure: FailurePath,
  survivesNavigation: SurvivesNavigation,
  verdict: Verdict,
  note: string,
  plan?: string,
): FeedbackRow => ({ trigger, cost, acknowledgment, guard, completion, failure, survivesNavigation, verdict, plan, note });

// Shorthands for the rows that repeat.
const startup = (note: string) => row('mount', 'file-io', 'na', 'na', 'ui', 'inline', 'na', 'exempt', note);
const subscription = (note: string) => row('mount', 'subscription', 'na', 'na', 'event', 'na', 'na', 'exempt', note);

// One row per line keeps the table readable and the file short.
// prettier-ignore
export const FEEDBACK_CATALOG: Record<string, FeedbackRow> = {
  // App.tsx
  'src/App.tsx::bootstrap#1': row('event', 'file-io', 'na', 'na', 'ui', 'toast', 'na', 'ok', 'refreshBootstrap catches its own failure and says so (phase 6); every caller runs it from an event or a `void`.'),
  'src/App.tsx::ready#1': startup('Startup: the startup screen shows the error and Retry.'),
  'src/App.tsx::bootstrap#2': startup('Startup: the startup screen shows the error and Retry.'),
  'src/App.tsx::reportClientDiagnostic#1': row('effect', 'file-io', 'na', 'na', 'na', 'silent', 'na', 'exempt', 'A diagnostic must never throw or show a second error while one is already being reported.'),
  'src/App.tsx::reportClientDiagnostic#2': row('event', 'file-io', 'na', 'na', 'na', 'silent', 'na', 'exempt', 'A diagnostic must never throw or show a second error while one is already being reported.'),
  'src/App.tsx::reportClientDiagnostic#3': row('event', 'file-io', 'na', 'na', 'na', 'silent', 'na', 'exempt', 'A diagnostic must never throw or show a second error while one is already being reported.'),
  'src/App.tsx::subscribeTranscript#1': subscription('The transcript state event.'),
  'src/App.tsx::subscribeJobEnded#1': subscription('A host job that ends becomes a toast for the jobs that can finish elsewhere (ADR 0076).'),
  'src/App.tsx::subscribeNotices#1': subscription('Host notices (a file kept aside) become toasts.'),
  'src/App.tsx::subscribeUpdate#1': subscription('The update check finding a newer release becomes one toast.'),
  'src/App.tsx::subscribeLiveUpdateHealth#1': subscription('Degraded live updates become one toast.'),
  'src/App.tsx::subscribeProjectAttach#1': subscription('A project attach refreshes the bootstrap or shows why it was refused.'),
  'src/App.tsx::settingsForScope#1': row('mount', 'file-io', 'na', 'na', 'ui', 'silent', 'na', 'exempt', 'Cosmetic: the narrator\'s entity colours; the built-in colours stay if the settings cannot be read, and Settings reports the real error.'),
  'src/App.tsx::transcriptReset#1': row('click', 'instant', 'na', 'na', 'na', 'silent', 'na', 'exempt', 'Best effort when leaving Proofing: a reset that fails leaves the finished results in place, which is harmless.'),

  // Home
  'src/components/home/AudiobookEstimatePanel.tsx::manuscriptChapters#1': row('mount', 'file-io', 'na', 'na', 'ui', 'toast', 'na', 'ok', 'A failed load empties the estimate and says why, instead of reading as a manuscript with no chapters (phase 6).'),
  'src/components/home/AudiobookEstimatePanel.tsx::manuscriptSetChapterStatus#1': row('input', 'file-io', 'none', 'none', 'ui', 'toast', 'na', 'ok', 'A small file write; the select shows the new status when it returns.'),
  'src/components/home/Home.tsx::guideEntities#1': row('mount', 'file-io', 'na', 'na', 'ui', 'silent', 'na', 'exempt', 'Only decides whether the "entries need review" nudge shows; without it the nudge is absent.'),
  'src/components/home/Home.tsx::transcriptLastCompleted#1': row('mount', 'file-io', 'na', 'na', 'ui', 'silent', 'na', 'exempt', 'Only fills the last-run card, which is empty when the run cannot be read.'),
  'src/components/home/Home.tsx::manuscriptImportState#1': row('timer', 'instant', 'dialog', 'dialog', 'poll', 'dialog', 'no', 'ok', 'The import dialog is modal, so the narrator cannot leave Home while it runs; a job-end event carries the outcome for the notifier (ADR 0076).'),
  'src/components/home/Home.tsx::manuscriptImportPreview#1': row('click', 'job', 'dialog', 'host', 'poll', 'dialog', 'no', 'ok', 'Modal import dialog with real progress; the host refuses a second run.'),
  'src/components/home/Home.tsx::manuscriptImportCommit#1': row('click', 'job', 'dialog', 'host', 'poll', 'dialog', 'no', 'ok', 'Modal import dialog with real progress; a job-end event carries the outcome (ADR 0076).'),
  'src/components/home/Home.tsx::selectManuscript#1': row('click', 'os-dialog', 'pending', 'pending', 'ui', 'toast', 'no', 'ok', 'One choose-a-file button for import and replace: busy while the host dialog is open, so a second press cannot open a second dialog, and a failure is a toast (phase 6).'),
  'src/components/home/Home.tsx::manuscriptBeginImport#1': row('click', 'instant', 'none', 'none', 'dialog', 'toast', 'no', 'ok', 'Instant: it only registers the detected file; the import dialog follows.'),
  'src/components/home/Home.tsx::manuscriptImportCancel#1': row('click', 'instant', 'none', 'none', 'ui', 'toast', 'no', 'ok', 'Instant: it only marks the import cancelled.'),
  'src/components/home/Home.tsx::manuscriptImportPreview#2': row('input', 'job', 'dialog', 'host', 'poll', 'toast', 'no', 'ok', 'A new heading level re-runs the preview inside the same dialog with progress.'),
  'src/components/home/Home.tsx::manuscriptImportCancel#2': row('click', 'instant', 'none', 'none', 'ui', 'toast', 'no', 'ok', 'Cancel from the progress dialog: a refused cancel is now a toast (phase 6).'),

  // Manuscript
  'src/components/manuscript/Manuscript.tsx::readerStateSave#1': row('effect', 'file-io', 'na', 'na', 'ui', 'toast', 'na', 'ok', 'A small file write on every reader change; the reader has already moved.'),
  'src/components/manuscript/Manuscript.tsx::manuscriptChapters#1': row('mount', 'file-io', 'na', 'na', 'ui', 'inline', 'na', 'exempt', 'The page shows a load error with Retry (ADR 0069).'),
  'src/components/manuscript/Manuscript.tsx::guideEntities#1': row('mount', 'file-io', 'na', 'na', 'ui', 'inline', 'na', 'exempt', 'Loaded with the chapters: the page shows a load error with Retry.'),
  'src/components/manuscript/Manuscript.tsx::readerState#1': row('mount', 'file-io', 'na', 'na', 'ui', 'inline', 'na', 'exempt', 'Loaded with the chapters: the page shows a load error with Retry.'),
  'src/components/manuscript/Manuscript.tsx::noteList#1': row('mount', 'file-io', 'na', 'na', 'ui', 'inline', 'na', 'exempt', 'Loaded with the chapters: the page shows a load error with Retry.'),
  'src/components/manuscript/Manuscript.tsx::manuscriptParagraphs#1': row('effect', 'file-io', 'inline', 'na', 'ui', 'toast', 'na', 'ok', 'The chapter shows a loading state while its lines load.'),
  'src/components/manuscript/Manuscript.tsx::readerBookmarkDelete#1': row('click', 'file-io', 'none', 'none', 'ui', 'toast', 'na', 'ok', 'A small file write.'),
  'src/components/manuscript/Manuscript.tsx::readerBookmarkCreate#1': row('click', 'file-io', 'none', 'none', 'ui', 'toast', 'na', 'ok', 'A small file write.'),
  'src/components/manuscript/Manuscript.tsx::manuscriptSearch#1': row('input', 'file-io', 'none', 'na', 'ui', 'toast', 'na', 'ok', 'About 3 ms on a 90,000 word manuscript (docs/research/interaction-latency-baseline.md); a stale answer is dropped.'),
  'src/components/manuscript/Manuscript.tsx::noteCreate#1': row('click', 'file-io', 'none', 'none', 'toast', 'toast', 'na', 'ok', 'A small file write.'),
  'src/components/manuscript/Manuscript.tsx::noteDelete#1': row('click', 'file-io', 'none', 'none', 'toast', 'toast', 'na', 'ok', 'A small file write.'),
  'src/components/manuscript/Manuscript.tsx::guideCreate#1': row('click', 'python', 'pending', 'pending', 'ui', 'toast', 'no', 'ok', '"Add to Story Bible" shows the button busy while the entry is created (a Python process, about 0.6 s), ignores a second press and shows a failure (phase 3).'),
  'src/components/manuscript/Manuscript.tsx::readerBookmarkDelete#2': row('click', 'file-io', 'none', 'none', 'ui', 'toast', 'na', 'ok', 'A small file write.'),

  // Project picker: every action runs through runAction, which sets busy, catches and shows the reason.
  'src/components/project/ProjectPicker.tsx::projectRecents#1': row('mount', 'file-io', 'na', 'na', 'ui', 'inline', 'na', 'exempt', 'An unreadable list shows as an empty one with the picker still usable.'),
  'src/components/project/ProjectPicker.tsx::switchProject#1': row('click', 'file-io', 'disabled', 'disabled', 'ui', 'inline', 'na', 'ok', 'runAction: busy while it runs, the reason shown on failure. The model for the shared hook.'),
  'src/components/project/ProjectPicker.tsx::removeRecentProject#1': row('click', 'file-io', 'disabled', 'disabled', 'ui', 'inline', 'na', 'ok', 'runAction.'),
  'src/components/project/ProjectPicker.tsx::selectProjectFolder#1': row('click', 'os-dialog', 'disabled', 'disabled', 'ui', 'inline', 'na', 'ok', 'runAction.'),
  'src/components/project/ProjectPicker.tsx::switchProject#2': row('click', 'file-io', 'disabled', 'disabled', 'ui', 'inline', 'na', 'ok', 'runAction.'),
  'src/components/project/ProjectPicker.tsx::selectProjectFolder#2': row('click', 'os-dialog', 'disabled', 'disabled', 'ui', 'inline', 'na', 'ok', 'runAction.'),
  'src/components/project/ProjectPicker.tsx::createProject#1': row('click', 'file-io', 'disabled', 'disabled', 'ui', 'inline', 'na', 'ok', 'runAction.'),

  // Proofing
  'src/components/proofing/Results.tsx::transcriptExportMarkers#1': row('click', 'job', 'disabled', 'disabled', 'ui', 'toast', 'na', 'ok', 'The button turns into "Exporting…" and disables from the transcript state event.'),
  'src/components/proofing/Results.tsx::transcriptJump#1': row('click', 'instant', 'none', 'none', 'ui', 'toast', 'na', 'ok', 'A failed jump (REAPER not running) is a toast (phase 6).'),
  'src/components/proofing/Results.tsx::transcriptAddEquivalence#1': row('click', 'file-io', 'none', 'none', 'toast', 'toast', 'na', 'ok', 'A small file write; the toast is the result.'),
  'src/components/proofing/Transcript.tsx::transcriptHints#1': row('mount', 'file-io', 'na', 'na', 'ui', 'toast', 'na', 'ok', 'A failed load says so; the page stays usable.'),
  'src/components/proofing/Transcript.tsx::settingsForScope#1': row('mount', 'file-io', 'na', 'na', 'ui', 'silent', 'na', 'exempt', 'Reads the last model and chunk choice; the defaults stay usable and Settings reports a real error.'),
  'src/components/proofing/Transcript.tsx::transcriptLastCompleted#1': row('mount', 'file-io', 'na', 'na', 'ui', 'silent', 'na', 'exempt', 'Only offers to review the last run; without it the offer is absent.'),
  'src/components/proofing/Transcript.tsx::transcriptSaveHints#1': row('click', 'file-io', 'none', 'none', 'ui', 'toast', 'na', 'ok', 'A small file write; the list has already changed.'),
  'src/components/proofing/Transcript.tsx::transcriptSuggestHints#1': row('click', 'file-io', 'none', 'none', 'toast', 'toast', 'na', 'ok', 'Derived from the Story Bible in Go: fast, and the toast is the result.'),
  'src/components/proofing/Transcript.tsx::transcriptStart#1': row('click', 'job', 'dialog', 'host', 'toast', 'toast', 'yes', 'ok', 'The phase moves to preparing from the state event and the host refuses a second run. Its end is announced by a job-end event whichever page the narrator is on (ADR 0076).'),
  'src/components/proofing/Transcript.tsx::whisperInstall#1': row('click', 'download', 'dialog', 'host', 'dialog', 'dialog', 'no', 'ok', 'The first-use dialog says Starting at once; the host joins a download that is already running for the same asset (S16), so a second press starts no second one. Real bytes, the check, Cancel while bytes arrive, and a failure sentence in the dialog, through useAssetInstall.'),
  'src/components/proofing/Transcript.tsx::whisperInstallState#1': row('timer', 'download', 'dialog', 'na', 'poll', 'dialog', 'no', 'ok', 'The one install-poll loop (useAssetInstall), every 400 ms: the dialog shows the bytes as they arrive, and a failed poll is shown in the dialog. The download outlives the dialog and ends with job:ended.'),
  'src/components/proofing/Transcript.tsx::whisperInstallCancel#1': row('click', 'download', 'dialog', 'dialog', 'dialog', 'dialog', 'no', 'ok', 'Cancel stops the download and the dialog says it was cancelled; it is drawn only while bytes arrive, and a failed cancel is shown in the dialog.'),
  'src/components/proofing/Transcript.tsx::transcriptReset#1': row('click', 'instant', 'none', 'none', 'ui', 'toast', 'na', 'exempt', 'A demo-only button, rendered in the mock build (`import.meta.env.MODE === "mock"`).'),
  'src/components/proofing/Transcript.tsx::transcriptCancel#1': row('click', 'instant', 'pending', 'pending', 'ui', 'toast', 'na', 'ok', 'Cancel is busy until the host answers and a refused cancel is a toast (phase 6).'),
  'src/components/proofing/Transcript.tsx::transcriptReset#2': row('click', 'instant', 'none', 'none', 'ui', 'toast', 'na', 'ok', 'Leaving the results resets the run; a refusal is a toast (phase 6).'),

  // Settings
  'src/components/settings/Settings.tsx::settingsForScope#1': row('mount', 'file-io', 'na', 'na', 'ui', 'toast', 'na', 'ok', 'A failed load shows an error and a toast.'),
  'src/components/settings/Settings.tsx::ttsCatalog#1': row('mount', 'file-io', 'na', 'na', 'ui', 'toast', 'na', 'ok', 'Loaded with the settings.'),
  'src/components/settings/Settings.tsx::whisperCatalog#1': row('mount', 'file-io', 'na', 'na', 'ui', 'toast', 'na', 'ok', 'Loaded with the settings.'),
  'src/components/settings/Settings.tsx::saveSettings#1': row('click', 'file-io', 'none', 'none', 'toast', 'toast', 'na', 'ok', 'Measured at about 3 ms (docs/research/interaction-latency-baseline.md), tier 1: nothing to acknowledge, and a second save writes the same values.'),
  'src/components/settings/Settings.tsx::saveSettings#2': row('click', 'file-io', 'none', 'none', 'toast', 'toast', 'na', 'ok', 'Clearing a project override is the same one-field write, about 3 ms: tier 1.'),
  'src/components/settings/Settings.tsx::clearProjectData#1': row('click', 'file-io', 'pending', 'pending', 'toast', 'toast', 'no', 'ok', 'The confirm stays open and busy until the files are removed, and cannot be confirmed twice (phase 6).'),
  'src/components/settings/Settings.tsx::ttsRemove#1': row('click', 'file-io', 'pending', 'pending', 'toast', 'toast', 'no', 'ok', 'The confirm stays open and busy until the voice is removed (phase 6).'),
  'src/components/settings/Settings.tsx::whisperRemove#1': row('click', 'file-io', 'pending', 'pending', 'toast', 'toast', 'no', 'ok', 'The confirm stays open and busy until the model is removed (phase 6).'),

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

  // Story Bible
  'src/components/storybible/Guide.tsx::guideEntities#1': row('mount', 'file-io', 'na', 'na', 'ui', 'inline', 'na', 'exempt', 'The first load shows a load error with Retry; a later one is a toast.'),
  'src/components/storybible/Guide.tsx::guideBuildState#1': row('mount', 'instant', 'dialog', 'na', 'poll', 'toast', 'yes', 'ok', 'Shows the rebuild dialog again when the narrator comes back to the page while it still runs.'),
  'src/components/storybible/Guide.tsx::guideBuildState#2': row('timer', 'instant', 'dialog', 'dialog', 'event', 'dialog', 'yes', 'ok', 'The dialog polls for progress only while it is open; the end is announced by the job:ended event, so leaving the page or dismissing the dialog loses nothing (ADR 0076).'),
  'src/components/storybible/Guide.tsx::subscribeJobEnded#1': subscription('A rebuild that ends while the dialog is dismissed still refreshes the entries.'),
  'src/components/storybible/Guide.tsx::assetsInstall#1': row('click', 'download', 'dialog', 'host', 'dialog', 'dialog', 'no', 'ok', 'The language model download of the Story Bible build: the same first-use flow as the voice and Whisper downloads (useAssetInstall), and the host joins a download that is already running.'),
  'src/components/storybible/Guide.tsx::assetsInstallState#1': row('timer', 'download', 'dialog', 'na', 'poll', 'dialog', 'no', 'ok', 'The one install-poll loop (useAssetInstall): the dialog shows the bytes as they arrive and a failed poll in the dialog.'),
  'src/components/storybible/Guide.tsx::assetsInstallCancel#1': row('click', 'download', 'dialog', 'dialog', 'dialog', 'dialog', 'no', 'ok', 'Cancel stops the download and the dialog says so; it is drawn only while bytes arrive.'),
  'src/components/storybible/Guide.tsx::guideBuild#1': row('click', 'job', 'pending', 'pending', 'event', 'toast', 'no', 'ok', 'The build button is busy while the start call runs and a second press cannot start a second rebuild; the dialog and the job-end event follow (phase 3).'),
  'src/components/storybible/GuideDetail.tsx::guidePreview#1': row('click', 'python', 'pending', 'pending', 'toast', 'toast', 'na', 'ok', 'The play button is busy while an uncached preview renders (a Python process that loads a voice) and only one render runs at a time (phase 3).'),
  'src/components/storybible/GuideDetail.tsx::guideEdit#1': row('click', 'python', 'pending', 'pending', 'toast', 'toast', 'na', 'ok', 'Save and the alias buttons run one at a time through usePendingAction: the control that was pressed is busy, the others (and the category menu) are off until it ends, a failure is a toast (phase 3). A Save is one process (phase 4).'),
  'src/components/storybible/GuideDetail.tsx::ttsInstall#1': row('click', 'download', 'dialog', 'host', 'dialog', 'dialog', 'no', 'ok', 'The first-use dialog says Starting at once; the host joins a download that is already running for the same asset (S16), so a second press starts no second one. Real bytes, the check, Cancel while bytes arrive, and a failure sentence in the dialog, through useAssetInstall.'),
  'src/components/storybible/GuideDetail.tsx::ttsInstallState#1': row('timer', 'download', 'dialog', 'na', 'poll', 'dialog', 'no', 'ok', 'The one install-poll loop (useAssetInstall), every 400 ms: the dialog shows the bytes as they arrive, and a failed poll is shown in the dialog. The download outlives the dialog and ends with job:ended.'),
  'src/components/storybible/GuideDetail.tsx::ttsInstallCancel#1': row('click', 'download', 'dialog', 'dialog', 'dialog', 'dialog', 'no', 'ok', 'Cancel stops the download and the dialog says it was cancelled; it is drawn only while bytes arrive, and a failed cancel is shown in the dialog.'),
  'src/components/storybible/GuideDetail.tsx::guideCreate#1': row('click', 'python', 'pending', 'pending', 'toast', 'toast', 'na', 'ok', 'Choosing a category creates the entry through usePendingAction: one at a time, the category menu is off until it ends, a failure is a toast (phase 3).'),
  'src/components/storybible/GuideDetail.tsx::guideRescan#1': row('click', 'python', 'pending', 'pending', 'toast', 'toast', 'na', 'ok', 'Busy while it runs, one at a time (phase 3).'),
  'src/components/storybible/GuideDetail.tsx::guidePronounce#1': row('click', 'python', 'pending', 'pending', 'toast', 'toast', 'na', 'ok', "Choosing CMU or eSpeak from the Generate/Replace menu runs pronounce() through usePendingAction: busy one at a time, a failure (e.g. the engine has nothing for the name) is a toast and the control stays usable to retry (story bible entries phase 3, D13)."),
  'src/components/storybible/GuideDetail.tsx::guideSetLocked#1': row('click', 'python', 'pending', 'pending', 'toast', 'toast', 'na', 'ok', 'Busy while it runs, one at a time (phase 3).'),
  'src/components/storybible/GuideDetail.tsx::guideUnrelate#1': row('click', 'python', 'pending', 'pending', 'toast', 'toast', 'na', 'ok', 'Busy on the row that was pressed, one at a time (phase 3).'),
  'src/components/storybible/GuideDetail.tsx::guideRelate#1': row('click', 'python', 'pending', 'pending', 'toast', 'toast', 'na', 'ok', 'Busy while it runs, one at a time (phase 3).'),
  'src/components/storybible/GuideDetail.tsx::guideDelete#1': row('click', 'python', 'pending', 'pending', 'toast', 'toast', 'na', 'ok', 'The confirm dialog stays open and busy until the delete ends and cannot be cancelled away (phase 3).'),
  'src/components/storybible/GuideDetail.tsx::guideMerge#1': row('click', 'python', 'pending', 'pending', 'toast', 'toast', 'na', 'ok', 'The confirm dialog stays open and busy until the merge ends and cannot be cancelled away (phase 3).'),

  // Teleprompter
  'src/components/teleprompter/TeleprompterPage.tsx::subscribeTeleprompterEvent#1': subscription('The live session events.'),
  'src/components/teleprompter/TeleprompterPage.tsx::subscribeTeleprompterState#1': subscription('The live session state.'),
  'src/components/teleprompter/TeleprompterPage.tsx::teleprompterState#1': row('mount', 'instant', 'na', 'na', 'ui', 'silent', 'na', 'exempt', 'Hydrates a session that was already running; the state event follows anyway.'),
  'src/components/teleprompter/TeleprompterPage.tsx::teleprompterDevices#1': row('effect', 'python', 'na', 'disabled', 'ui', 'inline', 'na', 'ok', 'Loads the device list on mount and again on a manual Refresh click in the picker (disabled while a listing is already in flight); a listing failure shows inline instead of blocking Start with a previously-chosen device (the host never fails this call outright).'),
  'src/components/teleprompter/TeleprompterPage.tsx::settingsForScope#1': row('effect', 'file-io', 'na', 'na', 'ui', 'silent', 'na', 'exempt', 'Loads the persisted microphone (docs/prds/teleprompter-engines-and-input-devices.prd.md Phase 2) and runs the one-time browser-storage migration; if it fails the field just starts empty, exactly as it did before Phase 2.'),
  'src/components/teleprompter/TeleprompterPage.tsx::manuscriptChapters#1': row('mount', 'file-io', 'na', 'na', 'ui', 'inline', 'na', 'ok', 'An inline error.'),
  'src/components/teleprompter/TeleprompterPage.tsx::readerState#1': row('mount', 'file-io', 'na', 'na', 'ui', 'silent', 'na', 'exempt', 'Only picks the chapter the narrator last read; the first chapter is used without it.'),
  'src/components/teleprompter/TeleprompterPage.tsx::manuscriptParagraphs#1': row('effect', 'file-io', 'na', 'na', 'ui', 'inline', 'na', 'ok', 'An inline error.'),
  'src/components/teleprompter/TeleprompterPage.tsx::teleprompterStart#1': row('click', 'job', 'disabled', 'host', 'ui', 'inline', 'no', 'ok', 'The state event moves the page to "starting" and disables Start; the host refuses a second session.'),
  'src/components/teleprompter/TeleprompterPage.tsx::teleprompterStop#1': row('click', 'job', 'none', 'none', 'ui', 'inline', 'no', 'ok', 'The state event moves the page on; an inline error otherwise.'),
  'src/components/teleprompter/TeleprompterPage.tsx::whisperInstall#1': row('click', 'download', 'dialog', 'host', 'dialog', 'dialog', 'no', 'ok', 'The first-use dialog says Starting at once; the host joins a download that is already running for the same asset (S16), so a second press starts no second one. Real bytes, the check, Cancel while bytes arrive, and a failure sentence in the dialog, through useAssetInstall.'),
  'src/components/teleprompter/TeleprompterPage.tsx::whisperInstallState#1': row('timer', 'download', 'dialog', 'na', 'poll', 'dialog', 'no', 'ok', 'The one install-poll loop (useAssetInstall), every 400 ms: the dialog shows the bytes as they arrive, and a failed poll is shown in the dialog. The download outlives the dialog and ends with job:ended.'),
  'src/components/teleprompter/TeleprompterPage.tsx::whisperInstallCancel#1': row('click', 'download', 'dialog', 'dialog', 'dialog', 'dialog', 'no', 'ok', 'Cancel stops the download and the dialog says it was cancelled; it is drawn only while bytes arrive, and a failed cancel is shown in the dialog.'),
  'src/components/teleprompter/TeleprompterPage.tsx::saveSettings#1': row('effect', 'file-io', 'na', 'na', 'ui', 'silent', 'na', 'exempt', 'The one-time browser-storage-to-settings migration write; a failure leaves the device in local state for this visit and the migration is retried next load since the settings value never got marked set.'),
  'src/components/teleprompter/TeleprompterPage.tsx::saveSettings#2': row('input', 'file-io', 'none', 'none', 'ui', 'inline', 'no', 'ok', 'The chosen microphone (global settings, docs/prds/teleprompter-engines-and-input-devices.prd.md Phase 2) is saved as it is picked or typed; a save failure shows as the page inline error, and the value picked stays selected in the field either way.'),

  // Tracks
  'src/components/tracks/TracksPage.tsx::tracksDiscover#1': row('mount', 'file-io', 'na', 'na', 'ui', 'inline', 'na', 'ok', 'An inline error.'),
  'src/components/tracks/TracksPage.tsx::tracksList#1': row('effect', 'file-io', 'na', 'na', 'ui', 'inline', 'na', 'ok', 'Parsing a 100 KB project file takes about 2 ms (docs/research/interaction-latency-baseline.md).'),
  'src/components/tracks/TracksPage.tsx::tracksSelect#1': row('click', 'file-io', 'none', 'none', 'ui', 'inline', 'na', 'ok', 'A small file write.'),
};

/**
 * The bare catches (`catch {}`, `.catch(() => {})`, `.catch(() => undefined)`) that were reviewed and are safe, keyed `<file>#<n>` in source order, each with why.
 * The list may only shrink: a new one needs a reason a reviewer accepts, and a narrator's action never belongs here.
 */
export const SILENT_CATCHES: Record<string, string> = {
  'src/api/wailsClient.ts#1': 'The diagnostic report itself: a report that fails must not raise a second error over the one being reported.',
  'src/api/wailsClient.ts#2': 'The host binding is missing (not running inside the desktop app), so there is nothing to report to.',
  'src/App.tsx#1': 'A diagnostic report while showing the startup error; it must not throw over it.',
  'src/App.tsx#2': 'The window error handler reports a diagnostic; a failing report must not raise another window error.',
  'src/App.tsx#3': 'The unhandled-rejection handler reports a diagnostic; a failing report must not raise another rejection.',
  'src/App.tsx#4': "Cosmetic: the narrator's entity colours. The built-in colours stay if the settings cannot be read, and Settings reports the real error.",
  'src/App.tsx#5': 'Best effort when leaving Proofing: a reset that fails leaves the finished results in place, which is harmless.',
  'src/components/home/Home.tsx#1': 'Only decides whether the "entries need review" nudge shows; without it the nudge is absent.',
  'src/components/proofing/Transcript.tsx#1': 'Reads the last model and chunk choice; the defaults stay usable and Settings reports a real error.',
  'src/components/proofing/Transcript.tsx#2': 'Only offers to review the last run; without it the offer is absent.',
  'src/components/teleprompter/TeleprompterPage.tsx#1':
    'Clearing the migrated browser-storage device once it is written to settings; if storage cannot be reached the stale value is simply left behind and never read again (the settings value now wins).',
  'src/components/teleprompter/TeleprompterPage.tsx#2': 'Hydrates a session that was already running; the state event follows anyway.',
  'src/components/teleprompter/TeleprompterPage.tsx#3':
    'The one-time browser-storage-to-settings migration write; a failure leaves the device in local state for this visit and the migration is retried next load since the settings value never got marked set.',
  'src/components/teleprompter/TeleprompterPage.tsx#4':
    'Loads the persisted device and runs the one-time migration; if it fails the field just starts empty, exactly as it did before Phase 2.',
  'src/components/teleprompter/TeleprompterPage.tsx#5': 'Only picks the chapter the narrator last read; the first chapter is used without it.',
  'src/theme/ThemeContext.tsx#1': 'Remembering the theme in localStorage; the preference just does not persist when storage is disabled.',
};
