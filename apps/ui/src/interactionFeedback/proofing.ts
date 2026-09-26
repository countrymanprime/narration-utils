// The interaction feedback rows for the proofing call sites (see interactionFeedback.catalog.ts for what a row says).
import { type FeedbackRow, row } from './row';

// prettier-ignore
export const proofingFeedback: Record<string, FeedbackRow> = {
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

};
