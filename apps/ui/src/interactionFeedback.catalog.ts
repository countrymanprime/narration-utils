// The interaction feedback catalog (ADR 0075, docs/architecture/interaction-feedback.md): one row for every place the UI calls the host, with a
// verdict against the standard. `interactionFeedback.test.ts` fails on a call site that has no row, on a row whose site is gone, and on a row that
// breaks the rules for its verdict, so the inventory cannot rot.
//
// A site is `<file under apps/ui>::<NarrationApi method>#<n>`, the n-th call of that method in that file, in source order. Adding or removing a call
// renumbers the ones after it in the same file; the test names the keys that changed.
import type { FeedbackRow } from './interactionFeedback/row';
import { appFeedback } from './interactionFeedback/app';
import { homeFeedback } from './interactionFeedback/home';
import { manuscriptFeedback } from './interactionFeedback/manuscript';
import { projectFeedback } from './interactionFeedback/project';
import { proofingFeedback } from './interactionFeedback/proofing';
import { settingsFeedback } from './interactionFeedback/settings';
import { storyBibleFeedback } from './interactionFeedback/storyBible';
import { teleprompterFeedback } from './interactionFeedback/teleprompter';
import { tracksFeedback } from './interactionFeedback/tracks';
import { workspaceFeedback } from './interactionFeedback/workspace';
import { reviewFeedback } from './interactionFeedback/review';
import { editingFeedback } from './interactionFeedback/editing';
import { deliveryFeedback } from './interactionFeedback/delivery';
import { creditsFeedback } from './interactionFeedback/credits';

export type { FeedbackRow } from './interactionFeedback/row';

// One file per area under interactionFeedback/ (the row shape and its helpers are interactionFeedback/row.ts). A site with a row
// in two areas fails here rather than one silently replacing the other.
const AREAS: Array<Record<string, FeedbackRow>> = [
  appFeedback,
  homeFeedback,
  manuscriptFeedback,
  projectFeedback,
  proofingFeedback,
  settingsFeedback,
  storyBibleFeedback,
  teleprompterFeedback,
  tracksFeedback,
  workspaceFeedback,
  reviewFeedback,
  editingFeedback,
  deliveryFeedback,
  creditsFeedback,
];

export const FEEDBACK_CATALOG: Record<string, FeedbackRow> = {};
for (const rows of AREAS) {
  for (const [site, row] of Object.entries(rows)) {
    if (Object.hasOwn(FEEDBACK_CATALOG, site)) throw new Error(`${site} has a row in two areas`);
    FEEDBACK_CATALOG[site] = row;
  }
}

/**
 * The bare catches (`catch {}`, `.catch(() => {})`, `.catch(() => undefined)`) that were reviewed and are safe, keyed `<file>#<n>` in source order, each with why.
 * The list may only shrink: a new one needs a reason a reviewer accepts, and a narrator's action never belongs here.
 */
export const SILENT_CATCHES: Record<string, string> = {
  'src/components/home/ChapterTrackPanel.tsx#1':
    'onRemoveFromRecording already shows the failure (its own toast, in AudiobookEstimatePanel) before rethrowing; this catch only stops that rejection from going unhandled and skips closing the confirm, so the narrator can retry.',
  'src/api/wailsClient.ts#1': 'The diagnostic report itself: a report that fails must not raise a second error over the one being reported.',
  'src/api/wailsClient.ts#2': 'The host binding is missing (not running inside the desktop app), so there is nothing to report to.',
  'src/App.tsx#1': 'A diagnostic report while showing the startup error; it must not throw over it.',
  'src/App.tsx#2': 'The window error handler reports a diagnostic; a failing report must not raise another window error.',
  'src/App.tsx#3': 'The unhandled-rejection handler reports a diagnostic; a failing report must not raise another rejection.',
  'src/App.tsx#4': "Cosmetic: the narrator's entity colours. The built-in colours stay if the settings cannot be read, and Settings reports the real error.",
  'src/hooks/useChapterSync.ts#1':
    "Seeds useChapterSync's state before the next chaptersync:state event; a failed seed just leaves the state undefined a moment longer.",
  // Phase 1 (app-navigation-and-zoom-controls.prd.md) added two more bare catches in this file (Back/Forward's own guard,
  // and the nav's original one, now #6), renumbering what follows.
  'src/App.tsx#5': 'Best effort recovery for a popstate the app did not start: a reset that fails leaves the finished results in place, which is harmless.',
  'src/App.tsx#6': 'Best effort when leaving Proofing through the nav: a reset that fails leaves the finished results in place, which is harmless.',
  'src/App.tsx#7': 'Best effort when leaving Proofing through guarded Back/Forward: same as the nav, harmless either way.',
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
  'src/components/teleprompter/useInputLevel.ts#1':
    'Best-effort release of the meter-only child (popover close, session start, device change or unmount); nothing is left mounted to show a failure, and the meter simply starts fresh the next time the popover opens.',
  'src/components/teleprompter/useTeleprompterSession.ts#1':
    'Clearing the migrated browser-storage device once it is written to settings; if storage cannot be reached the stale value is simply left behind and never read again (the settings value now wins).',
  'src/components/teleprompter/useTeleprompterSession.ts#2': 'Hydrates a session that was already running; the state event follows anyway.',
  'src/components/teleprompter/useTeleprompterSession.ts#3':
    'Loads the persisted device and runs the one-time migration; if it fails the field just starts empty, exactly as it did before Phase 2.',
  'src/components/teleprompter/useTeleprompterSession.ts#4':
    'The one-time browser-storage-to-settings migration write; a failure leaves the device in local state for this visit and the migration is retried next load since the settings value never got marked set.',
  'src/components/manuscript/creditsExpandedStorage.ts#1':
    "Remembering a credits card's open state per project in localStorage (MC5 b); the choice lasts for this visit only when storage is disabled.",
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
  'src/components/editing/EditingCandidateRow.tsx#1':
    'Re-reads a candidate after the host refused a decision, only to tell changed evidence apart; when the re-read fails too, the inline alert still shows the host reason for the refusal, so nothing is hidden (mirrors FindingDetail.tsx#1).',
  'src/components/tracks/RetakeLanesDialog.tsx#1':
    'Hydrates whatever pick was already in flight when the dialog reopened; the list still loads and every pick shows its own failure inline.',
  'src/components/tracks/CleanupToolsDialog.tsx#1':
    'Hydrates whatever launch was already in flight when the dialog reopened; the narrator can press Open either way, and a launch shows its own failure inline.',
  'src/components/tracks/RenderConfigDialog.tsx#1':
    'Hydrates whatever configure run was already in flight, then offers a suggested output folder when none was configured yet; the narrator can still type a folder and press Configure render either way.',
  'src/components/home/RecordingCheckReport.tsx#1':
    "A background count of the chapter's other pickups (take review, RS4 A); a failure just leaves that line out of the Pickups list, with the check's own gaps unaffected.",
};
