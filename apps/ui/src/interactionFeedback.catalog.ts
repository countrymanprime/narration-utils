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
  'src/App.tsx::systemNotify#1': row('event', 'os-dialog', 'na', 'na', 'na', 'silent', 'na', 'exempt', 'An OS notification is a courtesy, not load-bearing: the host already swallows a failed or unavailable sender (N1-N4), and the app-level toast from the same job:ended event is the record of what happened.'),
  'src/App.tsx::subscribeNotices#1': subscription('Host notices (a file kept aside) become toasts.'),
  'src/App.tsx::subscribeUpdate#1': subscription('The update check finding a newer release becomes one toast.'),
  'src/App.tsx::subscribeLiveUpdateHealth#1': subscription('Degraded live updates become one toast.'),
  'src/App.tsx::subscribeProjectAttach#1': subscription('A project attach refreshes the bootstrap or shows why it was refused.'),
  'src/App.tsx::settingsForScope#1': row('mount', 'file-io', 'na', 'na', 'ui', 'silent', 'na', 'exempt', 'Cosmetic: the narrator\'s entity colours; the built-in colours stay if the settings cannot be read, and Settings reports the real error.'),
  'src/App.tsx::transcriptReset#1': row('click', 'instant', 'na', 'na', 'na', 'silent', 'na', 'exempt', 'Best effort when leaving Proofing: a reset that fails leaves the finished results in place, which is harmless.'),
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

  // Home
  'src/components/home/AudiobookEstimatePanel.tsx::manuscriptChapters#1': row('mount', 'file-io', 'na', 'na', 'ui', 'toast', 'na', 'ok', 'A failed load empties the estimate and says why, instead of reading as a manuscript with no chapters (phase 6).'),
  'src/components/home/AudiobookEstimatePanel.tsx::manuscriptSetChapterStatus#1': row('input', 'file-io', 'none', 'none', 'ui', 'toast', 'na', 'ok', 'A small file write; the select shows the new status when it returns.'),
  'src/components/home/AudiobookEstimatePanel.tsx::subscribeCoverage#1': subscription('The recording check state (recording coverage Phase 6): a row shows the percent of a check sent to the background, and a completed check re-reads the chapters for their measured recordedFraction.'),
  'src/components/home/RecordingCheck.tsx::coverageResult#1': row('mount', 'file-io', 'na', 'na', 'ui', 'inline', 'na', 'ok', 'Reads the chapter\'s stored check when the dialog opens (never runs one, Q14); the dialog says it is reading, and a failure is written in the dialog with Retry.'),
  'src/components/home/RecordingCheck.tsx::coverageStart#1': row('click', 'job', 'pending', 'host', 'event', 'dialog', 'yes', 'ok', 'Check recording is busy until the host answers, then the work dialog shows the host\'s real progress; the host refuses a second check (busy) and a refusal is written in the dialog in plain words. The end is one job:ended the app announces wherever the narrator is (ADR 0076).'),
  'src/components/home/RecordingCheck.tsx::whisperInstall#1': row('click', 'download', 'dialog', 'host', 'dialog', 'dialog', 'no', 'ok', 'The same first-use question and download dialog as Proofing (useAssetInstall): nothing downloads until the narrator says yes, and a successful install goes on with the check.'),
  'src/components/home/RecordingCheck.tsx::whisperInstallState#1': row('timer', 'download', 'dialog', 'na', 'poll', 'dialog', 'no', 'ok', 'The one install-poll loop (useAssetInstall): real bytes in the dialog, and a failed poll is shown there. The download ends with job:ended.'),
  'src/components/home/RecordingCheck.tsx::whisperInstallCancel#1': row('click', 'download', 'dialog', 'dialog', 'dialog', 'dialog', 'no', 'ok', 'Cancel is drawn only while bytes arrive; the dialog says it was cancelled, and a failed cancel is shown in the dialog.'),
  'src/components/home/RecordingCheck.tsx::coverageCancel#1': row('click', 'instant', 'pending', 'pending', 'ui', 'toast', 'na', 'ok', 'A second press is ignored until the host answers; the next state event turns the work dialog to Cancelled, and a failed cancel is a toast.'),
  'src/components/home/RecordingCheck.tsx::tracksList#1': row('mount', 'file-io', 'na', 'na', 'ui', 'inline', 'na', 'ok', 'The REAPER tracks for the chapter-track link shown when a check needs one; the block says it is reading them, and a failure is written in place with a link to the Tracks page.'),
  'src/components/home/RecordingCheck.tsx::chapterTrackMapConfirm#1': row('click', 'file-io', 'pending', 'pending', 'ui', 'inline', 'no', 'ok', 'Confirm on the in-dialog MappingConfirm: busy until the link is written, then the stored result is read again; a failure is written in place.'),
  // The Credits stat (useCreditsSeconds, audiobook-credits-templates.prd.md Phases 2 and 5): a secondary stat, so every read
  // behind it falls back to leaving the stat out (or room tone at 0) rather than a toast over the narration estimate.
  'src/components/home/useCreditsSeconds.ts::creditsTemplates#1': row('mount', 'file-io', 'na', 'na', 'ui', 'inline', 'na', 'exempt', 'Loads the templates behind the Credits stat; a failed load leaves the stat out of the row rather than a toast over a secondary stat.'),
  'src/components/home/useCreditsSeconds.ts::creditsPreview#1': row('effect', 'instant', 'na', 'na', 'ui', 'inline', 'na', 'exempt', 'Renders the first opening and closing template for their word counts; a failed render leaves the Credits stat out.'),
  'src/components/home/useCreditsSeconds.ts::creditsChapterAnnouncements#1': row('effect', 'file-io', 'na', 'na', 'ui', 'inline', 'na', 'exempt', 'Renders the first chapter announcement for every narration chapter (Phase 5, ADR 0151); a failed render leaves the Credits stat out.'),
  'src/components/home/useCreditsSeconds.ts::settingsForScope#1': row('effect', 'file-io', 'na', 'na', 'ui', 'silent', 'na', 'exempt', 'Reads the room tone setting (Phase 5); unreadable, it counts as 0 seconds, the default, and Settings reports the real error.'),
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
  'src/components/home/Home.tsx::settingsForScope#1': row('mount', 'file-io', 'na', 'na', 'ui', 'silent', 'na', 'exempt', 'Only pre-fills the "Build the Story Bible after import" checkbox; the on-by-default (D8) local state stays usable without it.'),
  'src/components/home/Home.tsx::guideBuild#1': row('event', 'job', 'dialog', 'na', 'poll', 'toast', 'no', 'ok', 'B1-B3: chained after a successful import. A "Manuscript imported." toast precedes it, so the narrator is never left wondering whether the import itself worked; a build failure is its own toast and never unmakes the import.'),
  'src/components/home/Home.tsx::guideBuildState#1': row('timer', 'instant', 'dialog', 'na', 'poll', 'dialog', 'no', 'ok', 'Polls the chained build the same way Guide.tsx polls its own; the app-level job:ended subscriber raises the completion toast (ADR 0076), so this dialog only shows progress.'),

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
  'src/components/manuscript/useWordLookup.ts::systemLookup#1': row('click', 'file-io', 'pending', 'pending', 'ui', 'toast', 'na', 'ok', 'Look up in the selection menu: a Go read of the dictionary index (about 1.5 ms; the first lookup of a session reads the index in full against its hash). The button is busy and the other selection actions are off meanwhile; the answer opens the panel; a failure is a toast and the selection stays.'),
  'src/components/manuscript/useWordLookup.ts::assetsInstall#1': row('click', 'download', 'dialog', 'host', 'dialog', 'dialog', 'no', 'ok', 'The dictionary download a lookup asked for, only after the narrator confirms the first-use question: the same flow as every other download (useAssetInstall), and the host joins a download that is already running. It ends by answering the lookup.'),
  'src/components/manuscript/useWordLookup.ts::assetsInstallState#1': row('timer', 'download', 'dialog', 'na', 'poll', 'dialog', 'no', 'ok', 'The one install-poll loop (useAssetInstall): the dialog shows the bytes as they arrive and a failed poll in the dialog.'),
  'src/components/manuscript/useWordLookup.ts::assetsInstallCancel#1': row('click', 'download', 'dialog', 'dialog', 'dialog', 'dialog', 'no', 'ok', 'Cancel stops the download and the dialog says so; it is drawn only while bytes arrive.'),
  'src/components/manuscript/Manuscript.tsx::creditsTemplates#1': row(
    'mount',
    'file-io',
    'na',
    'na',
    'ui',
    'silent',
    'na',
    'exempt',
    'Loads the credits template library behind the Phase 3 Opening/Closing credits pseudo-entries (audiobook-credits-templates.prd.md); a failed load simply renders no credits entries rather than a toast over the manuscript itself, which already has its own load-error state for the chapters it cannot do without.',
  ),
  'src/components/manuscript/Manuscript.tsx::creditsRetailSample#1': row('mount', 'file-io', 'na', 'na', 'ui', 'silent', 'na', 'exempt', 'Reads the retail sample to mark its lines (Phase 5, ADR 0152); a failed read leaves the reader unmarked, and Settings > Credits shows the real error.'),
  'src/components/manuscript/Manuscript.tsx::creditsPreview#1': row(
    'effect',
    'instant',
    'na',
    'na',
    'ui',
    'inline',
    'na',
    'exempt',
    'Renders the first opening-kind template (ADR 0093\'s convention) with the current project values for the Opening credits entry; a failed render leaves that entry showing "Nothing to preview yet." (same fallback as CreditsPanel.tsx) rather than a toast.',
  ),
  'src/components/manuscript/Manuscript.tsx::creditsPreview#2': row(
    'effect',
    'instant',
    'na',
    'na',
    'ui',
    'inline',
    'na',
    'exempt',
    'Renders the first closing-kind template (ADR 0093\'s convention) with the current project values for the Closing credits entry; a failed render leaves that entry showing "Nothing to preview yet." rather than a toast.',
  ),

  // Project picker: every action runs through runAction, which sets busy, catches and shows the reason.
  'src/components/project/ProjectPicker.tsx::projectRecents#1': row('mount', 'file-io', 'na', 'na', 'ui', 'inline', 'na', 'exempt', 'An unreadable list shows as an empty one with the picker still usable.'),
  'src/components/project/ProjectPicker.tsx::switchProject#1': row('click', 'file-io', 'disabled', 'disabled', 'ui', 'inline', 'na', 'ok', 'runAction: busy while it runs, the reason shown on failure. The model for the shared hook.'),
  'src/components/project/ProjectPicker.tsx::removeRecentProject#1': row('click', 'file-io', 'disabled', 'disabled', 'ui', 'inline', 'na', 'ok', 'runAction.'),
  'src/components/project/ProjectPicker.tsx::selectProjectFolder#1': row('click', 'os-dialog', 'disabled', 'disabled', 'ui', 'inline', 'na', 'ok', 'runAction.'),
  'src/components/project/ProjectPicker.tsx::switchProject#2': row('click', 'file-io', 'disabled', 'disabled', 'ui', 'inline', 'na', 'ok', 'runAction.'),
  'src/components/project/NewProjectDialog.tsx::selectProjectFolder#1': row(
    'click',
    'os-dialog',
    'disabled',
    'disabled',
    'ui',
    'inline',
    'na',
    'ok',
    'Change location.',
  ),
  'src/components/project/NewProjectDialog.tsx::createProject#1': row(
    'click',
    'file-io',
    'pending',
    'disabled',
    'ui',
    'inline',
    'na',
    'ok',
    'Create: the button shows pending and the name field stays disabled until it settles.',
  ),

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

  // Teleprompter. Phase 2 (teleprompter-manuscript-integration.prd.md) extracted the session core into
  // `useTeleprompterSession` so the standalone page and the `ReadAloudDialog` modal share it; the rows below moved
  // with the calls they describe, and `TeleprompterPage.tsx` keeps only what stayed there (chapter selection).
  'src/components/teleprompter/TeleprompterPage.tsx::manuscriptChapters#1': row('mount', 'file-io', 'na', 'na', 'ui', 'inline', 'na', 'ok', 'An inline error.'),
  'src/components/teleprompter/TeleprompterPage.tsx::readerState#1': row('mount', 'file-io', 'na', 'na', 'ui', 'silent', 'na', 'exempt', 'Only picks the chapter the narrator last read; the first chapter is used without it.'),
  // Phase 11 of the input-devices PRD (ADR 0113): the REAPER suggestion is a hint beneath the picker, and the
  // session-state read only stops it moving a session already running.
  'src/components/teleprompter/TeleprompterPage.tsx::chapterSuggestion#1': row('mount', 'file-io', 'na', 'na', 'ui', 'silent', 'na', 'exempt', 'A hint only: with no .rpp, or none chosen, the picker keeps its usual default and no hint shows.'),
  'src/components/teleprompter/TeleprompterPage.tsx::teleprompterState#1': row('mount', 'instant', 'na', 'na', 'ui', 'silent', 'na', 'exempt', 'Only guards the REAPER preselection; the session hook reads and reports the state itself.'),
  'src/components/teleprompter/useResumeLocate.ts::teleprompterLocate#1': row('mount', 'python', 'inline', 'pending', 'ui', 'inline', 'no', 'ok', 'The read-aloud resume card (teleprompter-manuscript-integration.prd.md Phase 10, ADR 0112) asks where the recording ends when the dialog opens and again on a track pick, Try again or a finished model download: "Finding where your recording of this chapter ends..." shows at once and replaces the choices, and only the latest lookup may answer; a failure is an inline alert with Try again.'),
  'src/components/teleprompter/useResumeLocate.ts::whisperInstall#1': row('click', 'download', 'dialog', 'host', 'dialog', 'dialog', 'no', 'ok', 'Only after Download model... and the first-use confirm; the host joins a download already running for the same asset. Bytes, the check, Cancel and a failure sentence in the dialog, through useAssetInstall; a finished download runs the lookup again.'),
  'src/components/teleprompter/useResumeLocate.ts::whisperInstallState#1': row('timer', 'download', 'dialog', 'na', 'poll', 'dialog', 'no', 'ok', 'The one install-poll loop (useAssetInstall), every 400 ms, as for the Start reading download.'),
  'src/components/teleprompter/useResumeLocate.ts::whisperInstallCancel#1': row('click', 'download', 'dialog', 'dialog', 'dialog', 'dialog', 'no', 'ok', 'Cancel stops the download and the dialog says it was cancelled; drawn only while bytes arrive.'),
  'src/components/teleprompter/TeleprompterPage.tsx::creditsTemplates#1': row(
    'mount',
    'file-io',
    'na',
    'na',
    'ui',
    'silent',
    'na',
    'exempt',
    'Loads the credits template library so the picker can offer Opening and Closing credits (audiobook-credits-templates.prd.md Phase 4); a failed load leaves the credits out of the picker, like the Manuscript entries, and the chapters stay readable.',
  ),
  'src/components/teleprompter/TeleprompterPage.tsx::creditsPreview#1': row(
    'mount',
    'instant',
    'na',
    'na',
    'ui',
    'silent',
    'na',
    'exempt',
    'Renders the first opening- and closing-kind template (ADR 0093) with the project values for the credits in the picker, their text and the unresolved-token warning; a failed render leaves that credits out of the picker rather than a toast over the page.',
  ),
  'src/components/teleprompter/useTeleprompterSession.ts::subscribeTeleprompterEvent#1': subscription('The live session events.'),
  'src/components/teleprompter/useTeleprompterSession.ts::subscribeTeleprompterState#1': subscription('The live session state.'),
  'src/components/teleprompter/useTeleprompterSession.ts::teleprompterState#1': row('mount', 'instant', 'na', 'na', 'ui', 'silent', 'na', 'exempt', 'Hydrates a session that was already running; the state event follows anyway.'),
  'src/components/teleprompter/useTeleprompterSession.ts::teleprompterDevices#1': row('effect', 'python', 'na', 'disabled', 'ui', 'inline', 'na', 'ok', 'Loads the device list on mount and again on a manual Refresh click in the picker (disabled while a listing is already in flight); a listing failure shows inline instead of blocking Start with a previously-chosen device (the host never fails this call outright).'),
  'src/components/teleprompter/useTeleprompterSession.ts::settingsForScope#1': row('effect', 'file-io', 'na', 'na', 'ui', 'silent', 'na', 'exempt', 'Loads the persisted microphone (docs/prds/teleprompter-engines-and-input-devices.prd.md Phase 2) and runs the one-time browser-storage migration on the standalone page; if it fails the field just starts empty, exactly as it did before Phase 2.'),
  'src/components/teleprompter/useTeleprompterSession.ts::manuscriptParagraphs#1': row('effect', 'file-io', 'na', 'na', 'ui', 'inline', 'na', 'ok', 'An inline error.'),
  'src/components/teleprompter/useTeleprompterSession.ts::teleprompterStart#1': row('click', 'job', 'disabled', 'host', 'ui', 'inline', 'no', 'ok', 'The state event moves the page to "starting" and disables Start; the host refuses a second session.'),
  'src/components/teleprompter/useTeleprompterSession.ts::teleprompterStop#1': row('click', 'job', 'none', 'none', 'ui', 'inline', 'no', 'ok', 'The state event moves the page on; an inline error otherwise.'),
  'src/components/teleprompter/ReadAloudDialog.tsx::teleprompterSaveFlags#1': row(
    'effect',
    'file-io',
    'none',
    'none',
    'ui',
    'inline',
    'no',
    'ok',
    'Keeps the session’s suspected flags as findings when reading stops, when the dialog closes and on a dismiss after the session (ADR 0117); the Flags tab says they were kept, or shows the failure. Saving again is idempotent on the host, so there is nothing to guard.',
  ),
  'src/components/teleprompter/useTeleprompterSession.ts::teleprompterSeek#1': row('click', 'file-io', 'none', 'none', 'event', 'inline', 'no', 'ok', 'The tracker\'s next position event (jump: "restart") shows the move; an inline error otherwise. No caller triggers this yet (teleprompter-manuscript-integration.prd.md Phase 4 adds the word-click affordance); the seek channel itself is Phase 3.'),
  'src/components/teleprompter/useTeleprompterSession.ts::assetsInstall#1': row('click', 'download', 'dialog', 'host', 'dialog', 'dialog', 'no', 'ok', 'The first-use dialog says Starting at once; the host joins a download that is already running for the same asset (S16), so a second press starts no second one. The asset is the model of the chosen engine (Whisper or Moonshine), named by the gate. Real bytes, the check, Cancel while bytes arrive, and a failure sentence in the dialog, through useAssetInstall.'),
  'src/components/teleprompter/useTeleprompterSession.ts::assetsInstallState#1': row('timer', 'download', 'dialog', 'na', 'poll', 'dialog', 'no', 'ok', 'The one install-poll loop (useAssetInstall), every 400 ms: the dialog shows the bytes as they arrive, and a failed poll is shown in the dialog. The download outlives the dialog and ends with job:ended.'),
  'src/components/teleprompter/useTeleprompterSession.ts::assetsInstallCancel#1': row('click', 'download', 'dialog', 'dialog', 'dialog', 'dialog', 'no', 'ok', 'Cancel stops the download and the dialog says it was cancelled; it is drawn only while bytes arrive, and a failed cancel is shown in the dialog.'),
  'src/components/teleprompter/useTeleprompterSession.ts::saveSettings#1': row('effect', 'file-io', 'na', 'na', 'ui', 'silent', 'na', 'exempt', 'The one-time browser-storage-to-settings migration write (standalone page only); a failure leaves the device in local state for this visit and the migration is retried next load since the settings value never got marked set.'),
  'src/components/teleprompter/useTeleprompterSession.ts::saveSettings#2': row(
    'input',
    'file-io',
    'none',
    'none',
    'ui',
    'inline',
    'no',
    'ok',
    "The chosen microphone (global settings, docs/prds/teleprompter-engines-and-input-devices.prd.md Phase 2) is saved as it is picked or typed; a save failure shows as the inline error (the page's or the ReadAloudDialog modal's), and the value picked stays selected in the field either way.",
  ),

  // Tracks
  'src/components/tracks/TracksPage.tsx::tracksDiscover#1': row('mount', 'file-io', 'na', 'na', 'ui', 'inline', 'na', 'ok', 'An inline error.'),
  'src/components/tracks/TracksPage.tsx::tracksList#1': row('effect', 'file-io', 'na', 'na', 'ui', 'inline', 'na', 'ok', 'Parsing a 100 KB project file takes about 2 ms (docs/research/interaction-latency-baseline.md).'),
  'src/components/tracks/TracksPage.tsx::tracksSelect#1': row('click', 'file-io', 'none', 'none', 'ui', 'inline', 'na', 'ok', 'A small file write.'),
  'src/components/tracks/ChapterLinksTable.tsx::manuscriptChapters#1': row('effect', 'file-io', 'na', 'na', 'ui', 'inline', 'na', 'ok', 'Loaded beside the confirmed mappings to build the chapter-link list (evidence ledger PRD, Phase 7).'),
  'src/components/tracks/ChapterLinksTable.tsx::chapterTrackMapList#1': row('effect', 'file-io', 'na', 'na', 'ui', 'inline', 'na', 'ok', 'The confirmed links for the current manuscript document.'),
  'src/components/tracks/ChapterLinksTable.tsx::chapterTrackMapConfirm#1': row('click', 'file-io', 'pending', 'pending', 'ui', 'inline', 'no', 'ok', 'Confirm on a chapter\'s MappingConfirm; the row is busy until the link is written and re-listed, and a refusal (an unknown chapter) is written inline.'),
  'src/components/tracks/ChapterLinksTable.tsx::chapterTrackMapClear#1': row('click', 'file-io', 'pending', 'pending', 'ui', 'inline', 'no', 'ok', 'Clear on a chapter\'s MappingConfirm; the row is busy until the link is removed and re-listed.'),
  'src/components/tracks/TracksPage.tsx::manuscriptChapters#1': row('mount', 'file-io', 'na', 'na', 'ui', 'silent', 'na', 'exempt', 'Only decides whether the "Link chapters…" button shows; without it the button is absent, same as a project with no chapters.'),
  'src/components/tracks/LinkChaptersDialog.tsx::lineIdentityState#1': row('mount', 'instant', 'na', 'na', 'ui', 'silent', 'na', 'exempt', 'Hydrates whatever stamp or read was already in flight when the dialog reopened; the live event follows anyway.'),
  'src/components/tracks/LinkChaptersDialog.tsx::subscribeLineIdentity#1': subscription('The line-identity state event, shared by the Stamp and Read runs this dialog starts.'),
  'src/components/tracks/LinkChaptersDialog.tsx::lineIdentityStamp#1': row('click', 'job', 'pending', 'disabled', 'ui', 'inline', 'no', 'ok', 'Approve. The dialog cannot be closed while a stamp runs (Dialog\'s onClose is undefined then), so the result is always seen; a failure shows inline as an alert and in the phase message.'),
  'src/components/tracks/LinkChaptersDialog.tsx::lineIdentityRead#1': row('click', 'job', 'pending', 'disabled', 'ui', 'inline', 'no', 'ok', 'Read-only and idempotent; a failure shows inline in the "Currently stamped" section.'),
  'src/components/tracks/PickupsDialog.tsx::pickupsState#1': row('mount', 'instant', 'na', 'na', 'ui', 'silent', 'na', 'exempt', 'Hydrates whatever run was already in flight when the dialog reopened; the live event follows anyway.'),
  'src/components/tracks/PickupsDialog.tsx::subscribePickups#1': subscription('The pickups state event, shared by every import, export, next, resolve and count run this dialog starts.'),
  'src/components/tracks/PickupsDialog.tsx::pickupsCount#1': row(
    'mount',
    'job',
    'na',
    'na',
    'ui',
    'silent',
    'na',
    'exempt',
    'An automatic refresh right after the hydrate above settles, so the remaining count is current without an extra press; a failure here just leaves the count at whatever the hydrate answered, and the narrator can still press Import, Next or Export, each of which shows its own failure inline.',
  ),
  'src/components/tracks/PickupsDialog.tsx::pickupsImport#1': row('input', 'job', 'pending', 'pending', 'ui', 'inline', 'no', 'ok', 'Choosing a CSV file. Row errors and the import summary show inline; a request failure shows as an alert.'),
  'src/components/tracks/PickupsDialog.tsx::pickupsNext#1': row('click', 'job', 'pending', 'pending', 'ui', 'inline', 'no', 'ok', 'A failure (no pickups remain) shows as an alert.'),
  'src/components/tracks/PickupsDialog.tsx::pickupsResolve#1': row('click', 'job', 'pending', 'pending', 'ui', 'inline', 'no', 'ok', 'A failure (no open pickup at that position) shows as an alert.'),
  'src/components/tracks/PickupsDialog.tsx::pickupsExport#1': row('click', 'job', 'pending', 'pending', 'ui', 'inline', 'no', 'ok', 'A completed export triggers the browser file-save download; a failure shows as an alert.'),
  'src/components/tracks/RenderConfigDialog.tsx::renderConfigState#1': row('mount', 'instant', 'na', 'na', 'ui', 'silent', 'na', 'exempt', 'Hydrates whatever configure run was already in flight when the dialog reopened; the live event follows anyway.'),
  'src/components/tracks/RenderConfigDialog.tsx::renderConfigSuggestFolder#1': row(
    'mount',
    'instant',
    'na',
    'na',
    'ui',
    'silent',
    'na',
    'exempt',
    'Only prefills the output folder field when nothing was configured yet; without it the narrator types the folder by hand.',
  ),
  'src/components/tracks/RenderConfigDialog.tsx::subscribeRenderConfig#1': subscription('The render-config state event, for the configure run this dialog starts.'),
  'src/components/tracks/RenderConfigDialog.tsx::renderConfigConfigure#1': row(
    'click',
    'job',
    'pending',
    'pending',
    'ui',
    'inline',
    'no',
    'ok',
    'Configuration only (Phase 11, Open Question 7): sets the render bounds, pattern and output folder, never triggers a render. A completed run shows the resulting file names and the manual-render instruction; a failure shows inline as an alert.',
  ),
  'src/components/tracks/ChapterTagsDialog.tsx::chapterTagsPreview#1': row('mount', 'instant', 'na', 'na', 'ui', 'inline', 'na', 'exempt', 'Loads the known chapters from the last chapter render; a failure shows inline instead of the chapter list.'),
  'src/components/tracks/ChapterTagsDialog.tsx::chapterTagsEmbed#1': row(
    'click',
    'file-io',
    'disabled',
    'disabled',
    'ui',
    'inline',
    'no',
    'ok',
    'Phase 12: writes ID3 CHAP/CTOC tags into a new copy of the narrator-chosen file. Gated on the confirm checkbox and a non-blank destination; the button and the confirm checkbox stay disabled while it runs. A success shows the new file path, a failure shows inline as an alert.',
  ),

  // Review page (review-dashboard-and-findings-adoption.prd.md, Phase 5)
  'src/components/review/ReviewPage.tsx::findingsSummary#1': row('mount', 'file-io', 'na', 'na', 'ui', 'inline', 'na', 'exempt', 'Read together with the list: the first load failing is the page load error with Retry, a later one (after a filter change or a decision) is a toast and the list on screen stays.'),
  'src/components/review/ReviewPage.tsx::findingsList#1': row('input', 'file-io', 'na', 'na', 'ui', 'toast', 'na', 'ok', 'Runs on opening and on every filter, sort or Show more change; an answer to an older request is dropped, the first load failing is the page load error with Retry and a later one is a toast.'),
  'src/components/review/FindingDetail.tsx::findingsReview#1': row('click', 'file-io', 'pending', 'pending', 'ui', 'inline', 'yes', 'ok', 'Accept, Dismiss, Defer and Reopen run one at a time through usePendingAction: the pressed button is busy, the others are off, "Saved as ..." is announced and the list and counts reload. A refusal is an inline alert: on changed evidence (ADR 0120) it says so in plain words and shows the latest version, otherwise it gives the host reason.'),
  'src/components/review/FindingDetail.tsx::findingsGet#1': row('effect', 'file-io', 'na', 'na', 'ui', 'inline', 'na', 'ok', 'Only after a refused decision, to tell changed evidence from any other refusal; if it fails too, the inline alert gives the host reason for the refusal.'),
  'src/components/review/useReaperStatus.ts::findingsReaperStatus#1': row('timer', 'instant', 'na', 'na', 'ui', 'inline', 'na', 'ok', 'Read on opening the Review page and every 3 s while it is open, from the heartbeat REAPER already sends (nothing is sent to REAPER); a failed read counts as not connected and is the reason shown under the disabled Go to and Loop.'),
  'src/components/review/ReaperControls.tsx::findingsGoTo#1': row('click', 'file-io', 'pending', 'pending', 'ui', 'inline', 'no', 'ok', 'A round trip through the REAPER file bridge (under 3 s): Go to is busy and Loop and Stop are off meanwhile (usePendingAction); where REAPER put the cursor is announced, and a refusal (stale finding, recording, older script, REAPER gone) is an inline alert in plain words. The move itself stays in REAPER.'),
  'src/components/review/ReaperControls.tsx::findingsLoop#1': row('click', 'file-io', 'pending', 'pending', 'ui', 'inline', 'yes', 'ok', 'Loop is busy while REAPER sets the loop and plays; the window is announced and Stop loop appears (the page status names the looping finding, so the loop is shown again after the narrator leaves and comes back). A refusal is an inline alert in plain words.'),
  'src/components/review/ReaperControls.tsx::findingsStopLoop#1': row('click', 'file-io', 'pending', 'pending', 'ui', 'inline', 'no', 'ok', 'Stop loop is busy until REAPER has put back the time selection, loop points and repeat; what came back (or was kept because the narrator changed it) is announced, and a refusal is an inline alert and Stop stays offered.'),
  'src/components/review/ReaperControls.tsx::findingsAddMarker#1': row('click', 'file-io', 'pending', 'pending', 'ui', 'inline', 'no', 'ok', 'Only after the narrator confirms in the Add a marker in REAPER dialog (the one REAPER action here that changes the project): its Add marker is busy and Cancel is off until REAPER answers (under 3 s), then the dialog closes; the marker added (or the one already there) is announced, and a refusal (not accepted, stale finding, recording, older script, REAPER gone) is an inline alert in plain words. The marker itself stays in REAPER, undoable there.'),
  'src/components/review/ReviewPage.tsx::subscribeJobEnded#1': subscription('A pickup and duplicate scan left running in the background reloads the list and counts when it ends, so its groups appear without leaving the page (take review Phase 5).'),
  'src/components/review/TakeReviewScanDialog.tsx::takeReviewScanState#1': row('mount', 'instant', 'na', 'na', 'ui', 'inline', 'yes', 'ok', 'On opening the scan dialog: a scan still running (left in the background) is shown with its progress; otherwise the form is offered with the project saved pickup scope. A failed read is an inline alert in the dialog.'),
  'src/components/review/TakeReviewScanDialog.tsx::tracksList#1': row('mount', 'file-io', 'na', 'na', 'ui', 'inline', 'na', 'ok', 'Fills the track pickers from the REAPER project file (about 2 ms); when it cannot be read the dialog says why inline and Start scan stays off.'),
  'src/components/review/TakeReviewScanDialog.tsx::takeReviewScanState#2': row('timer', 'instant', 'dialog', 'dialog', 'dialog', 'dialog', 'yes', 'ok', 'Polls every 500 ms while the scan runs, showing the sidecar own percent and stage in WorkDialog (ADR 0015); the end is also a job:ended toast, so Continue in background loses nothing (ADR 0076).'),
  'src/components/review/TakeReviewScanDialog.tsx::takeReviewScanStart#1': row('click', 'job', 'pending', 'host', 'dialog', 'inline', 'yes', 'ok', 'Start scan is busy while the host checks the scope and starts the job, then the dialog becomes the progress view; a refused scope or a scan already running is an inline alert in the form, in the host words.'),
  'src/components/review/TakeReviewScanDialog.tsx::takeReviewScanCancel#1': row('click', 'instant', 'dialog', 'dialog', 'dialog', 'inline', 'no', 'ok', 'Cancel asks the sidecar to stop and the job reports cancelled once it has; nothing it found is saved. A failed request is an inline alert.'),
  'src/components/review/TakeReviewReads.tsx::findingsGoToRead#1': row('click', 'file-io', 'pending', 'pending', 'ui', 'inline', 'no', 'ok', 'Go to on one read: a round trip through the REAPER file bridge, the pressed button busy and the other read controls off meanwhile (usePendingAction); where the cursor went is announced, a refusal is an inline alert in plain words.'),
  'src/components/review/TakeReviewReads.tsx::findingsLoopRead#1': row('click', 'file-io', 'pending', 'pending', 'ui', 'inline', 'yes', 'ok', 'Loop on one read: busy while REAPER sets the loop and plays; the window is announced and Stop loop appears (the page status names the looping finding, so it shows again after leaving and coming back).'),
  'src/components/review/TakeReviewReads.tsx::findingsStopLoop#1': row('click', 'file-io', 'pending', 'pending', 'ui', 'inline', 'no', 'ok', 'Stop loop under the reads is busy until REAPER has put back the time selection, loop points and repeat; what came back is announced and a refusal is an inline alert.'),
  'src/components/review/TakeReviewReads.tsx::takeReviewCreateTake#1': row('click', 'job', 'pending', 'pending', 'ui', 'inline', 'no', 'ok', 'Add as take, after the confirm (phase 6): a bounded round trip to REAPER over the bridge. Every dialog control is off while pending; the new take is announced under the reads, and a stale item or REAPER failure is an inline alert inside the dialog, which stays open.'),
  'src/components/review/FindingDetail.tsx::manuscriptParagraphs#1': row('click', 'file-io', 'pending', 'pending', 'ui', 'na', 'na', 'ok', 'Show in manuscript is busy while the finding paragraph is resolved to its line; if that read fails the manuscript still opens at the chapter, and the manuscript page reports its own load failure.'),

  // Credits (audiobook-credits-templates.prd.md, Phase 1)
  'src/components/settings/CreditsPanel.tsx::creditsTemplates#1': row('mount', 'file-io', 'na', 'na', 'ui', 'inline', 'na', 'ok', 'The template library load; an inline error banner otherwise.'),
  'src/components/settings/CreditsPanel.tsx::creditsProjectValues#1': row('mount', 'file-io', 'na', 'na', 'ui', 'inline', 'na', 'ok', 'The project values and manuscript-seeded suggestions load; an inline error banner otherwise.'),
  'src/components/settings/CreditsPanel.tsx::creditsPreview#1': row('effect', 'instant', 'na', 'na', 'ui', 'inline', 'na', 'exempt', 'A background preview refresh on every body/value change; a failed render just falls back to "Nothing to preview yet." rather than a toast per keystroke, and the fields it was rendering from stay visible and correct.'),
  'src/components/settings/CreditsPanel.tsx::creditsChapterAnnouncements#1': row('effect', 'file-io', 'na', 'na', 'ui', 'inline', 'na', 'ok', 'The chapter announcement preview for the first chapter (Phase 5); a failure (no manuscript yet) says why in the preview box instead of a toast per keystroke.'),
  'src/components/settings/RetailSamplePanel.tsx::manuscriptChapters#1': row('mount', 'file-io', 'na', 'na', 'ui', 'inline', 'na', 'ok', 'The chapters and lines the sample is picked from; a failure is an inline alert in the Retail sample section.'),
  'src/components/settings/RetailSamplePanel.tsx::creditsRetailSample#1': row('mount', 'file-io', 'na', 'na', 'ui', 'inline', 'na', 'ok', 'The saved sample, or why it cannot be shown; a failure is an inline alert.'),
  'src/components/settings/RetailSamplePanel.tsx::saveCreditsRetailSample#1': row('click', 'file-io', 'disabled', 'disabled', 'toast', 'inline', 'na', 'ok', 'Save sample and Clear sample disable while busy; a range over 5 minutes is refused with its length as an inline alert and the previous sample is kept (Phase 5, C10).'),
  'src/components/settings/CreditsPanel.tsx::saveCreditsTemplate#1': row('click', 'file-io', 'disabled', 'disabled', 'toast', 'toast', 'na', 'ok', 'Save template disables while busy (and its own pending look) and cannot fire twice; a failure is a toast and the draft stays editable to retry.'),
  'src/components/settings/CreditsPanel.tsx::duplicateCreditsTemplate#1': row('click', 'file-io', 'disabled', 'disabled', 'toast', 'toast', 'na', 'ok', 'Duplicate disables while busy and cannot fire twice; a failure is a toast.'),
  'src/components/settings/CreditsPanel.tsx::deleteCreditsTemplate#1': row('click', 'file-io', 'disabled', 'disabled', 'toast', 'toast', 'na', 'ok', 'Delete disables while busy and cannot fire twice; a failure is a toast, and the template stays in the library to retry.'),
  'src/components/settings/CreditsPanel.tsx::saveCreditsProjectValues#1': row('input', 'file-io', 'disabled', 'disabled', 'ui', 'toast', 'na', 'ok', "Saves on every change to a project value field (never blocks on an unresolved token, C6); the field being saved disables until it ends, so a second edit cannot race the first, and a failure is a toast while the typed value stays on screen."),
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
  'src/components/home/Home.tsx#2':
    'Only pre-fills the "Build the Story Bible after import" checkbox from Settings; it keeps its on-by-default (D8) local state without it, and the narrator can still change it per import.',
  'src/components/manuscript/Manuscript.tsx#1':
    'Renders the Opening credits pseudo-entry preview; a failed render just leaves that entry showing "Nothing to preview yet." rather than a toast over the manuscript itself.',
  'src/components/manuscript/Manuscript.tsx#2': 'Renders the Closing credits pseudo-entry preview; same fallback as the opening one above.',
  'src/components/proofing/Transcript.tsx#1': 'Reads the last model and chunk choice; the defaults stay usable and Settings reports a real error.',
  'src/components/proofing/Transcript.tsx#2': 'Only offers to review the last run; without it the offer is absent.',
  // Phase 2 (teleprompter-manuscript-integration.prd.md) moved the device/settings catches into `useTeleprompterSession.ts`;
  // `TeleprompterPage.tsx` keeps only the chapter-selection catch it never shared with the modal.
  'src/components/teleprompter/TeleprompterPage.tsx#1':
    'Only renders the opening or closing credits for the picker (credits PRD Phase 4); a failed render leaves those credits out of the picker, as the Manuscript page leaves its entry empty, and the chapters are unaffected.',
  'src/components/teleprompter/TeleprompterPage.tsx#2': 'Only picks the chapter the narrator last read; the first chapter is used without it.',
  'src/components/teleprompter/TeleprompterPage.tsx#3':
    'The REAPER chapter suggestion (ADR 0113) is a hint: no .rpp, or none chosen, is normal for a narrator not using REAPER, so it means no hint.',
  'src/components/teleprompter/TeleprompterPage.tsx#4':
    'Only guards the REAPER preselection against a running session; useTeleprompterSession reads the state again and reports its failure.',
  'src/components/teleprompter/useTeleprompterSession.ts#1':
    'Clearing the migrated browser-storage device once it is written to settings; if storage cannot be reached the stale value is simply left behind and never read again (the settings value now wins).',
  'src/components/teleprompter/useTeleprompterSession.ts#2': 'Hydrates a session that was already running; the state event follows anyway.',
  'src/components/teleprompter/useTeleprompterSession.ts#3':
    'Loads the persisted device and runs the one-time migration; if it fails the field just starts empty, exactly as it did before Phase 2.',
  'src/components/teleprompter/useTeleprompterSession.ts#4':
    'The one-time browser-storage-to-settings migration write; a failure leaves the device in local state for this visit and the migration is retried next load since the settings value never got marked set.',
  'src/components/teleprompter/readerPreferences.ts#1':
    'Remembering the read-aloud rail (open, tab) in localStorage; the choice lasts for this dialog only when storage is disabled.',
  'src/components/teleprompter/readerPreferences.ts#2':
    'Remembering which flag kinds the read-aloud dialog shows in localStorage (Phase 7); the choice lasts for this dialog only when storage is disabled.',
  'src/theme/ThemeContext.tsx#1': 'Remembering the theme in localStorage; the preference just does not persist when storage is disabled.',
  'src/components/tracks/TracksPage.tsx#1':
    'Only decides whether the "Link chapters…" button shows; without it the button is absent, same as a project with no chapters.',
  'src/components/tracks/LinkChaptersDialog.tsx#1':
    'Hydrates whatever stamp or read was already in flight when the dialog reopened; the live event follows anyway.',
  'src/components/tracks/PickupsDialog.tsx#1':
    'Hydrates whatever run was already in flight, then refreshes the count; a failure here leaves the count at its last known value, and every narrator-triggered action still shows its own failure inline.',
  'src/components/review/FindingDetail.tsx#1':
    'Re-reads a finding after the host refused a decision, only to tell changed evidence apart; when the re-read fails too, the inline alert still shows the host reason for the refusal, so nothing is hidden.',
  'src/components/tracks/RenderConfigDialog.tsx#1':
    'Hydrates whatever configure run was already in flight, then offers a suggested output folder when none was configured yet; the narrator can still type a folder and press Configure render either way.',
};
