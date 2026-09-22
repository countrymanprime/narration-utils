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
 * `ok` meets the standard. `gap` does not, and its `plan` says who fixes it (a phase `P3` to `P6` of the audit while it runs, an issue `#123` once it is filed).
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
const OWNED_INSTALL = 'release-readiness Phase 1 (the install flow and its shared poll hook)';

// One row per line keeps the table readable and the file short.
// prettier-ignore
export const FEEDBACK_CATALOG: Record<string, FeedbackRow> = {
  // App.tsx
  'src/App.tsx::bootstrap#1': row('event', 'file-io', 'na', 'na', 'ui', 'unhandled', 'na', 'gap', 'refreshBootstrap runs from `void`, so a failed refresh is an unhandled rejection.', 'P6'),
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
  'src/components/home/AudiobookEstimatePanel.tsx::manuscriptChapters#1': row('mount', 'file-io', 'na', 'na', 'ui', 'silent', 'na', 'gap', 'A failed load shows an empty estimate as if the manuscript had no chapters.', 'P6'),
  'src/components/home/AudiobookEstimatePanel.tsx::manuscriptSetChapterStatus#1': row('input', 'file-io', 'none', 'none', 'ui', 'toast', 'na', 'ok', 'A small file write; the select shows the new status when it returns.'),
  'src/components/home/Home.tsx::guideEntities#1': row('mount', 'file-io', 'na', 'na', 'ui', 'silent', 'na', 'exempt', 'Only decides whether the "entries need review" nudge shows; without it the nudge is absent.'),
  'src/components/home/Home.tsx::transcriptLastCompleted#1': row('mount', 'file-io', 'na', 'na', 'ui', 'silent', 'na', 'exempt', 'Only fills the last-run card, which is empty when the run cannot be read.'),
  'src/components/home/Home.tsx::manuscriptImportState#1': row('timer', 'instant', 'dialog', 'dialog', 'poll', 'dialog', 'no', 'ok', 'The import dialog is modal, so the narrator cannot leave Home while it runs; a job-end event carries the outcome for the notifier (ADR 0076).'),
  'src/components/home/Home.tsx::manuscriptImportPreview#1': row('click', 'job', 'dialog', 'host', 'poll', 'dialog', 'no', 'ok', 'Modal import dialog with real progress; the host refuses a second run.'),
  'src/components/home/Home.tsx::manuscriptImportCommit#1': row('click', 'job', 'dialog', 'host', 'poll', 'dialog', 'no', 'ok', 'Modal import dialog with real progress; a job-end event carries the outcome (ADR 0076).'),
  'src/components/home/Home.tsx::selectManuscript#1': row('click', 'os-dialog', 'none', 'none', 'ui', 'unhandled', 'no', 'gap', 'The file dialog can fail and nothing catches it; two clicks open two dialogs.', 'P6'),
  'src/components/home/Home.tsx::selectManuscript#2': row('click', 'os-dialog', 'none', 'none', 'ui', 'unhandled', 'no', 'gap', 'The file dialog can fail and nothing catches it; two clicks open two dialogs.', 'P6'),
  'src/components/home/Home.tsx::manuscriptBeginImport#1': row('click', 'instant', 'none', 'none', 'dialog', 'toast', 'no', 'ok', 'Instant: it only registers the detected file; the import dialog follows.'),
  'src/components/home/Home.tsx::manuscriptImportCancel#1': row('click', 'instant', 'none', 'none', 'ui', 'toast', 'no', 'ok', 'Instant: it only marks the import cancelled.'),
  'src/components/home/Home.tsx::manuscriptImportPreview#2': row('input', 'job', 'dialog', 'host', 'poll', 'toast', 'no', 'ok', 'A new heading level re-runs the preview inside the same dialog with progress.'),
  'src/components/home/Home.tsx::manuscriptImportCancel#2': row('click', 'instant', 'none', 'none', 'ui', 'unhandled', 'no', 'gap', 'Cancel from the progress dialog has no catch: a refused cancel is an unhandled rejection.', 'P6'),

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
  'src/components/proofing/Results.tsx::transcriptJump#1': row('click', 'instant', 'none', 'none', 'ui', 'unhandled', 'na', 'gap', 'A failed jump (REAPER not running) is an unhandled rejection: nothing tells the narrator.', 'P6'),
  'src/components/proofing/Results.tsx::transcriptAddEquivalence#1': row('click', 'file-io', 'none', 'none', 'toast', 'toast', 'na', 'ok', 'A small file write; the toast is the result.'),
  'src/components/proofing/Transcript.tsx::transcriptHints#1': row('mount', 'file-io', 'na', 'na', 'ui', 'toast', 'na', 'ok', 'A failed load says so; the page stays usable.'),
  'src/components/proofing/Transcript.tsx::settingsForScope#1': row('mount', 'file-io', 'na', 'na', 'ui', 'silent', 'na', 'exempt', 'Reads the last model and chunk choice; the defaults stay usable and Settings reports a real error.'),
  'src/components/proofing/Transcript.tsx::transcriptLastCompleted#1': row('mount', 'file-io', 'na', 'na', 'ui', 'silent', 'na', 'exempt', 'Only offers to review the last run; without it the offer is absent.'),
  'src/components/proofing/Transcript.tsx::transcriptSaveHints#1': row('click', 'file-io', 'none', 'none', 'ui', 'toast', 'na', 'ok', 'A small file write; the list has already changed.'),
  'src/components/proofing/Transcript.tsx::transcriptSuggestHints#1': row('click', 'file-io', 'none', 'none', 'toast', 'toast', 'na', 'ok', 'Derived from the Story Bible in Go: fast, and the toast is the result.'),
  'src/components/proofing/Transcript.tsx::transcriptStart#1': row('click', 'job', 'dialog', 'host', 'toast', 'toast', 'yes', 'ok', 'The phase moves to preparing from the state event and the host refuses a second run. Its end is announced by a job-end event whichever page the narrator is on (ADR 0076).'),
  'src/components/proofing/Transcript.tsx::whisperInstall#1': row('click', 'download', 'dialog', 'disabled', 'dialog', 'toast', 'no', 'owned', 'The download flow; its progress and poll hook are not this audit\'s.', OWNED_INSTALL),
  'src/components/proofing/Transcript.tsx::whisperInstallState#1': row('timer', 'download', 'dialog', 'na', 'poll', 'toast', 'no', 'owned', 'The download poll loop, one of three copies.', OWNED_INSTALL),
  'src/components/proofing/Transcript.tsx::whisperInstallCancel#1': row('click', 'download', 'none', 'none', 'dialog', 'toast', 'no', 'owned', 'Cancel of the download.', OWNED_INSTALL),
  'src/components/proofing/Transcript.tsx::transcriptReset#1': row('click', 'instant', 'none', 'none', 'ui', 'unhandled', 'na', 'exempt', 'A demo-only button, rendered in the mock build (`import.meta.env.MODE === "mock"`).'),
  'src/components/proofing/Transcript.tsx::transcriptCancel#1': row('click', 'instant', 'none', 'none', 'ui', 'unhandled', 'na', 'gap', 'Cancel gives no sign it was heard and a refused cancel is an unhandled rejection.', 'P6'),
  'src/components/proofing/Transcript.tsx::transcriptReset#2': row('click', 'instant', 'none', 'none', 'ui', 'unhandled', 'na', 'gap', 'Leaving the results calls a reset that has no catch.', 'P6'),

  // Settings
  'src/components/settings/Settings.tsx::settingsForScope#1': row('mount', 'file-io', 'na', 'na', 'ui', 'toast', 'na', 'ok', 'A failed load shows an error and a toast.'),
  'src/components/settings/Settings.tsx::ttsCatalog#1': row('mount', 'file-io', 'na', 'na', 'ui', 'toast', 'na', 'ok', 'Loaded with the settings.'),
  'src/components/settings/Settings.tsx::whisperCatalog#1': row('mount', 'file-io', 'na', 'na', 'ui', 'toast', 'na', 'ok', 'Loaded with the settings.'),
  'src/components/settings/Settings.tsx::saveSettings#1': row('click', 'file-io', 'none', 'none', 'toast', 'toast', 'na', 'gap', 'A settings file write with no in-flight state; measure it and add pending only if it is over 100 ms.', 'P6'),
  'src/components/settings/Settings.tsx::saveSettings#2': row('click', 'file-io', 'none', 'none', 'toast', 'toast', 'na', 'gap', 'Clearing a project override: same as Save.', 'P6'),
  'src/components/settings/Settings.tsx::clearProjectData#1': row('click', 'file-io', 'none', 'none', 'toast', 'toast', 'no', 'gap', 'The confirm stays clickable while the files are removed, so it can be confirmed twice.', 'P6'),
  'src/components/settings/Settings.tsx::ttsRemove#1': row('click', 'file-io', 'none', 'none', 'toast', 'toast', 'no', 'gap', 'The confirm stays clickable while the voice is removed.', 'P6'),
  'src/components/settings/Settings.tsx::whisperRemove#1': row('click', 'file-io', 'none', 'none', 'toast', 'toast', 'no', 'gap', 'The confirm stays clickable while the model is removed.', 'P6'),
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
  'src/components/storybible/Guide.tsx::guideBuild#1': row('click', 'job', 'pending', 'pending', 'event', 'toast', 'no', 'ok', 'The build button is busy while the start call runs and a second press cannot start a second rebuild; the dialog and the job-end event follow (phase 3).'),
  'src/components/storybible/GuideDetail.tsx::guidePreview#1': row('click', 'python', 'pending', 'pending', 'toast', 'toast', 'na', 'ok', 'The play button is busy while an uncached preview renders (a Python process that loads a voice) and only one render runs at a time (phase 3).'),
  'src/components/storybible/GuideDetail.tsx::guideEdit#1': row('click', 'python', 'pending', 'pending', 'toast', 'toast', 'na', 'ok', 'Save and the alias buttons run one at a time through usePendingAction: the control that was pressed is busy, the others (and the category menu) are off until it ends, a failure is a toast (phase 3). The four spawns per Save are phase 4.'),
  'src/components/storybible/GuideDetail.tsx::ttsInstall#1': row('click', 'download', 'dialog', 'disabled', 'dialog', 'toast', 'no', 'owned', 'The voice install flow. The job phase now matches the host (found and fixed by stack S08); real byte progress and a guard against a second install job are not there yet.', OWNED_INSTALL),
  'src/components/storybible/GuideDetail.tsx::ttsInstallState#1': row('timer', 'download', 'dialog', 'na', 'poll', 'toast', 'no', 'owned', 'The download poll loop, one of three copies.', OWNED_INSTALL),
  'src/components/storybible/GuideDetail.tsx::ttsInstallCancel#1': row('click', 'download', 'none', 'none', 'dialog', 'toast', 'no', 'owned', 'Cancel of the download.', OWNED_INSTALL),
  'src/components/storybible/GuideDetail.tsx::guideCreate#1': row('click', 'python', 'pending', 'pending', 'toast', 'toast', 'na', 'ok', 'Choosing a category creates the entry through usePendingAction: one at a time, the category menu is off until it ends, a failure is a toast (phase 3).'),
  'src/components/storybible/GuideDetail.tsx::guideRescan#1': row('click', 'python', 'pending', 'pending', 'toast', 'toast', 'na', 'ok', 'Busy while it runs, one at a time (phase 3).'),
  'src/components/storybible/GuideDetail.tsx::guideSetLocked#1': row('click', 'python', 'pending', 'pending', 'toast', 'toast', 'na', 'ok', 'Busy while it runs, one at a time (phase 3).'),
  'src/components/storybible/GuideDetail.tsx::guideUnrelate#1': row('click', 'python', 'pending', 'pending', 'toast', 'toast', 'na', 'ok', 'Busy on the row that was pressed, one at a time (phase 3).'),
  'src/components/storybible/GuideDetail.tsx::guideRelate#1': row('click', 'python', 'pending', 'pending', 'toast', 'toast', 'na', 'ok', 'Busy while it runs, one at a time (phase 3).'),
  'src/components/storybible/GuideDetail.tsx::guideDelete#1': row('click', 'python', 'pending', 'pending', 'toast', 'toast', 'na', 'ok', 'The confirm dialog stays open and busy until the delete ends and cannot be cancelled away (phase 3).'),
  'src/components/storybible/GuideDetail.tsx::guideMerge#1': row('click', 'python', 'pending', 'pending', 'toast', 'toast', 'na', 'ok', 'The confirm dialog stays open and busy until the merge ends and cannot be cancelled away (phase 3).'),

  // Teleprompter
  'src/components/teleprompter/TeleprompterPage.tsx::subscribeTeleprompterEvent#1': subscription('The live session events.'),
  'src/components/teleprompter/TeleprompterPage.tsx::subscribeTeleprompterState#1': subscription('The live session state.'),
  'src/components/teleprompter/TeleprompterPage.tsx::teleprompterState#1': row('mount', 'instant', 'na', 'na', 'ui', 'silent', 'na', 'exempt', 'Hydrates a session that was already running; the state event follows anyway.'),
  'src/components/teleprompter/TeleprompterPage.tsx::manuscriptChapters#1': row('mount', 'file-io', 'na', 'na', 'ui', 'inline', 'na', 'ok', 'An inline error.'),
  'src/components/teleprompter/TeleprompterPage.tsx::readerState#1': row('mount', 'file-io', 'na', 'na', 'ui', 'silent', 'na', 'exempt', 'Only picks the chapter the narrator last read; the first chapter is used without it.'),
  'src/components/teleprompter/TeleprompterPage.tsx::manuscriptParagraphs#1': row('effect', 'file-io', 'na', 'na', 'ui', 'inline', 'na', 'ok', 'An inline error.'),
  'src/components/teleprompter/TeleprompterPage.tsx::teleprompterStart#1': row('click', 'job', 'disabled', 'host', 'ui', 'inline', 'no', 'ok', 'The state event moves the page to "starting" and disables Start; the host refuses a second session.'),
  'src/components/teleprompter/TeleprompterPage.tsx::teleprompterStop#1': row('click', 'job', 'none', 'none', 'ui', 'inline', 'no', 'ok', 'The state event moves the page on; an inline error otherwise.'),
  'src/components/teleprompter/TeleprompterPage.tsx::whisperInstall#1': row('click', 'download', 'dialog', 'disabled', 'dialog', 'inline', 'no', 'owned', 'The download flow, a second copy of the poll loop.', OWNED_INSTALL),
  'src/components/teleprompter/TeleprompterPage.tsx::whisperInstallState#1': row('timer', 'download', 'dialog', 'na', 'poll', 'inline', 'no', 'owned', 'The download poll loop, a second copy.', OWNED_INSTALL),
  'src/components/teleprompter/TeleprompterPage.tsx::whisperInstallCancel#1': row('click', 'download', 'none', 'none', 'dialog', 'inline', 'no', 'owned', 'Cancel of the download.', OWNED_INSTALL),

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
  'src/components/teleprompter/TeleprompterPage.tsx#1': 'Remembering the microphone name in localStorage; the field still works for this visit.',
  'src/components/teleprompter/TeleprompterPage.tsx#2': 'Hydrates a session that was already running; the state event follows anyway.',
  'src/components/teleprompter/TeleprompterPage.tsx#3': 'Only picks the chapter the narrator last read; the first chapter is used without it.',
  'src/theme/ThemeContext.tsx#1': 'Remembering the theme in localStorage; the preference just does not persist when storage is disabled.',
};
