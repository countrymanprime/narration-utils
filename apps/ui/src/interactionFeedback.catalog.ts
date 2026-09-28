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
import { settingsFeedback } from './interactionFeedback/settings';
import { storyBibleFeedback } from './interactionFeedback/storyBible';
import { teleprompterFeedback } from './interactionFeedback/teleprompter';
import { tracksFeedback } from './interactionFeedback/tracks';
import { proofFeedback } from './interactionFeedback/proof';
import { editingFeedback } from './interactionFeedback/editing';
import { deliveryFeedback } from './interactionFeedback/delivery';
import { productionFeedback } from './interactionFeedback/production';
import { creditsFeedback } from './interactionFeedback/credits';

export type { FeedbackRow } from './interactionFeedback/row';

// One file per area under interactionFeedback/ (the row shape and its helpers are interactionFeedback/row.ts). A site with a row
// in two areas fails here rather than one silently replacing the other.
const AREAS: Array<Record<string, FeedbackRow>> = [
  appFeedback,
  homeFeedback,
  manuscriptFeedback,
  projectFeedback,
  settingsFeedback,
  storyBibleFeedback,
  teleprompterFeedback,
  tracksFeedback,
  proofFeedback,
  editingFeedback,
  deliveryFeedback,
  productionFeedback,
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
  'src/useCapability.ts#1':
    "Seeds useCapability's entry before the next daw_capabilities_changed event; a failed seed just leaves the capability unsupported/unavailable a moment longer, same as an unknown capability key.",
  // Phase 1 (app-navigation-and-zoom-controls.prd.md) added two more bare catches in this file (Back/Forward's own guard,
  // and the nav's original one, now #6), renumbering what follows.
  'src/App.tsx#5': 'Best effort recovery for a popstate the app did not start: a reset that fails leaves the finished results in place, which is harmless.',
  'src/App.tsx#6':
    'Best effort when leaving a Proof chapter view with a compare run through the nav: a reset that fails leaves the finished results in place, which is harmless.',
  'src/App.tsx#7': 'Best effort when leaving a Proof chapter view with a compare run through guarded Back/Forward: same as the nav, harmless either way.',
  'src/components/home/Home.tsx#1': 'Only decides whether the "entries need review" nudge shows; without it the nudge is absent.',
  'src/components/home/Home.tsx#2':
    'Only pre-fills the "Build the Story Bible after import" checkbox from Settings; it keeps its on-by-default (D8) local state without it, and the narrator can still change it per import.',
  'src/components/manuscript/Manuscript.tsx#1':
    'Renders the Opening credits pseudo-entry preview; a failed render just leaves that entry showing "Nothing to preview yet." rather than a toast over the manuscript itself.',
  'src/components/manuscript/Manuscript.tsx#2': 'Renders the Closing credits pseudo-entry preview; same fallback as the opening one above.',
  'src/components/proof/CompareRun.tsx#1': 'Reads the last model and chunk choice; the defaults stay usable and Settings reports a real error.',
  // Phase 2 (teleprompter-manuscript-integration.prd.md) moved the device/settings catches into `useTeleprompterSession.ts`;
  // `TeleprompterPage.tsx` keeps only the chapter-selection catch it never shared with the modal.
  'src/components/teleprompter/TeleprompterPage.tsx#1':
    'Only renders the opening or closing credits for the picker (credits PRD Phase 4); a failed render leaves those credits out of the picker, as the Manuscript page leaves its entry empty, and the chapters are unaffected.',
  'src/components/teleprompter/TeleprompterPage.tsx#2': 'Only picks the chapter the narrator last read; the first chapter is used without it.',
  'src/components/teleprompter/TeleprompterPage.tsx#3':
    'The REAPER chapter suggestion (ADR 0113) is a hint: no .rpp, or none chosen, is normal for a narrator not using REAPER, so it means no hint.',
  'src/components/teleprompter/TeleprompterPage.tsx#4':
    'Only guards the REAPER preselection against a running session; useTeleprompterSession reads the state again and reports its failure.',
  'src/components/teleprompter/CompanionShell.tsx#1':
    "Companion mode's exit on unmount: nothing is left mounted to tell, and the host's exit is a no-op when companion mode was never entered, so there is no state it could leave wrong that a retry would fix.",
  'src/components/teleprompter/ResumePrompt.tsx#1':
    "Starts the bounded REAPER follow for the matched track while the prompt shows (read-aloud-resume-from-daw.prd.md Phase 5, ADR 0350); a failure to start just means that poll never begins, and the DAW-transport subscription and the narrator's own choices still settle the prompt.",
  'src/components/teleprompter/ResumePrompt.tsx#2':
    'Stops the follow on cleanup (the prompt settles, a session starts, or the dialog closes); a failure here is unobservable and harmless, since the poll it would have stopped already lost its listener.',
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
  'src/components/proof/FindingDetail.tsx#1':
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
  'src/components/home/RecordingCheckReport.tsx#2':
    "The pickup list's own background refresh (RS5 B), mirroring PickupsDialog.tsx#1; a failure leaves the count at whatever the subscription last reported, and the narrator can still reach the real count on Tracks.",
  'src/input/keymap.ts#1':
    "keymapFromBindings (input-commands-and-pedals.prd.md Phase 6): one stored gesture this build cannot parse (a hand-edited settings file, or an older/newer app's own bug) falls back to that one command's catalog default; not a narrator action, and not swallowed silently since the Keyboard & pedals panel still shows every other override normally.",
  'src/components/tracks/CreateChapterRegionsDialog.tsx#1':
    'Refreshes the preview right after a successful create, so the table shows the just-written rows as "exists"; the created counts already shown answer whether the write worked, so a failed refresh only leaves the pre-create preview in place.',
  'src/input/MidiSource.ts#1':
    "requestMIDIAccess() rejecting (denied, unsupported, or blocked by the webview host - Phase 8's spike, input-commands-and-pedals.prd.md): not a narrator action to retry, and not swallowed silently since KeyboardSource keeps every keyboard-type pedal working; MidiSource just contributes nothing rather than surfacing an error nobody in the booth can act on.",
  'src/input/HidSource.ts#1':
    'device.open() rejecting for an already-granted device (OS denial, or unplugged mid-open, Phase 11): retried on the next attach, and not swallowed silently since KeyboardSource and MidiSource keep every other pedal working; this device just contributes nothing until it opens.',
  'src/input/HidSource.ts#2':
    'navigator.hid.getDevices() rejecting (an unsupported or torn-down navigator.hid, Phase 11): leaves this source with no devices; KeyboardSource and MidiSource still cover the booth, so it just contributes nothing rather than surfacing an error nobody can act on.',
  'src/input/HidSource.ts#3':
    "requestHidDevice()'s chooser promise rejecting (the narrator cancelled it, or - Phase 8's spike found this plausible on WebView2 - no chooser ever appeared): not a narrator action to retry automatically, and the only outcome either way is that no new device got paired this time.",
  'src/components/proof/ProofChapterPage.tsx#1':
    'Only offers to review the last compare run; without it the offer is absent (moved from the Proofing page, stage-navigation Phase 5).',
  'src/components/proof/ProofChapterPage.tsx#2':
    "The chapter's findings for the text overlay (edit-and-proof-workspace.prd.md Phase 4): not a narrator action to retry, and not swallowed silently since the check-derived flags (Phase 2) still show with nothing lost - a failure here just leaves the overlay's extra flags and review-in-place off this load, and the book's notes on Proof (which read the same store) still work.",
};
